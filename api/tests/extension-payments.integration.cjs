'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  preparePayment,
  confirmCash,
  confirmExternalCard,
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
  await db.collection('branches').insertOne({
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
  assert.deepEqual(
    await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 }),
    { rejected: true, failureCode: 'extension_payment_review_required' }
  );
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
  assert.equal(await f.stock(), 2);
  assert.equal(
    (await db.collection('extension_payments').findOne({ _id: prepared.paymentId })).status,
    'pending'
  );
  // The failed operation cannot be revived by a late retry. The operator can
  // cancel preparation, review the new quote and start a fresh payment.
  assert.equal(
    (await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 })).rejected,
    true
  );
  await cancelPayment(
    { ...f.context, sequence: 3, operationId: 'cancel-repriced-payment' },
    { paymentId: prepared.paymentId }
  );
  assert.equal(await f.stock(), 3);
  const nextContext = { ...f.context, sequence: 4, operationId: 'prepare-repriced-payment' };
  const reviewed = await preparePayment(nextContext, f.input);
  assert.equal(reviewed.valueMinor, 200);
  assert.equal(
    (await confirmCash(nextContext, { paymentId: reviewed.paymentId, tenderMinor: 200 })).status,
    'paid'
  );
  assert.equal(await f.stock(), 2);
});

test('invalid quote refuses without reserving stock and remains closed on retry', async () => {
  const f = await fixture();
  await db.collection('items').updateOne({ _id: f.item._id }, { $set: { selling_price: 0 } });
  assert.equal((await preparePayment(f.context, f.input)).rejected, true);
  assert.equal(await f.stock(), 3);
  await db.collection('items').updateOne({ _id: f.item._id }, { $set: { selling_price: 1 } });
  assert.equal((await preparePayment(f.context, f.input)).rejected, true);
  assert.equal(await f.stock(), 3);
});

test('same payable with a changed tax breakdown requires review before saving', async () => {
  const f = await fixture();
  const prepared = await preparePayment(f.context, f.input);
  await db
    .collection('items')
    .updateOne({ _id: f.item._id }, { $set: { tax: 20, tax_type: 'inclusive' } });
  const result = await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 });
  assert.equal(result.rejected, true);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
  await cancelPayment(
    { ...f.context, sequence: 3, operationId: 'cancel-tax-change' },
    { paymentId: prepared.paymentId }
  );
  assert.equal(await f.stock(), 3);
});

test('a stale writer cannot insert after a rejected submission has been cancelled', async () => {
  const f = await fixture(),
    prepared = await preparePayment(f.context, f.input);
  let entered, proceed;
  const atSave = new Promise((resolve) => {
    entered = resolve;
  });
  const resume = new Promise((resolve) => {
    proceed = resolve;
  });
  const late = confirmCash(
    f.context,
    { paymentId: prepared.paymentId, tenderMinor: 100 },
    {
      saveSale: async (...args) => {
        entered();
        await resume;
        return require('../src/services/sale.service').processSale(...args);
      },
    }
  ).catch((error) => error);
  await atSave;
  const rejected = await confirmCash(
    f.context,
    { paymentId: prepared.paymentId, tenderMinor: 100 },
    {
      saveSale: async () => ({ status: false }),
    }
  );
  assert.equal(rejected.rejected, true);
  await cancelPayment(
    { ...f.context, sequence: 3, operationId: 'cancel-after-refusal' },
    { paymentId: prepared.paymentId }
  );
  proceed();
  await late;
  assert.equal(await f.stock(), 3);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
});

test('an authorized interrupted write remains locked until safe replay confirms the sale', async () => {
  const f = await fixture(),
    prepared = await preparePayment(f.context, f.input);
  await assert.rejects(
    confirmCash(
      f.context,
      { paymentId: prepared.paymentId, tenderMinor: 100 },
      {
        saveSale: async (payload, id, mode, ctx, options) => {
          return require('../src/services/sale.service').processSale(payload, id, mode, ctx, {
            ...options,
            beforeStockCommit: async (...args) => {
              await options.beforeStockCommit(...args);
              throw new Error('interrupted after commit gate');
            },
          });
        },
      }
    ),
    { code: 'extension_payment_sale_unresolved' }
  );
  await assert.rejects(
    cancelPayment(
      { ...f.context, sequence: 3, operationId: 'cancel-uncertain-write' },
      { paymentId: prepared.paymentId }
    ),
    { code: 'extension_payment_cannot_cancel' }
  );
  // Authorization saved the normal core document. Catalogue removal and a
  // currency setting change must not invalidate the money already recorded.
  await db.collection('items').deleteOne({ _id: f.item._id });
  await db
    .collection('branches')
    .updateOne({ _id: f.context.scope.branchId }, { $set: { currency: 'EUR' } });
  assert.equal(
    (await confirmCash(f.context, { paymentId: prepared.paymentId, tenderMinor: 100 })).status,
    'paid'
  );
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    1
  );
  const sale = await db.collection('sales').findOne({ license: f.context.scope.license });
  assert.equal(Number(sale.sales_total), 1);
  assert.equal(sale.items[0].item_name, 'Candle');
});

test('Card requires explicit terminal confirmation and records a normal Card sale once', async () => {
  const f = await fixture(true);
  f.input.method = 'card';
  const prepared = await preparePayment(f.context, f.input);
  await assert.rejects(confirmExternalCard(f.context, { paymentId: prepared.paymentId }), {
    code: 'extension_card_confirmation_required',
  });
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    0
  );
  const input = {
    paymentId: prepared.paymentId,
    terminalConfirmed: true,
    reference: 'TEST-TERMINAL-001',
  };
  const paid = await confirmExternalCard(f.context, input);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.recording, 'external-terminal');
  assert.equal(paid.reference, 'TEST-TERMINAL-001');
  assert.equal(paid.changeMinor, undefined);
  const sale = await db.collection('sales').findOne({ _id: new ObjectId(paid.saleId) });
  assert.equal(sale.payment_mode, 'Card');
  assert.deepEqual(sale.multi_payment, { Card: 1 });
  assert.equal(await f.stock(), 0);
  assert.equal((await confirmExternalCard(f.context, input)).saleId, paid.saleId);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    1
  );
  await assert.rejects(confirmExternalCard(f.context, { ...input, reference: 'OTHER' }), {
    code: 'extension_payment_confirmation_conflict',
  });
});

test('a delayed authorized writer and recovery share one immutable sale document', async () => {
  const f = await fixture(),
    prepared = await preparePayment(f.context, f.input);
  let authorized, proceed;
  const atGate = new Promise((resolve) => {
    authorized = resolve;
  });
  const resume = new Promise((resolve) => {
    proceed = resolve;
  });
  const input = { paymentId: prepared.paymentId, tenderMinor: 100 };
  const first = confirmCash(f.context, input, {
    saveSale: async (payload, id, mode, ctx, options) =>
      require('../src/services/sale.service').processSale(payload, id, mode, ctx, {
        ...options,
        beforeStockCommit: async (...args) => {
          const document = await options.beforeStockCommit(...args);
          authorized();
          await resume;
          return document;
        },
      }),
  });
  await atGate;
  const recorded = await db.collection('extension_payments').findOne({ _id: prepared.paymentId });
  assert.ok(recorded.commitDocument.license instanceof ObjectId);
  assert.ok(recorded.commitDocument.date instanceof Date);
  await db.collection('items').updateOne({ _id: f.item._id }, { $set: { selling_price: 9 } });
  const recovered = await confirmCash(f.context, input);
  proceed();
  const original = await first;
  assert.equal(original.saleId, recovered.saleId);
  assert.equal(await f.stock(), 2);
  assert.equal(
    await db.collection('sales').countDocuments({ license: f.context.scope.license }),
    1
  );
  const sale = await db.collection('sales').findOne({ _id: new ObjectId(recovered.saleId) });
  assert.equal(Number(sale.sales_total), 1);
  assert.equal(sale.date.toISOString(), recorded.commitDocument.date.toISOString());
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
