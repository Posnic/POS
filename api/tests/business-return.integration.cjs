'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { saleContribution, businessDate } = require('../src/services/business-metrics');
const { itemSaleContribution } = require('../src/services/business-item-metrics');
const { registerSaleContribution } = require('../src/services/business-register-metrics');
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
  storedExtra = {},
  registerMode,
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
  await db.collection('items').insertOne({
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
  await db.collection('sales').insertOne({
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
    ...storedExtra,
  });
  const registerId = new ObjectId();
  if (registerMode)
    await db.collection('cashregister').insertOne({
      _id: registerId,
      license,
      branch_id: registerMode === 'foreign-branch' ? new ObjectId() : branchId,
      current_user_id: registerMode === 'other-owner' ? new ObjectId() : BaseModel.loggedUser,
      lock_device_id: 'refund-till',
      register_status: registerMode === 'closed' ? 'Closed' : 'Opened',
      register_opendate: new Date(Date.now() - 60000),
    });
  const result = await repository.returnSalesOrder(
    {
      ...(registerMode ? { return_register_id: String(registerId) } : {}),
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
    },
    { deviceId: registerMode === 'wrong-device' ? 'other-till' : 'refund-till' }
  );
  assert.equal(result.status, !registerMode || registerMode === 'valid', JSON.stringify(result));
  const stored = await db.collection('sales').findOne({ _id: saleId });
  return {
    result,
    stored,
    registerId: String(registerId),
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
    assert.equal(f.stored.business_item_origin.salesTotal, '200');
    assert.equal(f.stored.business_item_origin.lines[0].quantity, '2');
    assert.equal(f.stored.business_item_origin.lines[0].grossAmount, '200');
    assert.equal(f.stored.business_item_origin.invoiceDate, f.stored.date.toISOString());
    const entries = saleContribution(f.stored, f.branch).entries;
    assert.equal(entries[0].billedSalesMinor, 20000);
    assert.equal(entries[1].businessDate, businessDate(new Date(), f.branch.timezone));
    assert.equal(entries[1].refundsMinor, returnedQuantity * 10000);
    const itemEntries = itemSaleContribution(f.stored, f.branch).entries;
    assert.equal(itemEntries[0].billedSalesMinor, 20000);
    assert.equal(itemEntries[0].quantities[0].soldMilli, 2000);
    assert.equal(itemEntries[1].refundsMinor, returnedQuantity * 10000);
    assert.equal(itemEntries[1].quantities[0].returnedMilli, returnedQuantity * 1000);
  }
});

test('the actual refund writer persists only verified register attribution and rejects foreign or stale sessions', async () => {
  const f = await returned({ registerMode: 'valid' });
  const refund = f.stored.items_return[0].returnArray;
  assert.equal(refund.cashregister_id, f.registerId);
  assert.equal(f.stored.return_refund_transactions[0].cashregister_id, f.registerId);
  const at = refund.returnDate.getTime();
  assert.deepEqual(
    registerSaleContribution(f.stored, f.branch, {
      branchId: f.branch.id,
      sessionId: f.registerId,
      openedAt: new Date(at - 60000).toISOString(),
      closedAt: new Date(at + 60000).toISOString(),
    }),
    { billedSalesMinor: 0, refundsMinor: 10000, completedSales: 0 }
  );
  for (const registerMode of ['wrong-device', 'other-owner', 'foreign-branch', 'closed']) {
    const denied = await returned({ registerMode });
    assert.equal(denied.result.statusCode, 409);
    assert.equal(denied.stored.items_return.length, 0);
    assert.equal(denied.stored.return_refund_transactions, undefined);
    assert.equal(denied.stored.return_refund_lock, undefined);
    assert.equal(denied.stored.items_return_total, 0);
  }
  const legacy = await returned();
  assert.equal(legacy.stored.items_return[0].returnArray.cashregister_id, undefined);
});

test('a later return retains the original snapshot and pre-existing ambiguous history is not fabricated', async () => {
  const f = await returned({ quantity: 3 });
  const origin = f.stored.business_item_origin;
  const result = await repository.returnSalesOrder({
    sales_id: String(f.stored._id),
    items: [],
    items_return: f.stored.items,
    extra_discount: 0,
    extra_discount_type: 'percent',
    round_off_check: false,
    print: false,
  });
  assert.equal(result.status, true, JSON.stringify(result));
  const stored = await db.collection('sales').findOne({ _id: f.stored._id });
  assert.deepEqual(stored.business_item_origin, origin);
  assert.equal(stored.items.length, 0);
  const itemEntries = itemSaleContribution(stored, f.branch).entries;
  assert.equal(itemEntries[0].billedSalesMinor, 30000);
  assert.equal(itemEntries[1].refundsMinor, 30000);
  assert.equal(itemEntries[1].quantities[0].returnedMilli, 3000);
  const ambiguous = await returned({ storedExtra: { sale_process: 'PartialReturn' } });
  assert.equal(ambiguous.result.status, true);
  assert.equal(Object.hasOwn(ambiguous.stored, 'business_item_origin'), false);
  assert.throws(
    () => itemSaleContribution(ambiguous.stored, ambiguous.branch),
    /unavailable_original_items/
  );
});
test('actual return rounding reconciles, including a fully discounted zero-value return', async () => {
  const rounded = await returned({ amount: 18.75, roundOff: true });
  assert.equal(rounded.result.data.return_amount, 18.75);
  assert.equal(saleContribution(rounded.stored, rounded.branch).entries[1].refundsMinor, 1875);
  assert.equal(itemSaleContribution(rounded.stored, rounded.branch).entries[1].refundsMinor, 1875);
  const free = await returned({ quantity: 1, returnedQuantity: 1, extra: 100, original: 0 });
  assert.equal(free.result.data.return_amount, 0);
  assert.equal(free.stored.items_return_total, 0);
  assert.equal(saleContribution(free.stored, free.branch).entries[1].refundsMinor, 0);
  assert.equal(
    itemSaleContribution(free.stored, free.branch).entries[1].quantities[0].returnedMilli,
    1000
  );
});
