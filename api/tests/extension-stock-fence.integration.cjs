'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { applyStockEffect } = require('../src/services/extension-stock-effects');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_fence');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const scope = { license: new ObjectId(), branchId: new ObjectId() };
  const item = {
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    track_inventory: true,
    item_status: 'regular',
    available_quantity: 300,
  };
  await db.collection('items').insertOne(item);
  const effect = {
    itemId: String(item._id),
    operationId: 'operation-forward-001',
    deltaMilli: -1000,
    stream: { id: 'posnic.example', sequence: 1 },
  };
  return { scope, item, effect, read: () => db.collection('items').findOne({ _id: item._id }) };
}
test('bounded fence retains one receipt across repeated namespace commands and rejects stale writers', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 8 }, () => applyStockEffect(db, f.scope, f.effect)));
  assert.equal((await f.read()).available_quantity, 299);
  for (let sequence = 2; sequence <= 100; sequence++)
    await applyStockEffect(db, f.scope, {
      ...f.effect,
      operationId: `operation-forward-${sequence}`,
      stream: { ...f.effect.stream, sequence },
    });
  const row = await f.read();
  assert.equal(row.available_quantity, 200);
  assert.equal(Object.keys(row.extension_stock_streams).length, 1);
  assert.equal(row.extension_stock_effects, undefined);
  await assert.rejects(applyStockEffect(db, f.scope, f.effect), {
    code: 'stock_effect_superseded',
  });
  assert.equal((await f.read()).available_quantity, 200);
});
test('compensation has a reserved receipt within the same fence and cannot be applied twice', async () => {
  const f = await fixture();
  await applyStockEffect(db, f.scope, f.effect);
  const reverse = {
    ...f.effect,
    operationId: f.effect.operationId + ':reverse',
    reverseOf: f.effect.operationId,
    deltaMilli: 1000,
  };
  await applyStockEffect(db, f.scope, reverse);
  await applyStockEffect(db, f.scope, reverse);
  await applyStockEffect(db, f.scope, f.effect);
  assert.equal((await f.read()).available_quantity, 300);
  assert.equal(Object.keys((await f.read()).extension_stock_streams).length, 1);
  await assert.rejects(applyStockEffect(db, f.scope, { ...reverse, deltaMilli: 2000 }), {
    code: 'stock_operation_conflict',
  });
});
test('refusal remains final for its sequence even if another sale restocks the item', async () => {
  const f = await fixture();
  const effect = { ...f.effect, deltaMilli: -301000 };
  assert.equal((await applyStockEffect(db, f.scope, effect)).applied, false);
  await db.collection('items').updateOne({ _id: f.item._id }, { $inc: { available_quantity: 10 } });
  assert.equal((await applyStockEffect(db, f.scope, effect)).applied, false);
  assert.equal((await f.read()).available_quantity, 310);
});
