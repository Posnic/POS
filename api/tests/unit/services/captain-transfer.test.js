'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const service = require('../../../src/services/captain-transfer');
let server, db, branch, license, sale;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-transfer'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId(); license = new ObjectId();
  const product = new ObjectId();
  sale = { _id: new ObjectId(), branch_id: branch, license, sale_process: 'KOT', payment_status: 'Unpaid',
    table_number: '1', sales_sub_total: 100, sales_total: 105, tax: 5,
    items: [{ item_id: product, item_name: 'Corn', item_quantity: 2, item_base_price: 50, item_tax: 5 }],
    changes: [{ timestamp: new Date(), items: [{ item_id: product, item_name: 'Corn', item_quantity: 2, process: 'add' }] }] };
  await db.collection('branches').insertOne({ _id: branch, license, currencyCode: 'INR' });
  await db.collection('sales').insertOne(sale);
});
const req = () => ({ db, user: { _id: new ObjectId(), role: 'staff', access: { sales: { write: true, merge: true } } },
  tenantContext: { branchId: branch, licenseId: license }, body: { orderId: String(sale._id), items: [{ id: 'c0i0', quantity: 1 }] } });
test('preview conserves money and makes no sale, kitchen, stock or journal writes', async () => {
  const before = await db.collection('sales').findOne({ _id: sale._id });
  const result = await service.preview(req());
  expect(result.source.totalMinor + result.destination.totalMinor).toBe(10500);
  expect(result.sourceId).toBe(String(sale._id));
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await db.collection('sales').findOne({ _id: sale._id })).toEqual(before);
  expect((await db.listCollections().toArray()).map(row => row.name).sort()).toEqual(['branches', 'sales']);
});
test.each(['write', 'merge'])('preview requires sales %s permission', async permission => {
  const input = req(); input.user.access.sales[permission] = false;
  await expect(service.preview(input)).rejects.toMatchObject({ status: 403 });
});
test.each(['branch_id', 'license'])('preview never reads another %s even if the body claims its scope', async field => {
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { [field]: new ObjectId() } });
  const input = req(); input.body[field] = sale[field];
  await expect(service.preview(input)).rejects.toMatchObject({ status: 409 });
});
test.each([{ payment_status: 'Paid' }, { payment_status: 'Partial' }, { captain_payment_plan: 'reserved' },
  { captain_payment_plan: null }, { floor_closed_at: new Date() }, { order_state: 'pending' },
  { sale_process: 'cancelled' }, { captain_edit_until: new Date(Date.now() + 60000) }])(
  'preview rejects unavailable order state %j', async changed => {
    await db.collection('sales').updateOne({ _id: sale._id }, { $set: changed });
    await expect(service.preview(req())).rejects.toMatchObject({ status: 409 });
  });
test('preview revision changes when another staff member serves an item', async () => {
  const first = await service.preview(req());
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { kitchen_service: { c0i0: { quantity: 1 } } } });
  const input = req(); input.body.items[0].servedQuantity = 1;
  const next = await service.preview(input);
  expect(next.revision).not.toBe(first.revision);
  expect(next.destination.rounds[0].served).toBe(1);
});
