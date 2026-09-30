'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const service = require('../../../src/services/captain-transfer');
const restructure = require('../../../src/services/captain-restructure-lock');
let server, db, branch, license, sale;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-transfer'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });
afterEach(() => jest.restoreAllMocks());
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

async function confirmation() {
  const input = req();
  input.body.revision = (await service.preview(input)).revision;
  input.body.requestId = 'transfer-confirmation-0001';
  return input;
}
test('reservation fences the source without moving food, charging, stock or KOT effects', async () => {
  const input = await confirmation();
  const before = await db.collection('sales').findOne({ _id: sale._id });
  const result = await service.reserve(input);
  expect(result.journal.stage).toBe('reserved');
  expect(result.projection.preview.revision).toBe(input.body.revision);
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.captain_payment_plan).toBe(result.journal._id);
  delete stored.captain_payment_plan;
  expect(stored).toEqual(before);
  expect(await db.collection('sales').countDocuments()).toBe(1);
  expect((await db.listCollections().toArray()).map(row => row.name).sort()).toEqual(['branches', 'captain_payment_plans', 'sales']);
});
test('lost reservation acknowledgement retries the same snapshot, currency and history timestamp', async () => {
  const input = await confirmation(), original = restructure.reserve;
  let accepted;
  jest.spyOn(restructure, 'reserve').mockImplementationOnce(async (...args) => {
    accepted = await original(...args);
    throw new Error('Lost acknowledgement');
  });
  await expect(service.reserve(input)).rejects.toThrow('Lost acknowledgement');
  await db.collection('branches').updateOne({ _id: branch }, { $set: { currencyCode: 'JPY', currencyDigits: 0 } });
  const result = await service.reserve(input), repeat = await service.reserve(input);
  expect(result.journal._id).toBe(accepted._id);
  expect(result.projection.preview.currencyCode).toBe('INR');
  expect(result.projection.preview.totalMinor).toBe(10500);
  expect(repeat.projection).toEqual(result.projection);
  expect(result.projection.source.changes.at(-1).timestamp).toBe(accepted.createdAt.toISOString());
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(1);
});
test.each(['items', 'revision', 'orderId'])('retry cannot replace the original transfer %s', async field => {
  const input = await confirmation();
  const first = await service.reserve(input);
  input.body[field] = field === 'items' ? [{ id: 'c0i0', quantity: 2 }] : field === 'revision' ? 'a'.repeat(64) : String(new ObjectId());
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBe(first.journal._id);
});
test('another staff member cannot resume a reserved transfer', async () => {
  const input = await confirmation();
  await service.reserve(input);
  input.user._id = new ObjectId();
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
});
test('a competing transfer cannot reserve the same source until the first is cancelled', async () => {
  const input = await confirmation(), competitor = await confirmation();
  competitor.body.requestId = 'transfer-confirmation-0002';
  const first = await service.reserve(input);
  await expect(service.reserve(competitor)).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(1);
  await restructure.cancel(db, { branchId: branch, license }, input.body.requestId, input.user._id);
  const second = await service.reserve(competitor);
  expect(second.journal._id).not.toBe(first.journal._id);
  expect(second.projection.preview.revision).toBe(input.body.revision);
});
test('resuming a reservation still requires current sales permission', async () => {
  const input = await confirmation();
  await service.reserve(input);
  input.user.access.sales.merge = false;
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 403 });
});
test('cancelled reservation releases the source and cannot be resurrected', async () => {
  const input = await confirmation();
  await service.reserve(input);
  await restructure.cancel(db, { branchId: branch, license }, input.body.requestId, input.user._id);
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test('changed preview is rejected before acquiring a reservation', async () => {
  const input = await confirmation();
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { person_count: 4 } });
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(0);
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test('a source changed between validation and reservation is rejected by the atomic fence', async () => {
  const input = await confirmation(), original = restructure.reserve;
  jest.spyOn(restructure, 'reserve').mockImplementationOnce(async (...args) => {
    await db.collection('sales').updateOne({ _id: sale._id }, { $set: { person_count: 7 } });
    return original(...args);
  });
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.person_count).toBe(7);
  expect(stored.captain_payment_plan).toBeUndefined();
  expect((await db.collection('captain_payment_plans').findOne({})).stage).toBe('cancelled');
});
test('preview revision changes when another staff member serves an item', async () => {
  const first = await service.preview(req());
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { kitchen_service: { c0i0: { quantity: 1 } } } });
  const input = req(); input.body.items[0].servedQuantity = 1;
  const next = await service.preview(input);
  expect(next.revision).not.toBe(first.revision);
  expect(next.destination.rounds[0].served).toBe(1);
});

test.each([['table_number','2'],['table_id','new-table'],['person_count',4],['dine_type','Take away'],
  ['seating_request_id','changed-request'],['seating_primary_id','new-primary'],
  ['seating_table_ids',['new-primary']],['seating_capacity_revision','changed-capacity']])(
  'preview revision detects a changed %s without relying on updated_date', async (field,value) => {
    const first = await service.preview(req());
    await db.collection('sales').updateOne({ _id:sale._id }, { $set:{ [field]:value } });
    const next = await service.preview(req());
    expect(next.revision).not.toBe(first.revision);
    expect(next.totalMinor).toBe(first.totalMinor);
    expect(next.destination.lines).toEqual(first.destination.lines);
  });
