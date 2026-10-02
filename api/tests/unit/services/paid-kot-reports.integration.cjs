'use strict';

const { test, before: beforeAll, after: afterAll, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Base = require('../../../src/models/base.model');
Base.prototype.initializeDB = async () => {};

const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { reportableSales } = require('../../../src/helpers/reportable-sales');
const service = require('../../../src/services/sale.service');
const Dashboard = require('../../../src/models/dashboard.model');

let client, memory, db, sales, model;
const branch = new ObjectId();
const license = new ObjectId();
const date = new Date('2026-10-02T06:00:00Z');
const match = () => ({
  ...reportableSales(),
  branch_id: branch,
  license,
  date: { $gte: new Date('2026-10-01T18:30:00Z'), $lt: new Date('2026-10-02T18:30:00Z') },
});
const bill = (id, process, status, total, extra = {}) => ({
  sales_id: id,
  sale_process: process,
  payment_status: status,
  branch_id: branch,
  license,
  date,
  updated_date: date,
  sales_total: total,
  items_total: total,
  payment_mode: 'UPI',
  items: [{ item_name: id, item_quantity: 1, total, tax_amount: total / 21, tax: 5 }],
  ...extra,
});

beforeAll(async () => {
  if (!process.env.LOCAL_MONGODB_URI) memory = await MongoMemoryServer.create();
  client = await MongoClient.connect(process.env.LOCAL_MONGODB_URI || memory.getUri());
  db = client.db(`paid_kot_reports_test_${process.pid}`);
  sales = db.collection('sales');
  model = {
    aggregate: (pipeline) => sales.aggregate(pipeline).toArray(),
    find: (filter) => {
      const cursor = sales.find(filter);
      const query = {
        select: () => query,
        sort: (value) => {
          cursor.sort(value);
          return query;
        },
        skip: (value) => {
          cursor.skip(value);
          return query;
        },
        limit: (value) => {
          cursor.limit(value);
          return query;
        },
        lean: () => cursor.toArray(),
      };
      return query;
    },
    countDocuments: (filter) => sales.countDocuments(filter),
  };
});
afterAll(async () => {
  if (db) await db.dropDatabase();
  if (client) await client.close();
  if (memory) await memory.stop();
});
beforeEach(async () => {
  await sales.deleteMany({});
  await sales.insertMany([
    bill('posted', 'Edit', 'Paid', 8283),
    bill('paid-kot', 'KOT', 'Paid', 36951, { items_total: 1 }),
    bill('open', 'KOT', 'Unpaid', 5176.5),
    bill('cancelled', 'cancelled', 'Cancelled', 6205.5),
    bill('hold', 'Hold', 'Paid', 100),
    bill('partial-kot', 'KOT', 'Partialy Paid', 200),
    bill('other-branch', 'KOT', 'Paid', 999, { branch_id: new ObjectId() }),
    bill('other-license', 'KOT', 'Paid', 999, { license: new ObjectId() }),
    bill('yesterday', 'KOT', 'Paid', 999, { date: new Date('2026-10-01T18:29:59Z') }),
  ]);
});

test('day-end items, taxes and tenders include settled KOTs without changing sales', async () => {
  const result = await service.getDailySalesReportAggregates(
    { match: match(), cancellationMatch: { _id: null } },
    { SaleModel: model }
  );
  assert.equal(
    result.productAgg.reduce((sum, row) => sum + row.totalAmount, 0),
    45234
  );
  assert.deepEqual(result.paymentAgg, [{ _id: 'UPI', total: 45234 }]);
  assert.ok(
    Math.abs(result.taxAgg.reduce((sum, row) => sum + row.tax_amount, 0) - 45234 / 21) < 0.005
  );
  assert.deepEqual(result.salesPayments.map((row) => row.sales_id).sort(), ['paid-kot', 'posted']);
  assert.equal((await sales.findOne({ sales_id: 'paid-kot' })).sale_process, 'KOT');
});

test('PDF uses the same paid total and split tender amounts', async () => {
  await sales.updateOne(
    { sales_id: 'paid-kot' },
    {
      $set: { multi_payment: { Cash: 1000, Card: 35951 }, payment_mode: 'Cash,Card' },
    }
  );
  const result = await service.getDailyReportPdfAggregates(
    { match: match() },
    { SaleModel: model }
  );
  assert.equal(
    result.productAgg.reduce((sum, row) => sum + row.totalAmount, 0),
    45234
  );
  assert.deepEqual(Object.fromEntries(result.paymentAgg.map((row) => [row._id, row.total])), {
    Cash: 1000,
    Card: 35951,
    UPI: 8283,
  });
});

test('dashboard payment totals agree with day-end and preserve split tenders', async () => {
  const dashboard = new Dashboard();
  dashboard.branchId = branch;
  dashboard.licenseId = license;
  dashboard.getCollection = async (name) => db.collection(name);
  const result = await dashboard.getDashboardPaymentModeDataModel({
    starting_date: '2026/10/02 12:00 AM',
    ending_date: '2026/10/02 11:59 PM',
  });
  assert.equal(result.status, true);
  assert.equal(result.data.total_amount, 45234);
  await sales.updateOne(
    { sales_id: 'paid-kot' },
    { $set: { multi_payment: { Cash: 1000, Card: 35951 } } }
  );
  const split = await dashboard.getDashboardPaymentModeDataModel({
    starting_date: '2026/10/02 12:00 AM',
    ending_date: '2026/10/02 11:59 PM',
  });
  assert.equal(await dashboard.sumCollectionField('sales', match(), 'items_total'), 45234);
  assert.deepEqual(
    Object.fromEntries(split.data.paymode_data.map((row) => [row.payment_mode, row.amount])),
    { Cash: 1000, Card: 35951, UPI: 8283 }
  );
});

test('legacy credit and partial-return sales retain their report semantics; cancelled never counts', async () => {
  await sales.insertMany([
    bill('credit', 'Add', 'Pending', 100),
    bill('return', 'PartialReturn', 'Paid', 50),
    bill('cancelled-edit', 'Edit', 'Cancelled', 400),
    bill('full-return', 'FullReturn', 'Paid', 75),
  ]);
  const ids = (await sales.find(match()).toArray()).map((row) => row.sales_id).sort();
  assert.deepEqual(ids, ['credit', 'paid-kot', 'posted', 'return']);
  assert.equal(
    await sales.countDocuments({ ...reportableSales(['FullReturn']), sales_id: 'full-return' }),
    1
  );
});

test('report-specific OR filters cannot overwrite the paid-KOT condition', async () => {
  const filter = { ...match(), $or: [{ sales_id: 'paid-kot' }, { sales_id: 'open' }] };
  assert.deepEqual(
    (await sales.find(filter).toArray()).map((row) => row.sales_id),
    ['paid-kot']
  );
});

test('payment transactions include desktop KOTs but not unrecorded guest-check allocations', async () => {
  await sales.insertMany([
    bill('unrecorded-transfer', 'KOT', 'Paid', 500, {
      captain_transfer_allocation: {},
      captain_payments: [],
    }),
    bill('recorded-transfer', 'KOT', 'Paid', 600, {
      captain_transfer_allocation: {},
      captain_payments: [{ amount: 600 }],
      paid_amount: 600,
    }),
  ]);
  const repository = require('../../../src/repositories/sale.repository');
  const { runWithRequestContext } = require('../../../src/utils/request-context');
  const result = await runWithRequestContext({ license, currentBranch: branch }, () =>
    repository.paymentSalesTransactionReportPage(
      {
        branchid: [String(branch)],
        starting_date: '2026/10/02 12:00 AM',
        ending_date: '2026/10/02 11:59 PM',
      },
      { limit: 50 },
      { SaleModel: model }
    )
  );
  assert.equal(result.status, true);
  assert.deepEqual(result.data.list.map((row) => row.sales_id).sort(), [
    'paid-kot',
    'posted',
    'recorded-transfer',
  ]);
});

test('saved final total wins over stale aliases, preserving zero and legacy-only totals', async () => {
  await sales.deleteMany({});
  await sales.insertMany([
    { sales_total: 0, total: 900, items_total: 900 },
    { sales_total: 120, total: 110, items_total: 100 },
    { total: 50 },
    { items_total: 30 },
  ]);
  const { reportSaleTotal } = require('../../../src/helpers/reportable-sales');
  const [row] = await sales
    .aggregate([{ $group: { _id: null, amount: { $sum: reportSaleTotal() } } }])
    .toArray();
  assert.equal(row.amount, 200);
});
