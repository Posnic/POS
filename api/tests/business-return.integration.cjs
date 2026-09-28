'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { saleContribution, businessDate } = require('../src/services/business-metrics');
let mongo, client, db, BaseModel, repository;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  process.env.MONGODB_URI = mongo.getUri('business_returns');
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db('business_returns');
  BaseModel = require('../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = client;
  BaseModel._connectedUri = process.env.MONGODB_URI;
  repository = require('../src/repositories/sale.repository');
});
after(async () => {
  await require('mongoose').disconnect();
  if (BaseModel?.mongoClient && BaseModel.mongoClient !== client)
    await BaseModel.mongoClient.close();
  await client?.close();
  await mongo?.stop();
});
async function returned({
  amount = 100,
  quantity = 2,
  returnedQuantity = 1,
  extra = 0,
  roundOff = false,
  original = amount * quantity,
} = {}) {
  const license = new ObjectId(),
    branchId = new ObjectId(),
    itemId = new ObjectId(),
    saleId = new ObjectId();
  BaseModel.license = license;
  BaseModel.currentBranch = branchId;
  BaseModel.loggedUser = new ObjectId();
  BaseModel.loggedUserName = 'Test manager';
  await db
    .collection('branches')
    .insertOne({ _id: branchId, license, currency: 'INR', time_zone: 'Asia/Kolkata' });
  await db
    .collection('items')
    .insertOne({
      _id: itemId,
      license,
      item_name: 'Test item',
      available_quantity: 10,
      company_price: 20,
    });
  const line = {
    item_id: String(itemId),
    item_name: 'Test item',
    item_quantity: quantity,
    item_price: amount,
    total_amount: amount * quantity,
    tax: 0,
    tax_type: 'inclusive',
  };
  const invoiceDate = new Date(Date.now() - 7 * 86400000);
  await db
    .collection('sales')
    .insertOne({
      _id: saleId,
      license,
      branch_id: branchId,
      sale_process: 'Add',
      payment_status: 'Paid',
      date: invoiceDate,
      updated_date: invoiceDate,
      sales_total: original,
      extra_discount: extra,
      items: [line],
      items_return: [],
      items_return_total: 0,
    });
  const result = await repository.returnSalesOrder({
    sales_id: String(saleId),
    items:
      quantity > returnedQuantity
        ? [
            {
              ...line,
              item_quantity: quantity - returnedQuantity,
              total_amount: amount * (quantity - returnedQuantity),
            },
          ]
        : [],
    items_return: [
      { ...line, item_quantity: returnedQuantity, total_amount: amount * returnedQuantity },
    ],
    extra_discount: extra,
    extra_discount_type: 'percent',
    round_off_check: roundOff,
    print: false,
  });
  assert.equal(result.status, true, JSON.stringify(result));
  const stored = await db.collection('sales').findOne({ _id: saleId });
  return {
    result,
    stored,
    branch: {
      id: String(branchId),
      license: String(license),
      currency: 'INR',
      currencyDigits: 2,
      timezone: 'Asia/Kolkata',
    },
  };
}
test('actual partial/full return writes reconcile with Business and preserve the original invoice day', async () => {
  for (const returnedQuantity of [1, 2]) {
    const f = await returned({ returnedQuantity });
    assert.equal(f.stored.sales_total, 200);
    assert.equal(f.stored.items_return_total, returnedQuantity * 100);
    const entries = saleContribution(f.stored, f.branch).entries;
    assert.equal(entries[0].billedSalesMinor, 20000);
    assert.equal(entries[1].businessDate, businessDate(new Date(), f.branch.timezone));
    assert.equal(entries[1].refundsMinor, returnedQuantity * 10000);
  }
});
test('actual return rounding reconciles, including a fully discounted zero-value return', async () => {
  const rounded = await returned({ amount: 18.75, roundOff: true });
  assert.equal(rounded.result.data.return_amount, 18.75);
  assert.equal(saleContribution(rounded.stored, rounded.branch).entries[1].refundsMinor, 1875);
  const free = await returned({ quantity: 1, returnedQuantity: 1, extra: 100, original: 0 });
  assert.equal(free.result.data.return_amount, 0);
  assert.equal(free.stored.items_return_total, 0);
  assert.equal(saleContribution(free.stored, free.branch).entries[1].refundsMinor, 0);
});
