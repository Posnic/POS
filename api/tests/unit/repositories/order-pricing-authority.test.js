'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');
let mem, db;
const branch = new mongoose.Types.ObjectId();
const license = new mongoose.Types.ObjectId();
let product, order;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  for (const collection of ['branches', 'items', 'sales'])
    await db.collection(collection).deleteMany({});
  await db.collection('branches').insertOne({ _id: branch, license });
  product = {
    _id: new mongoose.Types.ObjectId(),
    branch_id: branch,
    license,
    name: 'Paratha',
    selling_price: 45,
    tax: 5,
    tax_type: 'exclusive',
  };
  await db.collection('items').insertOne(product);
  order = {
    _id: new mongoose.Types.ObjectId(),
    branch_id: branch,
    license,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    items: [],
    changes: [],
    updated_date: new Date(),
  };
  await db.collection('sales').insertOne(order);
});
afterEach(() => jest.restoreAllMocks());
const save = (items) =>
  repo.updateOrderModel(
    String(order._id),
    items,
    99999,
    'modified',
    null,
    null,
    null,
    undefined,
    undefined,
    undefined
  );
const line = (price, qty = 2) => ({ product_id: String(product._id), price, quantity: qty });
const stored = () => db.collection('sales').findOne({ _id: order._id });

test('the production double-tax submission is rejected without changing the order', async () => {
  expect(await save([line(47.25)])).toMatchObject({
    status: false,
    data: { state: 'item_price_mismatch' },
  });
  expect(await stored()).toEqual(order);
});
test('request-owned variable flags and pricing snapshots cannot authorize an override', async () => {
  expect(
    (await save([{ ...line(100), open_price: true, pricing: { version: 1, selling_price: 100 } }]))
      .status
  ).toBe(false);
  expect(await stored()).toEqual(order);
});
test('new fixed items get one tax calculation and authoritative totals', async () => {
  expect(await save([line(45)])).toMatchObject({ status: true });
  expect(await stored()).toMatchObject({
    sales_sub_total: 90,
    tax: 4.5,
    sales_total: 94.5,
    items: [
      expect.objectContaining({
        unit_price: 45,
        total: 94.5,
        pricing: expect.objectContaining({ source: 'catalogue' }),
      }),
    ],
  });
});
test('a bad second line cannot partially add the first', async () => {
  expect(
    (
      await save([
        { ...line(45), line_id: 'first' },
        { ...line(47.25), line_id: 'second' },
      ])
    ).status
  ).toBe(false);
  expect(await stored()).toEqual(order);
});
test('existing snapshots preserve agreed tax and price but reject a submitted override', async () => {
  expect((await save([line(45)])).status).toBe(true);
  await db
    .collection('items')
    .updateOne({ _id: product._id }, { $set: { selling_price: 60, tax: 18 } });
  expect((await save([line(45, 3)])).status).toBe(true);
  expect(await stored()).toMatchObject({ sales_sub_total: 135, tax: 6.75, sales_total: 141.75 });
  const before = await stored();
  expect((await save([line(60, 3)])).status).toBe(false);
  expect(await stored()).toEqual(before);
});
test('inclusive new and existing lines never accumulate tax', async () => {
  await db
    .collection('items')
    .updateOne({ _id: product._id }, { $set: { selling_price: 30, tax_type: 'inclusive' } });
  expect((await save([line(30)])).status).toBe(true);
  expect(await stored()).toMatchObject({ sales_total: 60, tax: 2.86 });
  const current = (await stored()).items[0];
  expect((await save([{ ...current, price: current.unit_price, quantity: 3 }])).status).toBe(true);
  expect(await stored()).toMatchObject({ sales_total: 90, tax: 4.29 });
});
test('a legacy inflated line cannot silently acquire a validated snapshot', async () => {
  await db.collection('sales').updateOne(
    { _id: order._id },
    {
      $set: {
        items: [{ item_id: product._id, item_quantity: 2, item_price: 47.25, unit_price: 47.25 }],
      },
    }
  );
  expect((await save([line(47.25)])).status).toBe(false);
  expect((await stored()).items[0].pricing).toBeUndefined();
});
test('variable and quick-item prices are accepted only from catalogue-marked products', async () => {
  for (const mode of [{ open_price: true }, { item_status: 'instant' }]) {
    await db.collection('items').updateOne({ _id: product._id }, { $set: mode });
    await db
      .collection('sales')
      .updateOne({ _id: order._id }, { $set: { items: [], changes: [] } });
    expect((await save([line(100, 1)])).status).toBe(true);
    expect(await stored()).toMatchObject({ sales_total: 105 });
  }
});
