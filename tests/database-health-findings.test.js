'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDatabaseHealthCheck, describeDuplicate, healthFindingFingerprint } = require('../src/database-health');

const duplicate = { collection: 'items', field: 'barcode_id', value: '12345', count: 2,
  license: 'shop-1', branch: 'branch-1', documents: ['item-1', 'item-2'] };

test('the startup report identifies the repeated barcode without changing products', async () => {
  const queried = [];
  const db = {
    command: async () => ({}),
    collection: (name) => ({
      listIndexes: () => ({ toArray: async () => [] }), createIndex: async () => {},
      find: () => ({ toArray: async () => [] }),
      aggregate: (pipeline) => {
        queried.push([name, pipeline]);
        return { toArray: async () => name === 'items' ? [{
          _id: { license: 'shop-1', branch: 'branch-1', value: '12345' },
          count: 2, documents: ['item-1', 'item-2'],
        }] : [] };
      },
      updateOne: () => { throw new Error('must not change product data'); },
    }),
  };
  const report = await runDatabaseHealthCheck({ db: () => db });
  assert.equal(report.status, 'warning');
  assert.deepEqual(report.duplicates, [duplicate]);
  assert.match(report.warnings[0], /Barcode "12345" is shared by 2 items/);
  assert.match(report.warnings[0], /Review this barcode in Items/);
  assert.equal(report.errors.length, 0);
  assert.ok(queried.every(([, pipeline]) => !JSON.stringify(pipeline).includes('itemid')));
});

test('receipt duplicates direct the owner to Sales History', () => {
  assert.match(describeDuplicate({ collection: 'sales', field: 'sales_id', value: 'SID000001', count: 2 }),
    /Receipt number "SID000001" is shared by 2 sales.*Sales History/);
});

test('acknowledgements survive scan ordering, timestamps and successful maintenance', () => {
  const report = { duplicates: [duplicate], warnings: ['review'], errors: [] };
  const key = healthFindingFingerprint(report);
  assert.equal(key, healthFindingFingerprint({ ...report, checkedAt: 'later', repairs: [{ repaired: 2 }],
    duplicates: [{ ...duplicate, documents: ['item-2', 'item-1'] }] }));
});

test('another duplicate with the same count is a new finding', () => {
  const key = healthFindingFingerprint({ duplicates: [duplicate] });
  for (const changed of [{ value: '67890' }, { branch: 'branch-2' }, { documents: ['item-3', 'item-4'] }]) {
    assert.notEqual(key, healthFindingFingerprint({ duplicates: [{ ...duplicate, ...changed }] }));
  }
});
