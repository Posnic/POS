'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
let mongo, server, db, origin, dbSpy, numberSpy, item, previousKey;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('anonymous-order-integrity'));
  db = mongoose.connection.db;
  BaseModel.database = db;
  dbSpy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  let receipt = 0;
  numberSpy = jest
    .spyOn(repo, 'generateSalesIdForBranch')
    .mockImplementation(async () => `TEST-${++receipt}`);
  const branch = new ObjectId();
  const license = new ObjectId();
  item = new ObjectId();
  await db.collection('branches').insertOne({
    _id: branch,
    license,
    name: 'Security regression test',
    online_ordering: { store_id: 'TESTSHOP', mode: 'order' },
  });
  await db.collection('items').insertOne({
    _id: item,
    branch_id: branch,
    license,
    name: 'Test item',
    selling_price: 100,
    tax: 0,
    tax_type: 'exclusive',
  });
  previousKey = process.env.KIOSK_API_KEY;
  process.env.KIOSK_API_KEY = 'local-regression-only';
  const app = express();
  app.use(express.json());
  app.use('/api/online-ordering', require('../../../src/routes/online-ordering.routes'));
  const { protectOrKioskKey } = require('../../../src/middleware/kiosk-key');
  const controller = require('../../../src/controllers/sales.controller');
  app.post('/api/sales/qrOrder', protectOrKioskKey, controller.qrOrder.bind(controller));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  dbSpy?.mockRestore();
  numberSpy?.mockRestore();
  if (previousKey === undefined) delete process.env.KIOSK_API_KEY;
  else process.env.KIOSK_API_KEY = previousKey;
  await mongoose.disconnect();
  await mongo?.stop();
});

async function post(path, body, headers = {}) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test.each(['paid', 'completed', ' PAID ', 'cash'])(
  'anonymous HTTP order persists Unpaid at full price despite %s and a forged discount',
  async (payment_status) => {
    const idempotencyKey = `public-${payment_status}`;
    const payload = {
      branch: 'ignored-body-branch',
      items: [{ item_id: String(item), item_quantity: 1 }],
      payment_status,
      kiosk_discount_amount: 99999,
      trustedCheckout: true,
      staffOrder: true,
      idempotencyKey,
    };
    const first = await post('/api/online-ordering/TESTSHOP/orders', payload);
    if (first.status !== 200) throw new Error(JSON.stringify(first));
    expect(first.status).toBe(200);
    expect(first.body.type).toBe('success');
    expect(await db.collection('sales').findOne({ idempotency_key: idempotencyKey })).toMatchObject(
      { payment_status: 'Unpaid', total: 100, extra_discount: 0 }
    );
    const retry = await post('/api/online-ordering/TESTSHOP/orders', payload);
    expect(retry.body.data.sale_id).toBe(first.body.data.sale_id);
    expect(await db.collection('sales').countDocuments({ idempotency_key: idempotencyKey })).toBe(
      1
    );
  }
);

test('checkout rejects missing or wrong keys; verified kiosk retains explicit payment', async () => {
  const payload = {
    branch: 'TESTSHOP',
    items: [{ item_id: String(item), item_quantity: 1 }],
    payment_status: 'paid',
    kiosk_discount_amount: 10,
    idempotencyKey: 'kiosk',
  };
  expect((await post('/api/sales/qrOrder', payload)).status).toBe(401);
  expect((await post('/api/sales/qrOrder', payload, { kioskkey: 'wrong' })).status).toBe(401);
  expect(await db.collection('sales').countDocuments({ idempotency_key: 'kiosk' })).toBe(0);
  const accepted = await post('/api/sales/qrOrder', payload, { kioskkey: 'local-regression-only' });
  if (accepted.status !== 200) throw new Error(JSON.stringify(accepted));
  expect(accepted.status).toBe(200);
  expect(await db.collection('sales').findOne({ idempotency_key: 'kiosk' })).toMatchObject({
    payment_status: 'Paid',
    total: 90,
    extra_discount: 10,
  });
});
