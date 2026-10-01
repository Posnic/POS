'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { runStockBatch } = require('../src/services/extension-stock-journal');
const { allocateForSale } = require('../src/services/extension-stock-allocations');
let mongo, client, db, BaseModel, mongoose, service;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  process.env.MONGODB_URI = mongo.getUri('extension_sale');
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db('extension_sale');
  BaseModel = require('../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = client;
  BaseModel._connectedUri = process.env.MONGODB_URI;
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  service = require('../src/services/sale.service');
});
after(async () => {
  await mongoose?.disconnect();
  if (BaseModel?.mongoClient && BaseModel.mongoClient !== client)
    await BaseModel.mongoClient.close();
  await client?.close();
  await mongo?.stop();
});
test('real core sale records payment and retains movement without deducting adjusted stock again', async () => {
  const scope = { license: new ObjectId(), branchId: new ObjectId(), actorId: new ObjectId() };
  BaseModel.license = scope.license;
  BaseModel.currentBranch = scope.branchId;
  BaseModel.loggedUser = scope.actorId;
  const branch = {
    _id: scope.branchId,
    license: scope.license,
    branch_name: 'Test shop',
    currency: 'GBP',
    time_zone: 'Europe/London',
    roundOff: false,
    stock_management: true,
  };
  await db.collection('branches').insertOne(branch);
  const item = {
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    branch_access: [{ branch_id: scope.branchId }],
    name: 'Candle',
    item_name: 'Candle',
    itemid: 'CANDLE',
    selling_price: 1,
    company_price: 0.5,
    tax: 0,
    available_quantity: 3,
    track_inventory: true,
    item_status: 'regular',
    negative_stock: false,
  };
  await db.collection('items').insertOne(item);
  const result = await runStockBatch(db, scope, {
    extensionId: 'posnic.example',
    operationId: 'sale-stock-operation-001',
    lines: [{ itemId: String(item._id), quantityMilli: 3000 }],
  });
  const stockGrant = await allocateForSale(db, scope, {
    extensionId: 'posnic.example',
    stockOperationId: result.operationId,
    saleId: new ObjectId(),
    lines: [{ itemId: String(item._id), quantityMilli: 1000 }],
  });
  const context = {
    licenseId: String(scope.license),
    branchId: String(scope.branchId),
    userId: String(scope.actorId),
    userName: 'Manager',
    branchName: 'Test shop',
    salesPrefix: 'INV',
    stockManagement: true,
    roundOff: false,
    branchSettings: branch,
  };
  const payload = {
    sales_total: 1,
    payment_mode: 'Cash',
    sale_process: 'add',
    items: [{ item_id: String(item._id), item_quantity: 1 }],
  };
  const saved = await service.processSale(structuredClone(payload), '', 'Add', context, {
    stockGrant,
  });
  assert.equal(saved.status, true, JSON.stringify(saved));
  const sale = await db.collection('sales').findOne({ _id: new ObjectId(String(saved.data._id)) });
  assert.equal(sale.extension_stock_operation, result.operationId);
  assert.equal(Number(sale.sales_total), 1);
  assert.equal(sale.payment_mode, 'Cash');
  assert.equal((await db.collection('items').findOne({ _id: item._id })).available_quantity, 0);
  const duplicate = await service.processSale(structuredClone(payload), '', 'Add', context, {
    stockGrant,
  });
  assert.equal(duplicate.status, true, JSON.stringify(duplicate));
  assert.equal(await db.collection('sales').countDocuments({ license: scope.license }), 1);
  const edited = await service.processSale(
    structuredClone(payload),
    String(sale._id),
    'Edit',
    context
  );
  assert.equal(edited.status, false);
  assert.equal((await db.collection('items').findOne({ _id: item._id })).available_quantity, 0);
  const forged = await service.processSale(structuredClone(payload), '', 'Add', context, {
    stockGrant: {},
  });
  assert.equal(forged.status, false);
  const normal = await service.processSale(
    { ...structuredClone(payload), skipStock: true, extension_stock_operation: result.operationId },
    '',
    'Add',
    context
  );
  assert.equal(normal.status, false);
  assert.equal(await db.collection('sales').countDocuments({ license: scope.license }), 1);
});
