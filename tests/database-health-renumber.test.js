'use strict';

/*
 * The self-healing repair mutates real sales, so it is tested with a fake Mongo
 * that records every write. What matters: it keeps the EARLIEST document's
 * number and renumbers the rest, the new number carries this till's tag and a
 * fresh counter value, every change is backed up first, and a collection with
 * no duplicates is left completely untouched.
 */

const test = require('node:test');
const assert = require('node:assert');
const { renumberDuplicateSales } = require('../database-health');

// A minimal fake Mongo that records every write.
function makeDb({ groups = [], tag = 'DEV1', counterStart = 100, existingSales = [] } = {}) {
  const writes = { updates: [], backups: [], counterKey: null };
  let seq = counterStart;

  const sales = {
    aggregate: () => ({ toArray: async () => groups }),
    find: () => ({ toArray: async () => existingSales }),
    updateOne: async (filter, update) => {
      writes.updates.push({ id: String(filter._id), set: update.$set });
      return { modifiedCount: 1 };
    },
  };
  const counters = {
    findOne: async () => ({ seq }), // already seeded
    updateOne: async () => ({}),
    findOneAndUpdate: async (key) => {
      writes.counterKey = key;
      seq += 1;
      return { seq };
    },
  };
  const device_meta = { findOne: async () => (tag ? { _id: 'device_tag', tag } : null) };
  const database_repair_backup = {
    insertOne: async (doc) => {
      writes.backups.push(doc);
      return {};
    },
  };

  const db = {
    collection: (name) => {
      if (name === 'sales') return sales;
      if (name === 'counters') return counters;
      if (name === 'device_meta') return device_meta;
      if (name === 'database_repair_backup') return database_repair_backup;
      throw new Error('unexpected collection ' + name);
    },
  };
  return { db, writes };
}

test('renumbers the later duplicate, keeps the earliest, tags and backs up', async () => {
  const groups = [
    {
      _id: { license: 'L1', branch: 'B1', value: 'SID000005' },
      count: 2,
      docs: [
        { id: 'newer', created: '2026-08-11T00:00:00Z' },
        { id: 'older', created: '2025-12-18T00:00:00Z' },
      ],
    },
  ];
  const { db, writes } = makeDb({ groups, tag: 'DEV1', counterStart: 100 });

  const n = await renumberDuplicateSales(db);

  assert.strictEqual(n, 1, 'exactly one document renumbered');
  assert.strictEqual(writes.updates.length, 1);
  // The EARLIEST (older) keeps its number; the newer one is the one moved.
  assert.strictEqual(writes.updates[0].id, 'newer');
  // New number: same prefix, this till's tag, next counter value (101).
  assert.strictEqual(writes.updates[0].set.sales_id, 'SID-DEV1-000101');
  assert.strictEqual(writes.updates[0].set.invoice_number, 'SID-DEV1-000101');
  assert.strictEqual(writes.updates[0].set.sale_no, 'SID-DEV1-000101');
  // Backed up before the change.
  assert.strictEqual(writes.backups.length, 1);
  assert.strictEqual(writes.backups[0].original_sales_id, 'SID000005');
  assert.strictEqual(writes.backups[0].new_sales_id, 'SID-DEV1-000101');
});

test('a database with no duplicates is left untouched', async () => {
  const { db, writes } = makeDb({ groups: [] });
  const n = await renumberDuplicateSales(db);
  assert.strictEqual(n, 0);
  assert.strictEqual(writes.updates.length, 0);
  assert.strictEqual(writes.backups.length, 0);
});

test('falls back to an untagged number when the till has no code yet', async () => {
  const groups = [
    {
      _id: { license: 'L1', branch: 'B1', value: 'SID000005' },
      count: 2,
      docs: [
        { id: 'a', created: '2025-01-01T00:00:00Z' },
        { id: 'b', created: '2026-01-01T00:00:00Z' },
      ],
    },
  ];
  const { db, writes } = makeDb({ groups, tag: '', counterStart: 200 });
  await renumberDuplicateSales(db);
  // No tag: prefix + number, no double hyphen.
  assert.strictEqual(writes.updates[0].id, 'b');
  assert.strictEqual(writes.updates[0].set.sales_id, 'SID000201');
});

test('renumbers every extra in a triple, keeping only the earliest', async () => {
  const groups = [
    {
      _id: { license: 'L1', branch: 'B1', value: 'SID000005' },
      count: 3,
      docs: [
        { id: 'mid', created: '2026-02-01T00:00:00Z' },
        { id: 'first', created: '2026-01-01T00:00:00Z' },
        { id: 'last', created: '2026-03-01T00:00:00Z' },
      ],
    },
  ];
  const { db, writes } = makeDb({ groups, tag: 'DEV1', counterStart: 50 });
  const n = await renumberDuplicateSales(db);
  assert.strictEqual(n, 2, 'two of the three renumbered');
  // "first" is never touched; "mid" and "last" are moved.
  const movedIds = writes.updates.map((u) => u.id).sort();
  assert.deepStrictEqual(movedIds, ['last', 'mid']);
});
