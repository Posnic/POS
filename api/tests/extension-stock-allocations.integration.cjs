'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { runStockBatch } = require('../src/services/extension-stock-journal');
const {
  allocateForSale,
  validateSaleGrant,
} = require('../src/services/extension-stock-allocations');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_allocations');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
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
  const command = {
    extensionId: 'posnic.example',
    operationId: 'basket-command-0001',
    lines: [{ itemId: String(item._id), quantityMilli: 2000 }],
  };
  const { operationId } = await runStockBatch(db, scope, command);
  return {
    scope,
    item,
    input: {
      extensionId: command.extensionId,
      stockOperationId: operationId,
      saleId: new ObjectId(),
      lines: [{ itemId: String(item._id), quantityMilli: 1000 }],
    },
  };
}
test('partial allocations are replayable and competing sales cannot exceed adjusted quantity', async () => {
  const f = await fixture();
  await allocateForSale(db, f.scope, f.input);
  await allocateForSale(db, f.scope, f.input);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      allocateForSale(db, f.scope, { ...f.input, saleId: new ObjectId() })
    )
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await db.collection('items').findOne({ _id: f.item._id })).available_quantity, 1);
});
test('unforgeable grant binds actor, company, branch, items and exact quantity', async () => {
  const f = await fixture();
  const grant = await allocateForSale(db, f.scope, f.input);
  const context = {
    licenseId: f.scope.license,
    branchId: f.scope.branchId,
    userId: f.scope.actorId,
  };
  const items = [{ item_id: f.item._id, item_quantity: 1 }];
  assert.equal(
    String((await validateSaleGrant(grant, context, items)).saleId),
    String(f.input.saleId)
  );
  await assert.rejects(validateSaleGrant({}, context, items), { code: 'invalid_stock_grant' });
  await assert.rejects(validateSaleGrant(grant, { ...context, userId: new ObjectId() }, items), {
    code: 'invalid_stock_grant',
  });
  await assert.rejects(validateSaleGrant(grant, context, [{ ...items[0], item_quantity: 2 }]), {
    code: 'stock_grant_quantity_mismatch',
  });
  await assert.rejects(
    allocateForSale(db, f.scope, {
      ...f.input,
      lines: [{ ...f.input.lines[0], quantityMilli: 2000 }],
    }),
    { code: 'stock_allocation_conflict' }
  );
  await db
    .collection('extension_stock_commands')
    .updateOne({ _id: f.input.stockOperationId }, { $set: { phase: 'cleared' } });
  await assert.rejects(validateSaleGrant(grant, context, items), {
    code: 'stock_grant_no_longer_available',
  });
});
