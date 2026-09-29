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

test('does not delete suppliers or silently weaken uniqueness when real emails conflict', async () => {
  const collection = db.collection('suppliers');
  await collection.insertMany([{ email: 'same@example.com' }, { email: 'same@example.com' }]);
  await assert.rejects(migrateSupplierEmailIndex(db), { code: 11000 });
  assert.equal(await collection.countDocuments(), 2);
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
