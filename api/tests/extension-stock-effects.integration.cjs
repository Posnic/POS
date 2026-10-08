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
  db = client.db('extension_effects');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(quantity = 3) {
  const scope = { license: new ObjectId(), branchId: new ObjectId() };
  const item = {
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    branch_access: [{ branch_id: scope.branchId }],
    track_inventory: true,
    item_status: 'regular',
    available_quantity: quantity,
  };
  await db.collection('items').insertOne(item);
  const effect = {
    itemId: String(item._id),
    operationId: 'stock-operation-0001',
    deltaMilli: -1000,
  };
  const read = () => db.collection('items').findOne({ _id: item._id });
  return { scope, item, effect, read };
}
test('competing retries and lost acknowledgement deduct exactly once on standalone Mongo', async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => applyStockEffect(db, f.scope, f.effect))
  );
  assert.ok(results.every((r) => r.applied));
  assert.equal((await f.read()).available_quantity, 2);
  const secondClient = await MongoClient.connect(mongo.getUri());
  try {
    await applyStockEffect(secondClient.db('extension_effects'), f.scope, f.effect);
  } finally {
    await secondClient.close();
  }
  assert.equal((await f.read()).available_quantity, 2);
});
test('refused effect remains refused after restock; different operation may succeed', async () => {
  const f = await fixture(0);
  assert.equal((await applyStockEffect(db, f.scope, f.effect)).applied, false);
  await db.collection('items').updateOne({ _id: f.item._id }, { $set: { available_quantity: 3 } });
  assert.equal((await applyStockEffect(db, f.scope, f.effect)).applied, false);
  assert.equal(
    (await applyStockEffect(db, f.scope, { ...f.effect, operationId: 'stock-operation-0002' }))
      .applied,
    true
  );
  assert.equal((await f.read()).available_quantity, 2);
});
test('changed retry payload, wrong scope and shared stock fail closed', async () => {
  const f = await fixture();
  await applyStockEffect(db, f.scope, f.effect);
  await assert.rejects(applyStockEffect(db, f.scope, { ...f.effect, deltaMilli: -2000 }), {
    code: 'stock_operation_conflict',
  });
  await assert.rejects(applyStockEffect(db, { ...f.scope, license: new ObjectId() }, f.effect), {
    code: 'stock_effect_unavailable',
  });
  const g = await fixture();
  await db
    .collection('items')
    .updateOne({ _id: g.item._id }, { $push: { branch_access: { branch_id: new ObjectId() } } });
  await assert.rejects(applyStockEffect(db, g.scope, g.effect), {
    code: 'stock_effect_unavailable',
  });
  assert.equal((await g.read()).available_quantity, 3);
});
test('fractional units and compensating operation restore exactly once', async () => {
  const f = await fixture(0.3);
  await applyStockEffect(db, f.scope, { ...f.effect, deltaMilli: -100 });
  assert.equal((await f.read()).available_quantity, 0.2);
  const reverse = { ...f.effect, operationId: 'stock-operation-0001:reverse', deltaMilli: 100 };
  await applyStockEffect(db, f.scope, reverse);
  await applyStockEffect(db, f.scope, reverse);
  assert.equal((await f.read()).available_quantity, 0.3);
});
