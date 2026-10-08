'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { claimCashDrawer } = require('../src/services/extension-sale-hardware');

test('drawer claims require a paid scoped cash sale and survive concurrent retry', async () => {
  const mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db('drawer_acceptance');
    const scope = { license: new ObjectId(), branchId: new ObjectId() };
    const actor = { userId: String(new ObjectId()), permissions: ['read', 'write'] };
    const descriptor = { id: 'posnic.example' };
    const sale = {
      _id: new ObjectId(),
      license: scope.license,
      branch_id: scope.branchId,
      extension_id: descriptor.id,
      payment_status: 'Paid',
      payment_mode: 'Cash',
    };
    await db.collection('sales').insertOne(sale);
    const input = { db, scope, actor, descriptor, saleId: String(sale._id) };
    await assert.rejects(
      claimCashDrawer({ ...input, actor: { ...actor, permissions: ['read'] } }),
      { status: 403 }
    );
    await assert.rejects(
      claimCashDrawer({ ...input, scope: { ...scope, branchId: new ObjectId() } }),
      { status: 404 }
    );
    await assert.rejects(claimCashDrawer({ ...input, descriptor: { id: 'posnic.other' } }), {
      status: 404,
    });
    await assert.rejects(claimCashDrawer({ ...input, saleId: 'invalid' }), { status: 422 });
    for (const change of [{ payment_mode: 'Card' }, { payment_status: 'Pending' }]) {
      const other = { ...sale, ...change, _id: new ObjectId() };
      await db.collection('sales').insertOne(other);
      await assert.rejects(claimCashDrawer({ ...input, saleId: String(other._id) }), {
        status: 404,
      });
    }
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimCashDrawer(input)));
    assert.equal(claims.filter((claim) => claim.open).length, 1);
    const reopened = new MongoClient(mongo.getUri());
    await reopened.connect();
    try {
      assert.deepEqual(await claimCashDrawer({ ...input, db: reopened.db('drawer_acceptance') }), {
        open: false,
      });
    } finally {
      await reopened.close();
    }
    assert.equal(await db.collection('extension_hardware_claims').countDocuments(), 1);
    assert.equal((await db.collection('sales').findOne({ _id: sale._id })).payment_status, 'Paid');
  } finally {
    await client.close();
    await mongo.stop();
  }
});
