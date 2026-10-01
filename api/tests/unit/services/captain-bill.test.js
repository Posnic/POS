'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-bill');
let mem, db, branch, license, sale;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('captain-bill'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  await db
    .collection('branches')
    .insertOne({ _id: branch, license, currency: '₹', captain_payments: { enabled: true } });
  sale = {
    _id: new ObjectId(),
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    sales_sub_total: 100,
    sales_total: 105,
    tax: 5,
    items: [{ item_name: 'Soup', item_quantity: 2, item_base_price: 50, item_tax: 5 }],
  };
  await db.collection('sales').insertOne(sale);
});
const req = () => ({
  db,
  user: { role: 'manager' },
  tenantContext: { branchId: branch, licenseId: license },
  query: { table: 'T1' },
});
test('read-only bill uses canonical item and tax totals and excludes other tenants', async () => {
  await db.collection('sales').insertOne({ ...sale, _id: new ObjectId(), license: new ObjectId() });
  const bill = await service.read(req());
  expect(bill).toMatchObject({
    totalMinor: 10500,
    paidMinor: 0,
    dueMinor: 10500,
    collectEnabled: true,
  });
  expect(bill.lines).toHaveLength(1);
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(0);
});
test('partial payment journal takes precedence over a stale sale projection', async () => {
  const id = new ObjectId();
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { captain_payment_plan: id, paid_amount: 0 } });
  await db.collection('captain_payment_plans').insertOne({
    _id: id,
    branch_id: branch,
    license,
    payments: [{ allocations: { [String(sale._id)]: 3500 } }],
  });
  expect(await service.read(req())).toMatchObject({ paidMinor: 3500, dueMinor: 7000 });
  await db.collection('captain_payment_plans').deleteMany({});
  await expect(service.read(req())).rejects.toMatchObject({ status: 409 });
});
test('paid open tables remain readable until explicitly closed', async () => {
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { payment_status: 'Paid', floor_lifecycle: true } });
  expect(await service.read(req())).toMatchObject({ paidMinor: 10500, dueMinor: 0 });
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { floor_closed_at: new Date() } });
  await expect(service.read(req())).rejects.toMatchObject({ status: 404 });
});
test('rejects missing permission and invalid table inputs', async () => {
  await expect(service.read({ ...req(), user: { role: 'staff' } })).rejects.toMatchObject({
    status: 403,
  });
  await expect(service.read({ ...req(), query: { table: { $ne: '' } } })).rejects.toMatchObject({
    status: 422,
  });
});

test('complimentary bills can be reviewed without creating a payment plan', async () => {
  await db.collection('sales').updateOne(
    { _id: sale._id },
    {
      $set: {
        sales_sub_total: 0,
        sales_total: 0,
        tax: 0,
        items: [{ item_name: 'Water', item_quantity: 1, item_base_price: 0 }],
      },
    }
  );
  expect(await service.read(req())).toMatchObject({ totalMinor: 0, paidMinor: 0, dueMinor: 0 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(0);
});

test('a bill cannot expose an intermediate transfer projection as a final amount due', async () => {
  const locks = require('../../../src/services/captain-restructure-lock');
  await locks.reserve(
    db,
    { branchId: branch, license },
    {
      requestId: 'transfer-request-0001',
      actor: 'manager',
      intent: { kind: 'transfer' },
      sales: [sale],
    }
  );
  await expect(service.read(req())).rejects.toMatchObject({
    status: 409,
    message: 'This order is being updated. Please retry.',
  });
  await locks.cancel(db, { branchId: branch, license }, 'transfer-request-0001', 'manager');
  expect(await service.read(req())).toMatchObject({ totalMinor: 10500, dueMinor: 10500 });
});
