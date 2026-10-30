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

test('partial and full returns use remaining totals without changing original invoices', async () => {
  await Model.insertMany([
    {
      sale_process: 'PartialReturn',
      sales_total: 315,
      items_total: 210,
      payment_status: 'Paid',
      payment_mode: 'Cash',
    },
    {
      sale_process: 'FullReturn',
      sales_total: 100,
      items_total: 0,
      payment_status: 'Paid',
      payment_mode: 'Cash',
    },
  ]);
  const value = await summary(Model, {});
  expect(value.currencies[0].total).toBe(210);
  expect(value.currencies[0].payments).toEqual([{ method: 'Cash', amount: 210 }]);
  expect((await Model.findOne({ sale_process: 'PartialReturn' })).sales_total).toBe(315);
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
test('only paid bills contribute totals and tenders, while currencies remain separate', async () => {
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
  expect(value.count).toBe(2);
  expect(value.currencies).toHaveLength(2);
  expect(value.currencies[0].total).toBe(100);
  expect(value.currencies[0].payments).toEqual([
    { method: 'Cash', amount: 30 },
    { method: 'UPI', amount: 70 },
  ]);
  expect(value.currencies[1].total).toBe(10.125);
});
test('empty filter result has no stale totals', async () => {
  expect(await summary(Model, {})).toEqual({ count: 0, cancelled: 0, currencies: [] });
});

test('cancelled status overrides Paid and unknown or partial statuses never inflate paid sales', async () => {
  await Model.insertMany([
    { sales_total: 100, payment_status: 'Paid', sale_process: 'Cancelled', payment_mode: 'Cash' },
    { sales_total: 200, payment_status: 'Paid', status: 'cancelled', payment_mode: 'Upi' },
    { sales_total: 300, payment_status: 'Partially Paid', paid_amount: 100, payment_mode: 'Card' },
    { sales_total: 400, payment_mode: 'Cash' },
    { sales_total: 50, payment_status: 'Paid', payment_mode: 'Cash' },
  ]);
  const value = await summary(Model, {});
  expect(value.count).toBe(1);
  expect(value.cancelled).toBe(2);
  expect(value.currencies[0].total).toBe(50);
  expect(value.currencies[0].payments).toEqual([{ method: 'Cash', amount: 50 }]);
});

test('legacy desktop card and Captain card payments are combined under Card', async () => {
  await Model.insertMany([
    { sales_total: 100, payment_status: 'Paid', payment_mode: 'CreditCard' },
    { sales_total: 50, payment_status: 'Paid', captain_payments: [{ method: 'card', amount: 50 }] },
    { sales_total: 75, payment_status: 'Paid', multi_payment: { CreditCard: 50, Cash: 25 } },
  ]);
  const value = await summary(Model, {});
  expect(value.currencies[0].total).toBe(225);
  expect(value.currencies[0].payments).toEqual([
    { method: 'Card', amount: 200 },
    { method: 'Cash', amount: 25 },
  ]);
});
