'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
let mongo, db, BaseModel, items, sales, context;
before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('quick_item_checkout');
  await mongoose.connect(process.env.MONGODB_URI);
  db = mongoose.connection.db;
  BaseModel = require('../src/models/base.model');
  BaseModel.getDb = async () => db;
  BaseModel.database = db;
  context = { branchId: String(new ObjectId()), licenseId: String(new ObjectId()),
    userId: String(new ObjectId()), userName: 'Checkout test', salesPrefix: 'Q',
    stockManagement: true, allowCounterPriceOverride: false, branchSettings: {} };
  BaseModel.currentBranch = new ObjectId(context.branchId);
  BaseModel.license = new ObjectId(context.licenseId);
  BaseModel.loggedUser = new ObjectId(context.userId);
  await db.collection('branches').insertOne({ _id: new ObjectId(context.branchId),
    license: new ObjectId(context.licenseId), branch_name: 'Quick item fixture', sales_prefix: 'Q' });
  items = new (require('../src/repositories/item.repository'))();
  sales = require('../src/services/sale.service');
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('checkout rejects a removed selling unit before saving a sale or moving stock', async () => {
  const id = new ObjectId();
  await db.collection('items').insertOne({ _id: id, license: new ObjectId(context.licenseId),
    branch_id: new ObjectId(context.branchId), name: 'Retired feet pipe', unit: 'm',
    selling_units: [], selling_price: 100, company_price: 50,
    available_quantity: 20, quantity: 20, item_status: 'active', status: 1,
    tax: 0, tax_type: 'inclusive' });
  const before = await db.collection('items').findOne({ _id: id });
  const count = await db.collection('sales').countDocuments();
  const result = await sales.processSale({ sales_total: '320', payment_mode: 'Cash',
    multi_payment: { Cash: 320 }, customer_name: 'Walk-In-Customer',
    items: [{ item_id: String(id), item_unit: 'ft', item_quantity: '10',
      item_price_total: '320', sale_inline_item_price: '32', tax: 0, tax_type: 'inclusive' }],
  }, '', 'Add', context);
  assert.equal(result.status, false);
  assert.match(result.message, /selling unit is no longer configured/);
  assert.equal(await db.collection('sales').countDocuments(), count);
  assert.deepEqual(await db.collection('items').findOne({ _id: id }), before);
});

test('create Quick Item then pay its inclusive entered price using the persisted catalogue', async () => {
  const created = await items.createInstantItem({ items_name: '2-inch pipe 2KG',
    items_quantity: 1, items_selling_price: '70', items_tax: '5', items_tax_type: 'inclusive' }, context);
  assert.equal(created.status, true, created.message);
  const stored = await db.collection('items').findOne({ name: '2-inch pipe 2KG' });
  assert.equal(stored.item_status, 'instant');
  const result = await sales.processSale({ sales_total: '70', payment_mode: 'Cash',
    multi_payment: { Cash: 70 }, customer_name: 'Walk-In-Customer',
    items: [{ item_id: String(stored._id), item_quantity: '1', item_price_total: '70',
      sale_inline_item_price: '70', tax: 5, tax_type: 'inclusive', item_status: 'instant' }],
  }, '', 'Add', context);
  assert.equal(result.status, true, JSON.stringify(result));
  const saved = await db.collection('sales').findOne({ 'items.item_id': String(stored._id) });
  assert.ok(saved, 'checkout persisted a financial sale');
  assert.equal(Number(saved.sales_total), 70);
  assert.equal(saved.items[0].pricing.source, 'quick_item');
  assert.equal(saved.items[0].pricing.selling_price, 70);
  assert.equal((await db.collection('items').findOne({ _id: stored._id })).available_quantity, 1);
});
