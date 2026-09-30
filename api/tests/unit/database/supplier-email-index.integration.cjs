const { test, before: beforeAll, after: afterAll, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { migrateSupplierEmailIndex } = require('../../../src/database/migrations/supplier-email-index');
const { migrateCustomerEmailIndex } = require('../../../src/database/migrations/supplier-email-index');
let server, client, db;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('supplier_email_regression');
});
afterAll(async () => { if (client) await client.close(); if (server) await server.stop(); });
beforeEach(async () => { await db.dropDatabase(); });

for (const sparse of [false, true]) test('repairs a legacy unique email index sparse=' + sparse, async () => {
  const collection = db.collection('suppliers');
  await collection.createIndex({ email: 1 }, { unique: true, sparse, name: 'email_1' });
  await collection.insertOne({ name: 'Existing', email: '' });
  await assert.rejects(collection.insertOne({ name: 'Blocked', email: '' }), { code: 11000 });
  await migrateSupplierEmailIndex(db);
  await collection.insertMany([
    { name: 'Import A', email: '' }, { name: 'Import B', email: '' },
    { name: 'Missing A' }, { name: 'Missing B' },
    { name: 'Null A', email: null }, { name: 'Null B', email: null },
    { name: 'Email', email: 'supplier@example.com' },
  ]);
  await assert.rejects(collection.insertOne({ name: 'Duplicate email', email: 'supplier@example.com' }), { code: 11000 });
  await collection.updateOne({ name: 'Email' }, { $set: { email: '' } });
  await migrateSupplierEmailIndex(db);
  assert.equal(await collection.countDocuments(), 8);
  assert.equal((await collection.findOne({ name: 'Existing' })).email, '');
  assert.equal((await collection.indexes()).some(i => i.name === 'email_1'), false);
});

for (const [name, migrate] of [['suppliers', migrateSupplierEmailIndex], ['customers', migrateCustomerEmailIndex]]) {
  test(name + ': historical duplicates defer migration without changing data', async () => {
    const collection = db.collection(name);
    await collection.createIndex({ email: 1 }, { name: 'legacy_email_lookup' });
    await collection.insertMany([{ name: 'A', email: 'same@example.com' }, { name: 'B', email: 'same@example.com' }, { email: '' }, { email: '' }]);
    const records = await collection.find().toArray();
    const indexes = await collection.indexes();
    for (let restart = 0; restart < 2; restart++) {
      assert.equal((await migrate(db)).status, 'deferred');
      assert.deepEqual(await collection.find().toArray(), records);
      assert.deepEqual(await collection.indexes(), indexes);
    }
    await collection.updateOne({ name: 'B' }, { $set: { email: 'other@example.com' } });
    await migrate(db);
    await assert.rejects(collection.insertOne({ email: 'same@example.com' }), { code: 11000 });
    await collection.insertOne({ email: '' });
  });
}

test('startup email migration completes with duplicate customers and suppliers', async () => {
  for (const name of ['customers', 'suppliers']) {
    await db.collection(name).insertMany([{ email: 'old@example.com' }, { email: 'old@example.com' }]);
  }
  await require('../../../src/database/migrations/optional-email-indexes').migrateOptionalEmailIndexes(db);
  assert.equal(await db.collection('customers').countDocuments(), 2);
  assert.equal(await db.collection('suppliers').countDocuments(), 2);
});

test('unexpected index errors propagate without dropping existing indexes', async () => {
  const failure = Object.assign(new Error('permission denied'), { code: 13 });
  let drops = 0;
  const fake = { listCollections: () => ({ hasNext: async () => true }), collection: () => ({
    listIndexes: () => ({ toArray: async () => [{ name: 'email_1', key: { email: 1 }, unique: true }] }),
    createIndex: async () => { throw failure; }, dropIndex: async () => { drops++; }
  }) };
  await assert.rejects(migrateCustomerEmailIndex(fake), error => error === failure);
  assert.equal(drops, 0);
});

test('fresh database can be migrated before the first supplier exists', async () => {
  await migrateSupplierEmailIndex(db);
  assert.equal((await db.listCollections().toArray()).length, 0);
});

test('customer migration also permits repeated empty and missing emails while retaining real uniqueness', async () => {
  const customers = db.collection('customers');
  await customers.createIndex({ email: 1 }, { unique: true, name: 'email_1' });
  await customers.insertOne({ name: 'Existing', email: '' });
  await migrateCustomerEmailIndex(db);
  await customers.insertMany([{ name: 'A', email: '' }, { name: 'B', email: '' }, { name: 'C' }, { name: 'D' }, { email: 'real@example.com' }]);
  await assert.rejects(customers.insertOne({ email: 'real@example.com' }), { code: 11000 });
  await migrateCustomerEmailIndex(db);
  assert.equal(await customers.countDocuments(), 6);
});
