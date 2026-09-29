'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { stockFact } = require('../src/services/business-stock-facts');
let mongo, client, db, BaseModel, repo;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  process.env.MONGODB_URI = mongo.getUri('business_stock');
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db('business_stock');
  BaseModel = require('../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = client;
  BaseModel._connectedUri = process.env.MONGODB_URI;
  repo = new (require('../src/repositories/item.repository'))();
});
after(async () => {
  await require('mongoose').disconnect();
  if (BaseModel?.mongoClient && BaseModel.mongoClient !== client)
    await BaseModel.mongoClient.close();
  await client?.close();
  await mongo?.stop();
});
async function fixture(track = true) {
  const license = new ObjectId(),
    branchId = new ObjectId();
  BaseModel.license = license;
  BaseModel.currentBranch = branchId;
  const row = {
    _id: new ObjectId(),
    license,
    branch_id: branchId,
    branch_access: [{ branch_id: branchId }],
    name: 'Rice',
    unit: 'kg',
    item_status: 'regular',
    track_inventory: track,
    negative_stock: false,
    available_quantity: 6,
    reorder_point: 5,
  };
  await db.collection('items').insertOne(row);
  const branch = { id: String(branchId), license: String(license), notificationRange: '2' };
  const read = async () =>
    stockFact(await db.collection('items').findOne({ _id: row._id }), branch);
  return { row, branch, read };
}
test('actual stock delta writer crosses a reorder point and restocking clears it without losing units', async () => {
  const f = await fixture();
  assert.equal((await f.read()).low, false);
  await repo.updateStock(f.row._id, -1.125, { reason: 'sale_inventory' });
  assert.deepEqual(await f.read(), {
    itemId: String(f.row._id),
    name: 'Rice',
    unit: 'kg',
    availableMilli: 4875,
    thresholdMilli: 5000,
    thresholdSource: 'item',
    low: true,
  });
  await repo.updateStock(f.row._id, 0.25);
  assert.equal((await f.read()).low, false);
  await repo.updateStock(f.row._id, -6);
  assert.equal((await f.read()).availableMilli, -875);
});
test('actual conditional deduction permits only one competing sale and recognizes legacy explicit tracking', async () => {
  const f = await fixture('true');
  const results = await Promise.all([
    repo.deductStockIfAvailable(f.row._id, 4),
    repo.deductStockIfAvailable(f.row._id, 4),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await f.read()).availableMilli, 2000);
  assert.equal((await f.read()).low, true);
  assert.equal(await repo.deductStockIfAvailable(f.row._id, 3), null);
  assert.equal((await f.read()).availableMilli, 2000);
});
test('untracked products are excluded and changing catalogue scope cannot reuse a single branch fact', async () => {
  const f = await fixture('false');
  assert.equal(await f.read(), null);
  assert.equal(await repo.deductStockIfAvailable(f.row._id, 1), null);
  await db
    .collection('items')
    .updateOne(
      { _id: f.row._id },
      { $set: { track_inventory: true, branch_access: [{ branch_id: new ObjectId() }] } }
    );
  await assert.rejects(f.read(), { code: 'ambiguous_branch_stock' });
});

test('BSON double increment noise is normalized without accepting finer-than-thousandth quantities', async () => {
  const f = await fixture();
  await repo.updateStock(f.row._id, -0.1);
  await repo.updateStock(f.row._id, -0.2);
  assert.equal((await f.read()).availableMilli, 5700);
  await db
    .collection('items')
    .updateOne({ _id: f.row._id }, { $set: { available_quantity: 5.7001 } });
  await assert.rejects(f.read(), { code: 'invalid_stock_quantity' });
});

async function purchaseFixture() {
  const f = await fixture();
  BaseModel.loggedUser = new ObjectId();
  BaseModel.loggedUserName = 'Stock test';
  await db.collection('branches').insertOne({
    _id: f.row.branch_id,
    license: f.row.license,
    stock_management: true,
    notification_range: '2',
  });
  const Receiving = require('../src/models/receiving.model');
  const data = {
    supplier_id: String(new ObjectId()),
    status: 'Received',
    items: [{ item_id: String(f.row._id), item_quantity: 2.125, item_tax: 0 }],
  };
  return { ...f, Receiving, data };
}
test('controller receiving model adds only received goods, applies edit differences and reverses a void', async () => {
  const f = await purchaseFixture();
  const created = await f.Receiving.receivingInsertUpdate(f.data, null);
  assert.equal(created.status, true, created.message);
  assert.equal((await f.read()).availableMilli, 8125);
  const id = created.data.receiving_id;
  f.data.items[0].item_quantity = 3;
  let edited = await f.Receiving.receivingInsertUpdate(f.data, id);
  assert.equal(edited.status, true, edited.message);
  assert.equal((await f.read()).availableMilli, 9000);
  edited = await f.Receiving.receivingInsertUpdate(f.data, id);
  assert.equal(edited.status, true, edited.message);
  assert.equal((await f.read()).availableMilli, 9000);
  f.data.items[0].item_quantity = 1;
  edited = await f.Receiving.receivingInsertUpdate(f.data, id);
  assert.equal(edited.status, true, edited.message);
  assert.equal((await f.read()).availableMilli, 7000);
  const voided = await f.Receiving.voidReceiving(id, 'Supplier cancelled');
  assert.equal(voided.status, true, voided.message);
  assert.equal((await f.read()).availableMilli, 6000);
  assert.equal((await f.Receiving.voidReceiving(id, 'Repeated')).status, false);
  assert.equal((await f.read()).availableMilli, 6000);
});
test('controller partial receiving moves only arrivals and a void reverses the received portion', async () => {
  const f = await purchaseFixture();
  f.data.status = 'Ordered';
  const created = await f.Receiving.receivingInsertUpdate(f.data, null);
  assert.equal(created.status, true, created.message);
  assert.equal((await f.read()).availableMilli, 6000);
  const id = created.data.receiving_id;
  const partial = await f.Receiving.receivePartial(id, {
    lines: [{ item_id: String(f.row._id), qty: 0.125 }],
  });
  assert.equal(partial.status, true, partial.message);
  assert.equal((await f.read()).availableMilli, 6125);
  const voided = await f.Receiving.voidReceiving(id, 'Partial delivery cancelled');
  assert.equal(voided.status, true, voided.message);
  assert.equal((await f.read()).availableMilli, 6000);
});

test('controller supplier return subtracts the returned amount from the stored stock fact', async () => {
  const f = await purchaseFixture();
  const created = await f.Receiving.receivingInsertUpdate(f.data, null);
  assert.equal(created.status, true, created.message);
  const returned = await f.Receiving.returnReceivingOrder({
    id: created.data.receiving_id,
    items_return: [
      {
        item_id: String(f.row._id),
        item_quantity: 2,
        return_quantity: 0.125,
        item_tax: 0,
      },
    ],
  });
  assert.equal(returned.status, true, returned.message);
  assert.equal((await f.read()).availableMilli, 8000);
});
test('variant family members retain their own stock and reorder state', async () => {
  const f = await fixture();
  const group = new ObjectId(),
    siblingId = new ObjectId();
  await db.collection('items').updateOne(
    { _id: f.row._id },
    {
      $set: {
        variant_group_id: group,
        variant_axis: 'Size',
        variant_value: 'Small',
        name: 'Rice Small',
      },
    }
  );
  await db.collection('items').insertOne({
    ...f.row,
    _id: siblingId,
    variant_group_id: group,
    variant_axis: 'Size',
    variant_value: 'Large',
    name: 'Rice Large',
    available_quantity: 10,
  });
  await repo.updateStock(f.row._id, -2);
  assert.equal((await f.read()).low, true);
  const sibling = stockFact(await db.collection('items').findOne({ _id: siblingId }), f.branch);
  assert.equal(sibling.name, 'Rice Large');
  assert.equal(sibling.availableMilli, 10000);
  assert.equal(sibling.low, false);
});
