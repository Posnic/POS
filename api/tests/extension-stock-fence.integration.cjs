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

test('stock changes timestamp atomically, queues in the same database and replay repairs a lost marker', async () => {
  const previous = process.env.SYNC_OUTBOX_ENABLED;
  process.env.SYNC_OUTBOX_ENABLED = 'true';
  try {
    const f = await fixture();
    const oldDate = new Date('2020-01-01T00:00:00Z');
    await db.collection('items').updateOne({ _id: f.item._id }, { $set: { updated_date: oldDate } });
    await applyStockEffect(db, f.scope, f.effect);
    const changed = await f.read();
    assert.ok(changed.updated_date > oldDate);
    const filter = { collection: 'items', documentId: f.item._id };
    const marker = await db.collection('sync_outbox').findOne(filter);
    assert.equal(marker.reason, 'adjustment');
    assert.equal(marker.priority, 'critical');
    await db.collection('sync_outbox').deleteOne(filter);
    await Promise.all(Array.from({ length: 4 }, () => applyStockEffect(db, f.scope, f.effect)));
    assert.equal((await f.read()).available_quantity, 299);
    assert.deepEqual((await f.read()).updated_date, changed.updated_date);
    assert.equal(await db.collection('sync_outbox').countDocuments(filter), 1);
    const reverse = {
      ...f.effect,
      operationId: f.effect.operationId + ':reverse',
      reverseOf: f.effect.operationId,
      deltaMilli: 1000,
    };
    await applyStockEffect(db, f.scope, reverse);
    const restored = await f.read();
    assert.equal(restored.available_quantity, 300);
    assert.ok(restored.updated_date >= changed.updated_date);
    await applyStockEffect(db, f.scope, reverse);
    assert.deepEqual((await f.read()).updated_date, restored.updated_date);
    assert.equal(await db.collection('sync_outbox').countDocuments(filter), 1);
  } finally {
    if (previous === undefined) delete process.env.SYNC_OUTBOX_ENABLED;
    else process.env.SYNC_OUTBOX_ENABLED = previous;
  }
});

test('refused stock effects preserve the timestamp and create no priority marker', async () => {
  const previous = process.env.SYNC_OUTBOX_ENABLED;
  process.env.SYNC_OUTBOX_ENABLED = 'true';
  try {
    const f = await fixture();
    const oldDate = new Date('2020-01-01T00:00:00Z');
    await db.collection('items').updateOne({ _id: f.item._id }, { $set: { updated_date: oldDate } });
    assert.equal((await applyStockEffect(db, f.scope, { ...f.effect, deltaMilli: -301000 })).applied, false);
    assert.deepEqual((await f.read()).updated_date, oldDate);
    assert.equal(await db.collection('sync_outbox').countDocuments({ documentId: f.item._id }), 0);
  } finally {
    if (previous === undefined) delete process.env.SYNC_OUTBOX_ENABLED;
    else process.env.SYNC_OUTBOX_ENABLED = previous;
  }
});

test('outbox failure cannot fail or repeat stock; cloud mode does not enqueue', async () => {
  const previous = process.env.SYNC_OUTBOX_ENABLED;
  const ctx = require('../src/db/tenant-context');
  process.env.SYNC_OUTBOX_ENABLED = 'true';
  try {
    const f = await fixture();
    const brokenOutboxDb = {
      collection(name) {
        if (name === 'sync_outbox') throw new Error('simulated unavailable outbox');
        return db.collection(name);
      },
    };
    assert.equal((await applyStockEffect(brokenOutboxDb, f.scope, f.effect)).applied, true);
    assert.equal((await f.read()).available_quantity, 299);
    assert.ok((await f.read()).updated_date instanceof Date);
    ctx.enableMultiTenant(true);
    await applyStockEffect(db, f.scope, f.effect);
    assert.equal(await db.collection('sync_outbox').countDocuments({ documentId: f.item._id }), 0);
    ctx.enableMultiTenant(false);
    await applyStockEffect(db, f.scope, f.effect);
    assert.equal((await f.read()).available_quantity, 299);
    assert.equal(await db.collection('sync_outbox').countDocuments({ documentId: f.item._id }), 1);
  } finally {
    ctx.enableMultiTenant(false);
    if (previous === undefined) delete process.env.SYNC_OUTBOX_ENABLED;
    else process.env.SYNC_OUTBOX_ENABLED = previous;
  }
});
