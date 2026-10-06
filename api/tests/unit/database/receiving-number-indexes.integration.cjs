const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { migrateReceivingNumberIndexes } = require('../../../src/database/migrations/receiving-number-indexes');
let server, client, db;
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('receiving_index_regression');
});
after(async () => { await client?.close(); await server?.stop(); });
beforeEach(async () => { await db.dropDatabase(); });
test('legacy missing aliases and branch-local numbers restore without dropping records', async () => {
  const c = db.collection('receivings');
  await c.createIndex({ receiving_number: 1 }, { unique: true });
  await c.createIndex({ receiving_id: 1 }, { unique: true });
  await c.insertOne({ _id: 'original', license: 'shop', branch_id: 'a', receiving_id: 'RID1' });
  await assert.rejects(c.insertOne({ _id: 'blocked', receiving_id: 'RID2' }), { code: 11000 });
  await migrateReceivingNumberIndexes(db);
  await migrateReceivingNumberIndexes(db);
  await c.insertMany([
    { _id: 'restored', license: 'shop', branch_id: 'a', receiving_id: 'RID2' },
    { _id: 'other-branch', license: 'shop', branch_id: 'b', receiving_id: 'RID1' },
    { _id: 'other-shop', license: 'other', branch_id: 'a', receiving_id: 'RID1' },
    { _id: 'blank1', receiving_number: '' }, { _id: 'blank2', receiving_number: '' },
  ]);
  assert.equal(await c.countDocuments(), 6);
  assert.equal((await c.findOne({ _id: 'original' })).receiving_id, 'RID1');
  await assert.rejects(c.insertOne({ license: 'shop', branch_id: 'a', receiving_id: 'RID1' }), { code: 11000 });
});
test('genuine duplicates retain their data and original indexes', async () => {
  const c = db.collection('receivings');
  await c.createIndex({ receiving_number: 1 }, { unique: true });
  await c.insertMany([
    { receiving_number: 'A', receiving_id: 'same', license: 'shop', branch_id: 'a' },
    { receiving_number: 'B', receiving_id: 'same', license: 'shop', branch_id: 'a' },
  ]);
  await assert.rejects(migrateReceivingNumberIndexes(db), { code: 11000 });
  assert.equal(await c.countDocuments(), 2);
  assert.ok((await c.indexes()).some(i => i.name === 'receiving_number_1' && i.unique));
});
