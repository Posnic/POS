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

const {
  prepareDesktopStockSummary,
  MAX_DOCUMENTS,
} = require('../src/services/business-stock-summary');
async function desktopStock(f, options) {
  const previous = process.env.POSNIC_DESKTOP;
  process.env.POSNIC_DESKTOP = '1';
  try {
    return await prepareDesktopStockSummary(db, f.branch, options);
  } finally {
    if (previous === undefined) delete process.env.POSNIC_DESKTOP;
    else process.env.POSNIC_DESKTOP = previous;
  }
}
test('desktop stock preparation keeps unknown coverage separate from verified low stock and excludes foreign scope', async () => {
  const f = await purchaseFixture();
  await db.collection('items').insertMany([
    { ...f.row, _id: new ObjectId(), available_quantity: 2 },
    { ...f.row, _id: new ObjectId(), available_quantity: 'bad' },
    { ...f.row, _id: new ObjectId(), track_inventory: false },
    { ...f.row, _id: new ObjectId(), branch_access: [{ branch_id: new ObjectId() }] },
    { ...f.row, _id: new ObjectId(), license: new ObjectId(), available_quantity: -100 },
    {
      ...f.row,
      _id: new ObjectId(),
      branch_id: new ObjectId(),
      branch_access: [],
      available_quantity: -100,
    },
  ]);
  const result = await desktopStock(f);
  assert.equal(result.sourceComplete, false);
  assert.equal(result.lowItemCount, 1);
  assert.equal(result.lowItems.length, 1);
  assert.equal(result.listTruncated, false);
  assert.deepEqual(result.coverage, {
    scannedItems: 5,
    excludedItems: 1,
    verifiedItems: 2,
    unavailableItems: 2,
    reasons: { invalid_stock_quantity: 1, ambiguous_branch_stock: 1 },
  });
  assert.ok(Date.parse(result.preparedAt) >= Date.parse(result.observedFrom));
});
test('desktop stock preparation caps the list without misrepresenting the low count and refuses an over-budget scan', async () => {
  const f = await purchaseFixture();
  const rows = Array.from({ length: 105 }, () => ({
    ...f.row,
    _id: new ObjectId(),
    available_quantity: 0,
  }));
  await db.collection('items').insertMany(rows);
  const result = await desktopStock(f);
  assert.equal(result.lowItemCount, 105);
  assert.equal(result.lowItems.length, 100);
  assert.equal(result.listTruncated, true);
  assert.equal(result.sourceComplete, false);
  await db.collection('items').insertMany(
    Array.from({ length: MAX_DOCUMENTS - 105 }, () => ({
      ...f.row,
      _id: new ObjectId(),
      track_inventory: false,
    }))
  );
  await assert.rejects(desktopStock(f), { code: 'preparation_budget_exceeded' });
});
test('desktop stock preparation refuses Cloud execution before I/O and supports cancellation and elapsed budget', async () => {
  const f = await purchaseFixture();
  const previous = process.env.POSNIC_DESKTOP;
  delete process.env.POSNIC_DESKTOP;
  try {
    await assert.rejects(
      prepareDesktopStockSummary(
        {
          collection: () => {
            throw new Error('I/O');
          },
        },
        f.branch
      ),
      { code: 'desktop_required' }
    );
  } finally {
    if (previous !== undefined) process.env.POSNIC_DESKTOP = previous;
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(desktopStock(f, { signal: controller.signal }), { code: 'cancelled' });
  let time = 0;
  await assert.rejects(
    desktopStock(f, {
      now: () => {
        time += 16000;
        return time;
      },
    }),
    { code: 'preparation_budget_exceeded' }
  );
});

test('empty stock observations never claim completeness and configured branch thresholds come from storage', async () => {
  const f = await purchaseFixture();
  await db
    .collection('items')
    .updateOne(
      { _id: f.row._id },
      { $unset: { reorder_point: '' }, $set: { available_quantity: 3 } }
    );
  f.branch.notificationRange = '99';
  let result = await desktopStock(f);
  assert.equal(result.lowItemCount, 0);
  assert.equal(result.coverage.verifiedItems, 1);
  await db.collection('items').deleteOne({ _id: f.row._id });
  result = await desktopStock(f);
  assert.equal(result.coverage.scannedItems, 0);
  assert.equal(result.lowItemCount, 0);
  assert.equal(result.sourceComplete, false);
});
test('changing the branch reorder setting during preparation prevents publishing a mixed observation', async () => {
  const f = await purchaseFixture();
  let reads = 0;
  const interceptedDb = {
    collection(name) {
      if (name !== 'branches') return db.collection(name);
      return {
        async findOne(...args) {
          if (++reads === 2)
            await db
              .collection(name)
              .updateOne({ _id: f.row.branch_id }, { $set: { notification_range: '99' } });
          return db.collection(name).findOne(...args);
        },
      };
    },
  };
  const previous = process.env.POSNIC_DESKTOP;
  process.env.POSNIC_DESKTOP = '1';
  try {
    await assert.rejects(prepareDesktopStockSummary(interceptedDb, f.branch), {
      code: 'stock_settings_changed',
    });
  } finally {
    if (previous === undefined) delete process.env.POSNIC_DESKTOP;
    else process.env.POSNIC_DESKTOP = previous;
  }
});

test('legacy string and ObjectId stock identities sort canonically and duplicate logical items reject the snapshot', async () => {
  const f = await purchaseFixture();
  await db.collection('items').insertMany([
    { ...f.row, _id: 'f'.repeat(24), available_quantity: 0 },
    { ...f.row, _id: new ObjectId('0'.repeat(23) + '1'), available_quantity: 0 },
  ]);
  const result = await desktopStock(f);
  assert.deepEqual(
    result.lowItems.map((item) => item.itemId),
    ['0'.repeat(23) + '1', 'f'.repeat(24)]
  );
  await db.collection('items').insertOne({ ...f.row, _id: String(f.row._id) });
  await assert.rejects(desktopStock(f), { code: 'duplicate_stock_item' });
});
