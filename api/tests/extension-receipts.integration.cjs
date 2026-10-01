'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { readReceipt } = require('../src/services/extension-receipts');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('extension_receipts');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const scope = { license: new ObjectId(), branchId: new ObjectId() };
  const productId = String(new ObjectId()),
    stockOperationId = 'a'.repeat(64);
  const actor = { userId: String(new ObjectId()), permissions: ['read'] };
  const result = {
    kind: 'pending',
    reference: 'basket-1',
    stockOperationId,
    customer: 'Sample customer',
    createdAt: '2026-10-01T10:15:00Z',
    valueMinor: 150,
    lines: [{ productId, description: 'Candle', quantityMilli: 1500, priceMinor: 100 }],
  };
  const descriptor = {
    id: 'posnic.example',
    initialState: {},
    readReceipt: async () => structuredClone(result),
  };
  await db
    .collection('branches')
    .insertOne({
      _id: scope.branchId,
      license: scope.license,
      branch_name: 'Sample Shop',
      currency: 'GBP',
      time_zone: 'Europe/London',
      branch_gstin_number: 'Sample VAT',
    });
  await db
    .collection('extension_stock_commands')
    .insertOne({
      _id: stockOperationId,
      license: scope.license,
      branch_id: scope.branchId,
      extensionId: descriptor.id,
      phase: 'committed',
      lines: [{ itemId: productId, quantityMilli: 2000 }],
    });
  return {
    scope,
    actor,
    descriptor,
    result,
    input: { db, scope, actor, descriptor, request: { adjustmentId: 'basket-1' } },
  };
}
test('pending receipt uses saved quantities and normal shop details without creating a sale', async () => {
  const f = await fixture();
  f.input.request.items_total = 99999;
  const printed = await readReceipt(f.input);
  assert.equal(printed.kind, 'pending');
  assert.equal(printed.document.branch_name, 'Sample Shop');
  assert.equal(printed.document.items_total, 1.5);
  assert.equal(printed.document.items[0].item_quantity, 1.5);
  assert.equal(printed.document.created_date, '01/10/2026, 11:15');
  assert.equal(printed.document.pending_goods_receipt, true);
  assert.equal(printed.document.sales_id, undefined);
  assert.equal(printed.document.payment_status, 'Pending');
  assert.equal(await db.collection('sales').countDocuments(), 0);
  await db
    .collection('extension_stock_commands')
    .updateOne(
      { _id: f.result.stockOperationId },
      { $set: { phase: 'cleared' }, $unset: { lines: '' } }
    );
  await assert.rejects(readReceipt(f.input), { code: 'extension_receipt_unavailable' });
  await db.collection('extension_stock_commands').deleteMany({});
});
test('receipt quantities, totals and cross-company references cannot bypass host facts', async () => {
  const f = await fixture();
  f.result.lines[0].quantityMilli = 3000;
  f.result.valueMinor = 300;
  await assert.rejects(readReceipt(f.input), { code: 'extension_receipt_quantity_unavailable' });
  f.result.lines[0].quantityMilli = 1000;
  f.result.valueMinor = 999;
  await assert.rejects(readReceipt(f.input), { code: 'extension_receipt_total_invalid' });
  await assert.rejects(
    readReceipt({ ...f.input, scope: { ...f.scope, license: new ObjectId() } }),
    { code: 'extension_receipt_unavailable' }
  );
  await db.collection('extension_stock_commands').deleteMany({});
});
test('paid receipt requires an existing paid core sale owned by this extension and shop', async () => {
  const f = await fixture();
  const saleId = new ObjectId();
  f.descriptor.readReceipt = async () => ({ kind: 'paid', saleId: String(saleId) });
  await assert.rejects(readReceipt(f.input), { code: 'extension_receipt_unavailable' });
  await db
    .collection('sales')
    .insertOne({
      _id: saleId,
      license: f.scope.license,
      branch_id: f.scope.branchId,
      extension_id: f.descriptor.id,
      payment_status: 'Paid',
    });
  assert.deepEqual(await readReceipt(f.input), { kind: 'paid', saleId: String(saleId) });
  await db.collection('extension_stock_commands').deleteMany({});
});
