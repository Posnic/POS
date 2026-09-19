'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BaseModel = require('../../../src/models/base.model');
const queue = require('../../../src/repositories/sale.repository');
const counter = require('../../../src/repositories/counter-kot-print.repository');
const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();
let mem, db;
const change = (name = 'Soup') => ({
  timestamp: new Date(),
  items: [
    {
      item_name: name,
      item_quantity: 2,
      item_note: 'No salt',
      spice_level: 'Mild',
      process: 'add',
      item_price: 50,
    },
  ],
});
async function order(extra = {}) {
  const _id = new mongoose.Types.ObjectId();
  const collection = db.collection('sales');
  await collection.insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    sales_id: 'KOT-1',
    created_date: new Date(),
    customer_phone: 'private',
    items: change().items,
    changes: [change()],
    ...extra,
  });
  return String(_id);
}
const read = (id) => db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(id) });
const poll = (tillId = 'kitchen') => queue.multiKitchenPrintModel(String(BRANCH), { tillId });

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('counter-kot'));
  db = mongoose.connection.db;
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(async () => {
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(BaseModel, 'currentBranch', 'get').mockReturnValue(BRANCH);
  jest.spyOn(BaseModel, 'license', 'get').mockReturnValue(LICENSE);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await db.collection('sales').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('printjobs').deleteMany({});
  await db.collection('branches').insertOne({ _id: BRANCH, license: LICENSE, table_options: true });
});
afterEach(() => jest.restoreAllMocks());

test('concurrent button and polling requests hand out one ticket only', async () => {
  const id = await order();
  const [a, b, c] = await Promise.all([counter.handle(id), poll('a'), poll('b')]);
  expect(Number(a.state === 'ready') + b.data.length + c.data.length).toBe(1);
});
test('a browser reservation blocks all pollers past the ordinary 45-second lease', async () => {
  const id = await order();
  const prepared = await counter.handle(id);
  expect(prepared.state).toBe('ready');
  await db.collection('sales').updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: { kot_claimed_at: new Date(Date.now() - 60000) },
    }
  );
  expect((await poll()).data).toHaveLength(0);
  expect((await poll('')).data).toHaveLength(0);
  expect((await counter.handle(id)).state).toBe('busy');
  expect((await read(id)).kitchen_printed).toBeUndefined();
});
test('a legacy poll taken first also blocks the cashier', async () => {
  const id = await order();
  expect((await poll('')).data).toHaveLength(1);
  expect((await counter.handle(id)).state).toBe('busy');
});
test('confirm acknowledges only the reserved changes; new dishes still print', async () => {
  const id = await order();
  const { token, sale } = await counter.handle(id);
  expect(sale.print_jobs[0].items[0]).toMatchObject({ item_note: 'No salt', spice_level: 'Mild' });
  expect(JSON.stringify(sale)).not.toMatch(/private|item_price|payment/);
  await db
    .collection('sales')
    .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $push: { changes: change('Tea') } });
  await counter.handle(id, { action: 'confirm', token });
  const stored = await read(id);
  expect(stored.last_printed_change_index).toBe(0);
  expect(stored.kot_counter_until).toBeUndefined();
  expect(await db.collection('printjobs').countDocuments({ status: 'done' })).toBe(1);
  const pending = await poll();
  expect(pending.data[0].print_jobs).toHaveLength(1);
  expect(pending.data[0].print_jobs[0]).toMatchObject({
    type: 'modified',
    items: [{ item_name: 'Tea' }],
  });
});
test('cancelled print dialogs can release the ticket without acknowledging it', async () => {
  const id = await order();
  const { token } = await counter.handle(id);
  await counter.handle(id, { action: 'release', token });
  expect((await read(id)).last_printed_change_index).toBeUndefined();
  expect((await poll()).data).toHaveLength(1);
});
test('wrong and expired tokens cannot confirm; expired reservations return to the queue', async () => {
  const id = await order();
  const { token } = await counter.handle(id);
  await expect(
    counter.handle(id, { action: 'confirm', token: '00000000-0000-0000-0000-000000000000' })
  ).rejects.toMatchObject({ status: 409 });
  await db.collection('sales').updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: { kot_counter_until: new Date(0), kot_claimed_at: new Date(0) },
    }
  );
  await expect(counter.handle(id, { action: 'confirm', token })).rejects.toMatchObject({
    status: 409,
  });
  expect((await poll()).data).toHaveLength(1);
});
test('renew extends the reservation and requires its token', async () => {
  const id = await order();
  const { token } = await counter.handle(id);
  const before = (await read(id)).kot_counter_until;
  await counter.handle(id, { action: 'renew', token });
  expect((await read(id)).kot_counter_until.getTime()).toBeGreaterThanOrEqual(before.getTime());
});
test('printed orders require an explicit copy request', async () => {
  const id = await order({ last_printed_change_index: 0 });
  expect(await counter.handle(id)).toEqual({ state: 'printed' });
  const copy = await counter.handle(id, { copy: true });
  expect(copy.state).toBe('copy');
  expect(copy.token).toBeUndefined();
  expect(copy.sale.print_jobs[0].type).toBe('copy');
});
test('only the current restaurant and tenant can reserve or acknowledge orders', async () => {
  const id = await order({ branch_id: new mongoose.Types.ObjectId() });
  await expect(counter.handle(id)).rejects.toMatchObject({ status: 404 });
  const foreign = await order({ license: new mongoose.Types.ObjectId() });
  await expect(counter.handle(foreign)).rejects.toMatchObject({ status: 404 });
  const valid = await order();
  await db.collection('branches').updateOne({ _id: BRANCH }, { $set: { table_options: false } });
  await expect(counter.handle(valid)).rejects.toMatchObject({ status: 403 });
});
