'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  preparePayment,
  confirmCash,
  cancelPayment,
} = require('../src/services/extension-payments');
const { runStockBatch } = require('../src/services/extension-stock-journal');
let mongo, client, db, BaseModel, mongoose;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  process.env.MONGODB_URI = mongo.getUri('extension_payments');
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db('extension_payments');
  BaseModel = require('../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = client;
  BaseModel._connectedUri = process.env.MONGODB_URI;
  mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
});
after(async () => {
  await mongoose?.disconnect();
  await client?.close();
  await mongo?.stop();
});
async function fixture(adjusted = false) {
  const scope = { license: new ObjectId(), branchId: new ObjectId() },
    actorId = new ObjectId();
  BaseModel.license = scope.license;
  BaseModel.currentBranch = scope.branchId;
  BaseModel.loggedUser = actorId;
  await db
    .collection('branches')
    .insertOne({
      _id: scope.branchId,
      license: scope.license,
      branch_name: 'Sample shop',
      currency: 'GBP',
      time_zone: 'Europe/London',
      roundOff: false,
    });
  await db
    .collection('users')
    .insertOne({ _id: actorId, license: scope.license, username: 'Manager' });
  const item = {
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    track_inventory: true,
    item_status: 'regular',
    name: 'Candle',
    item_name: 'Candle',
    available_quantity: 3,
    selling_price: 1,
    company_price: 0.5,
    tax: 0,
    unit: 'each',
  };
  await db.collection('items').insertOne(item);
  const context = {
    db,
    scope,
    actorId: String(actorId),
    extensionId: 'posnic.example',
    operationId: 'payment-prepare-operation-001',
    sequence: 2,
  };
  const input = { method: 'cash', lines: [{ itemId: String(item._id), quantityMilli: 1000 }] };
  if (adjusted)
    input.stockOperationId = (
      await runStockBatch(
        db,
        { ...scope, actorId },
        {
          extensionId: context.extensionId,
          operationId: 'stock-adjust-operation-001',
          lines: [{ itemId: String(item._id), quantityMilli: 3000 }],
          stream: { id: context.extensionId, sequence: 1 },
        }
      )
    ).operationId;
  return {
    context,
    input,
    item,
    stock: async () => (await db.collection('items').findOne({ _id: item._id })).available_quantity,
  };
}
test('cash preparation reserves stock, uses core quote and creates no sale before confirmation', async () => {
  const f = await fixture();
  const prepared = await preparePayment(f.context, f.input);
  assert.equal(prepared.status, 'pending');
  assert.equal(prepared.valueMinor, 100);
  assert.equal(await f.stock(), 2);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
  const confirmed = await confirmCash(f.context, {
    paymentId: prepared.paymentId,
    tenderMinor: 200,
  });
  assert.equal(confirmed.status, 'paid');
  assert.equal(confirmed.changeMinor, 100);
  assert.equal(await f.stock(), 2);
  await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 200 });
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    1
  );
});
test('adjusted quantity sells without another deduction and recovers lost acknowledgement after sale insert', async () => {
  const f = await fixture(true);
  const prepared = await preparePayment(f.context, f.input);
  assert.equal(await f.stock(), 0);
  await assert.rejects(
    confirmCash(
      f.context,
      { paymentId: prepared.paymentId, tenderMinor: 100 },
      {
        saveSale: async (...args) => {
          const saved = await require('../src/services/sale.service').processSale(...args);
          assert.equal(saved.status, true, JSON.stringify(saved));
          throw new Error('lost sale acknowledgement');
        },
      }
    ),
    /lost sale acknowledgement/
  );
  assert.equal(
    (await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 })).status,
    'paid'
  );
  assert.equal(await f.stock(), 0);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    1
  );
});
test('changed catalogue amount cannot silently change the confirmed payment', async () => {
  const f = await fixture();
  const prepared = await preparePayment(f.context, f.input);
  await db.collection('items').updateOne({ _id: f.item._id }, { $set: { selling_price: 2 } });
  await assert.rejects(
    confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 }),
    { code: 'extension_cash_sale_not_saved' }
  );
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
  assert.equal(await f.stock(), 2);
});
test('cancelling unpaid normal payment restores stock once; adjusted cancellation leaves stock reduced', async () => {
  for (const adjusted of [false, true]) {
    const f = await fixture(adjusted),
      prepared = await preparePayment(f.context, f.input);
    const cancelContext = {
      ...f.context,
      sequence: 3,
      operationId: 'payment-cancel-operation-001',
    };
    await cancelPayment(cancelContext, { paymentId: prepared.paymentId });
    await cancelPayment(cancelContext, { paymentId: prepared.paymentId });
    assert.equal(await f.stock(), adjusted ? 0 : 3);
    const closed = await db.collection('extension_payments').findOne({ _id: prepared.paymentId });
    for (const field of ['lines', 'payload', 'quote', 'valueMinor', 'saleId', 'stockOperationId'])
      assert.equal(closed[field], undefined);
    await assert.rejects(
      confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 }),
      { code: 'extension_cash_payment_unavailable' }
    );
    assert.equal(
      await db.collection('sales').countDocuments({ license: f.context.scope.license }),
      0
    );
  }
});
test('cash confirmation and cancellation racing cannot both succeed', async () => {
  const f = await fixture(),
    prepared = await preparePayment(f.context, f.input);
  const results = await Promise.allSettled([
    confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 }),
    cancelPayment(
      { ...f.context, sequence: 3, operationId: 'payment-cancel-operation-001' },
      { paymentId: prepared.paymentId }
    ),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const count = await db.collection('sales').countDocuments({ license: f.context.scope.license });
  assert.equal(await f.stock(), count ? 2 : 3);
});
test('fractional quantity and exclusive tax use the same core payable for quote and saved sale', async () => {
  const f = await fixture();
  await db
    .collection('items')
    .updateOne({ _id: f.item._id }, { $set: { tax: 20, tax_type: 'exclusive' } });
  f.input.lines[0].quantityMilli = 1001;
  const prepared = await preparePayment(f.context, f.input);
  assert.equal(prepared.valueMinor, 120);
  const paid = await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 120 });
  assert.equal(paid.valueMinor, 120);
  assert.equal(await f.stock(), 1.999);
  assert.equal(
    Number((await db.collection('sales').findOne({ _id: new ObjectId(paid.saleId) })).sales_total),
    1.2
  );
});
