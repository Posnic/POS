'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { runStockBatch } = require('../src/services/extension-stock-journal');
const { applyStockEffect } = require('../src/services/extension-stock-effects');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_journal');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(amounts = [3, 3]) {
  const scope = { license: new ObjectId(), branchId: new ObjectId(), actorId: new ObjectId() };
  const rows = amounts.map((available_quantity) => ({
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    track_inventory: true,
    item_status: 'regular',
    available_quantity,
  }));
  await db.collection('items').insertMany(rows);
  const command = {
    extensionId: 'posnic.example',
    operationId: 'basket-command-0001',
    lines: rows.map((row) => ({ itemId: String(row._id), quantityMilli: 1000 })),
  };
  const stock = async () =>
    Promise.all(
      rows.map(
        async (row) => (await db.collection('items').findOne({ _id: row._id })).available_quantity
      )
    );
  return { scope, command, stock };
}
test('resume after effect applied but acknowledgement lost, including concurrent recovery', async () => {
  const f = await fixture();
  let calls = 0;
  await assert.rejects(
    runStockBatch(db, f.scope, f.command, {
      applyEffect: async (...args) => {
        const result = await applyStockEffect(...args);
        if (++calls === 1) throw new Error('lost acknowledgement');
        return result;
      },
    }),
    /lost acknowledgement/
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => runStockBatch(db, f.scope, f.command))
  );
  assert.ok(results.every((result) => result.status === 'committed'));
  assert.deepEqual(await f.stock(), [2, 2]);
});
test('insufficient basket is fully compensated even if recovery also loses an acknowledgement', async () => {
  const f = await fixture([3, 0]);
  await assert.rejects(
    runStockBatch(db, f.scope, f.command, {
      applyEffect: async (...args) => {
        const result = await applyStockEffect(...args);
        if (args[2].deltaMilli > 0) throw new Error('lost reverse acknowledgement');
        return result;
      },
    }),
    /lost reverse acknowledgement/
  );
  assert.equal((await runStockBatch(db, f.scope, f.command)).status, 'rejected');
  assert.deepEqual(await f.stock(), [3, 0]);
});
test('actor or quantity changes cannot reuse a durable operation', async () => {
  const f = await fixture();
  await runStockBatch(db, f.scope, f.command);
  await assert.rejects(runStockBatch(db, { ...f.scope, actorId: new ObjectId() }, f.command), {
    code: 'stock_batch_conflict',
  });
  await assert.rejects(
    runStockBatch(db, f.scope, {
      ...f.command,
      lines: f.command.lines.map((line) => ({ ...line, quantityMilli: 2000 })),
    }),
    { code: 'stock_batch_conflict' }
  );
  assert.deepEqual(await f.stock(), [2, 2]);
});
