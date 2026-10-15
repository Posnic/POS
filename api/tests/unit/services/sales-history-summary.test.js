'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const summary = require('../../../src/services/sales-history-summary');
let server, connection, Model;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  connection = await mongoose.createConnection(server.getUri()).asPromise();
  Model = connection.model('HistorySummaryProof', new mongoose.Schema({}, { strict: false }));
});
afterAll(async () => {
  await connection.close();
  await server.stop();
});
beforeEach(async () => {
  await Model.deleteMany({});
});
test('all matching sales are counted regardless of page, with branch/date/search isolation and cancelled excluded', async () => {
  const date = new Date('2026-10-15T10:00:00Z');
  await Model.insertMany([
    ...Array.from({ length: 30 }, () => ({
      branch_id: 'a',
      date,
      customer_name: 'Sam',
      sales_total: 10.1,
      payment_status: 'Paid',
      payment_mode: 'Cash',
    })),
    { branch_id: 'b', date, sales_total: 900 },
    { branch_id: 'a', date: new Date('2025-01-01'), sales_total: 800 },
    { branch_id: 'a', date, customer_name: 'Other', sales_total: 700 },
    { branch_id: 'a', date, customer_name: 'Sam', sales_total: 600, payment_status: 'Cancelled' },
  ]);
  const value = await summary(Model, {
    branch_id: 'a',
    date: { $gte: new Date('2026-10-15') },
    customer_name: 'Sam',
  });
  expect(value.count).toBe(30);
  expect(value.cancelled).toBe(1);
  expect(value.currencies[0].total).toBe(303);
  expect(value.currencies[0].payments).toEqual([{ method: 'Cash', amount: 303 }]);
});
test('split payments are counted once, credit is not cash, partial collections use actual amounts and currencies remain separate', async () => {
  await Model.insertMany([
    {
      sales_total: 100,
      payment_status: 'Paid',
      multi_payment: { Cash: 30, Upi: 70 },
      captain_payments: [
        { method: 'Cash', amount: 30 },
        { method: 'Upi', amount: 70 },
      ],
    },
    { sales_total: 50, payment_status: 'Unpaid', payment_mode: 'Cash' },
    { sales_total: 80, partial_check: true, partial_balance: 20, payment_mode: 'Card' },
    {
      sales_total: 10.125,
      currencyCode: 'KWD',
      currencyDigits: 3,
      payment_status: 'Paid',
      payment_mode: 'Voucher',
    },
  ]);
  const value = await summary(Model, {});
  expect(value.count).toBe(4);
  expect(value.currencies).toHaveLength(2);
  expect(value.currencies[0].total).toBe(230);
  expect(value.currencies[0].payments).toEqual([
    { method: 'Card', amount: 20 },
    { method: 'Cash', amount: 30 },
    { method: 'UPI', amount: 70 },
  ]);
  expect(value.currencies[1].total).toBe(10.125);
});
test('empty filter result has no stale totals', async () => {
  expect(await summary(Model, {})).toEqual({ count: 0, cancelled: 0, currencies: [] });
});
