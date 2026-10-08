'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { runStockBatch } = require('../src/services/extension-stock-journal');
const { allocateForSale } = require('../src/services/extension-stock-allocations');
const { applyStockEffect } = require('../src/services/extension-stock-effects');
const { returnStock, clearStockBasket } = require('../src/services/extension-stock-lifecycle');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_lifecycle');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(quantityMilli = 1000) {
  const scope = { license: new ObjectId(), branchId: new ObjectId(), actorId: new ObjectId() };
  const item = {
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    track_inventory: true,
    item_status: 'regular',
    available_quantity: 3,
  };
  await db.collection('items').insertOne(item);
  const lines = [{ itemId: String(item._id), quantityMilli }];
  const original = {
    extensionId: 'posnic.example',
    operationId: 'adjustment-operation-001',
    lines,
  };
  const result = await runStockBatch(db, scope, original);
  return {
    scope,
    item,
    original,
    input: {
      extensionId: original.extensionId,
      stockOperationId: result.operationId,
      operationId: 'lifecycle-operation-001',
      lines,
    },
    stock: async () => (await db.collection('items').findOne({ _id: item._id })).available_quantity,
  };
}
test('delete leaves stock reduced, purges unpaid journal payload and permanently closes it', async () => {
  const f = await fixture();
  assert.equal(await f.stock(), 2);
  await clearStockBasket(db, f.scope, f.input);
  await clearStockBasket(db, f.scope, f.input);
  assert.equal(await f.stock(), 2);
  const row = await db
    .collection('extension_stock_commands')
    .findOne({ _id: f.input.stockOperationId });
  assert.equal(row.phase, 'cleared');
  for (const name of [
    'lines',
    'actorId',
    'remaining',
    'allocations',
    'returnReceipts',
    'createdAt',
  ])
    assert.equal(row[name], undefined);
  await assert.rejects(runStockBatch(db, f.scope, f.original), { code: 'stock_batch_cleared' });
  await assert.rejects(allocateForSale(db, f.scope, { ...f.input, saleId: new ObjectId() }), {
    code: 'stock_allocation_unavailable',
  });
  await assert.rejects(returnStock(db, f.scope, f.input), { code: 'stock_return_unavailable' });
});
test('return recovers a lost acknowledgement and restores eligible quantity only once', async () => {
  const f = await fixture(2000);
  const input = { ...f.input, lines: [{ ...f.input.lines[0], quantityMilli: 1000 }] };
  await assert.rejects(
    returnStock(db, f.scope, input, {
      applyEffect: async (...args) => {
        await applyStockEffect(...args);
        throw new Error('lost acknowledgement');
      },
    }),
    /lost acknowledgement/
  );
  assert.equal(await f.stock(), 2);
  await assert.rejects(clearStockBasket(db, f.scope, f.input), { code: 'stock_lifecycle_busy' });
  await returnStock(db, f.scope, input);
  await returnStock(db, f.scope, input);
  assert.equal(await f.stock(), 2);
  await assert.rejects(
    returnStock(db, f.scope, {
      ...input,
      operationId: 'lifecycle-operation-002',
      lines: [{ ...input.lines[0], quantityMilli: 2000 }],
    }),
    { code: 'stock_return_exhausted' }
  );
});
test('pending allocation blocks deletion; a paid sale survives deletion of the remaining basket', async () => {
  const f = await fixture(2000),
    saleId = new ObjectId();
  await allocateForSale(db, f.scope, {
    ...f.input,
    saleId,
    lines: [{ ...f.input.lines[0], quantityMilli: 1000 }],
  });
  await assert.rejects(clearStockBasket(db, f.scope, f.input), {
    code: 'stock_lifecycle_payment_unresolved',
  });
  const sale = {
    _id: saleId,
    license: f.scope.license,
    branch_id: f.scope.branchId,
    extension_stock_operation: f.input.stockOperationId,
    payment_status: 'Paid',
    sales_total: 1,
  };
  await db.collection('sales').insertOne(sale);
  await clearStockBasket(db, f.scope, f.input);
  assert.equal((await db.collection('sales').findOne({ _id: saleId })).sales_total, 1);
  assert.equal(await f.stock(), 1);
});
test('sale allocation and deletion competing cannot both accept an unpaid quantity', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    allocateForSale(db, f.scope, { ...f.input, saleId: new ObjectId() }),
    clearStockBasket(db, f.scope, f.input),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await f.stock(), 2);
});
