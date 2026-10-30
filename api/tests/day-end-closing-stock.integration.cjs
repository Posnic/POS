'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { closingStock } = require('../src/services/report-closing-stock');
test('closing stock is historical, tenant and branch scoped, precise, and never substitutes current stock', async () => {
  const server = await MongoMemoryServer.create({
    binary: { systemBinary: path.resolve(__dirname, '../../mongodb/bin/mongod.exe') },
  });
  const client = new MongoClient(server.getUri());
  try {
    await client.connect();
    const db = client.db('closing_stock_test'),
      branch = new ObjectId(),
      license = new ObjectId(),
      item = new ObjectId(),
      unknown = new ObjectId();
    const log = (date, balance, extra = {}) => ({
      branch_id: branch,
      license,
      view_item_id: item,
      date: new Date(date),
      closing_balance: balance,
      ...extra,
    });
    await db
      .collection('stocklogs')
      .insertMany([
        log('2026-10-24T10:00:00Z', '12.345'),
        log('2026-10-25T00:00:00Z', '1'),
        log('2026-10-24T12:00:00Z', '999', { branch_id: new ObjectId() }),
        log('2026-10-24T13:00:00Z', '999', { license: new ObjectId() }),
        log('2026-10-24T14:00:00Z', '999', { is_deleted: true }),
        log('2026-10-24T15:00:00Z', 'N/A', { view_item_id: unknown }),
      ]);
    const opts = {
      branch,
      license,
      end: new Date('2026-10-25T00:00:00Z'),
      itemIds: [item, unknown, new ObjectId()],
    };
    assert.deepEqual([...(await closingStock(db, opts))], [[String(item), 12.345]]);
    assert.equal((await closingStock(db, { ...opts, license: null })).size, 0);
  } finally {
    await client.close();
    await server.stop();
  }
});
