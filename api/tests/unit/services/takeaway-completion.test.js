'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const { completed, reconcile } = require('../../../src/services/takeaway-completion');
const { tableOccupancy } = require('../../../src/helpers/floor-eligibility');
let memory, db, scope, sale;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await memory.stop();
});
beforeEach(async () => {
  await db.collection('sales').deleteMany({});
  scope = { branchId: new ObjectId(), license: new ObjectId() };
  sale = {
    _id: new ObjectId(),
    branch_id: scope.branchId,
    license: scope.license,
    dine_type: 'Take away',
    floor_lifecycle: true,
    sale_process: 'Edit',
    payment_status: 'Paid',
    sales_total: 1134,
    multi_payment: { UPI: 1134 },
    payment_pending: 0,
    kitchen_closed: false,
    updated_date: new Date('2026-10-03T06:13:00Z'),
    items: [{ item_id: 'chicken', item_quantity: 2, item_name: 'Tandoori Chicken - Full' }],
    changes: [{ items: [{ item_id: 'chicken', item_quantity: 2, process: 'add' }] }],
    kitchen_service: { c0i0: { quantity: 2, by: 'staff' } },
  };
  await db.collection('sales').insertOne(sale);
});
test('floor refresh repairs paid/served legacy takeaway without changing financial data; retry is a no-op', async () => {
  const sales = db.collection('sales');
  await reconcile(db, scope);
  const after = await sales.findOne({ _id: sale._id });
  expect(after.floor_closed_at).toBeInstanceOf(Date);
  expect(after.kitchen_closed).toBe(true);
  for (const key of [
    'items',
    'changes',
    'sales_total',
    'multi_payment',
    'payment_status',
    'kitchen_service',
  ])
    expect(after[key]).toEqual(sale[key]);
  expect(await sales.countDocuments({ branch_id: scope.branchId, ...tableOccupancy() })).toBe(0);
  await reconcile(db, scope);
  expect(await sales.findOne({ _id: sale._id })).toEqual(after);
});
test.each(['payment-first', 'service-first'])('%s only closes after both events', async (order) => {
  const sales = db.collection('sales');
  const first =
    order === 'payment-first'
      ? { kitchen_service: {} }
      : { payment_status: 'Unpaid', payment_pending: 1134 };
  await sales.updateOne({ _id: sale._id }, { $set: first });
  await reconcile(db, scope);
  expect(await sales.countDocuments({ ...tableOccupancy() })).toBe(1);
  await sales.updateOne(
    { _id: sale._id },
    {
      $set: {
        payment_status: 'Paid',
        payment_pending: 0,
        kitchen_service: sale.kitchen_service,
      },
    }
  );
  await reconcile(db, scope);
  expect(await sales.countDocuments({ ...tableOccupancy() })).toBe(0);
});
test.each([
  { payment_pending: 10 },
  { balance: '10' },
  { balance: 'bad' },
  { kitchen_service: { c0i0: { quantity: 1 } } },
  { kitchen_service: {}, kitchen_closed: true },
  { dine_type: 'Dine-in' },
  { floor_lifecycle: false },
  { order_state: 'pending' },
  { payment_status: 'Cancelled' },
  { items: [], changes: [] },
])('keeps incomplete or unrelated orders open: %j', async (patch) => {
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: patch });
  await reconcile(db, scope);
  expect((await db.collection('sales').findOne({ _id: sale._id })).floor_closed_at).toBeUndefined();
});
test('new held additions keep the takeaway open', async () => {
  const changed = {
    ...sale,
    items: [...sale.items, { item_id: 'rice', item_quantity: 1, held: true }],
  };
  expect(completed(changed)).toBe(false);
});
test('a pending payment projection stays open until the journal is completely projected', async () => {
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { captain_payment_plan: 'plan' } });
  await db.collection('captain_payment_plans').insertOne({
    _id: 'plan',
    branch_id: scope.branchId,
    license: scope.license,
    state: 'paid',
    version: 2,
    projectedVersion: 1,
  });
  await reconcile(db, scope);
  expect((await db.collection('sales').findOne({ _id: sale._id })).floor_closed_at).toBeUndefined();
  await db
    .collection('captain_payment_plans')
    .updateOne({ _id: 'plan' }, { $set: { projectedVersion: 2 } });
  await reconcile(db, scope);
  expect((await db.collection('sales').findOne({ _id: sale._id })).floor_closed_at).toBeInstanceOf(
    Date
  );
});
test('scope prevents another branch or tenant from being changed', async () => {
  await reconcile(db, { ...scope, license: new ObjectId() });
  await reconcile(db, { ...scope, branchId: new ObjectId() });
  expect((await db.collection('sales').findOne({ _id: sale._id })).floor_closed_at).toBeUndefined();
});
test('a concurrent new item cannot be closed using stale served quantities', async () => {
  const sales = db.collection('sales');
  const wrapped = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== 'sales') return collection;
      return {
        find: (...args) => collection.find(...args),
        updateOne: async (...args) => {
          await sales.updateOne(
            { _id: sale._id },
            { $push: { items: { item_id: 'rice', item_quantity: 1 } } }
          );
          return collection.updateOne(...args);
        },
      };
    },
  };
  await reconcile(wrapped, scope);
  expect((await sales.findOne({ _id: sale._id })).floor_closed_at).toBeUndefined();
});
