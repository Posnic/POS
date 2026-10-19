'use strict';
// Run with POSNIC_GATEWAY_ROOT pointing to the companion Gateway checkout.
// Real agent + gateway router, HTTP and Mongo; authentication is a test fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient: ApiClient, ObjectId: ApiId } = require('mongodb');
const express = require('express');
const gatewayRoot = process.env.POSNIC_GATEWAY_ROOT;
test('two tills exchange unit snapshots, quotes and clear markers without replaying stock', { skip: !gatewayRoot }, async () => {
  const { pushCollection, pullCollection } = require(path.join(gatewayRoot, 'apps/sync-agent/src/sync'));
  const { SyncState } = require(path.join(gatewayRoot, 'apps/sync-agent/src/state'));
  const { createSyncRouter } = require(path.join(gatewayRoot, 'apps/sync-gateway/src/routes/sync'));
  const { MongoClient, ObjectId } = require(require.resolve('mongodb', { paths: [path.join(gatewayRoot, 'apps/sync-agent')] }));
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const apiClient = await ApiClient.connect(mongo.getUri());
  let server;
  try {
    const cloud = client.db('cloud'), a = client.db('till_a'), b = client.db('till_b'), foreign = client.db('foreign_till');
    const branch = new ObjectId(), otherBranch = new ObjectId(), license = new ObjectId(), itemId = new ObjectId(), saleId = new ObjectId();
    await cloud.collection('branches').insertMany([{ _id: branch }, { _id: otherBranch }]);
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
      const id = req.get('authorization')?.replace('Bearer ', '');
      if (!['a','b','foreign'].includes(id)) return res.sendStatus(401);
      req.device = { deviceId: id, tenantDb: 'cloud', branches: [String(id === 'foreign' ? otherBranch : branch)] }; next();
    });
    app.use('/v1/sync', createSyncRouter(client));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const cfg = id => ({ deviceToken: id, gatewayUrl: 'http://127.0.0.1:' + server.address().port });
    const sa = new SyncState(a), sb = new SyncState(b), sf = new SyncState(foreign);
    const now = new Date();
    const conversion = { unit: 'ft', base_unit: 'm', factor: .3048, price: 32 };
    await a.collection('items').insertOne({ _id: itemId, license, branch_id: branch, unit: 'm', selling_units: [{ unit: 'ft', factor: .3048, price: 32 }], available_quantity: 6.952, updated_date: now });
    await a.collection('sales').insertOne({ _id: saleId, license, branch_id: branch, sale_process: 'Hold', sales_total: 320, items: [{ item_id: String(itemId), item_unit: 'ft', item_quantity: 10, unit_conversion: conversion }], receipt_quote: require('../src/helpers/receipt-quote').select({source:'thirukkural',order:'sequential',showQr:true}, 'S222'), updated_date: now });
    for (const name of ['items','sales']) {
      assert.equal(await pushCollection(a, sa, cfg('a'), name), 1);
      assert.equal(await pullCollection(b, sb, cfg('b'), name), 1);
      assert.equal(await pullCollection(foreign, sf, cfg('foreign'), name), 0);
    }
    const received = await b.collection('sales').findOne({ _id: saleId });
    assert.deepEqual(received.items[0].unit_conversion, conversion);
    assert.equal(received.receipt_quote.url, 'https://www.posnic.com/tools/thirukural/222');
    assert.deepEqual(received.receipt_quote, require('../src/helpers/receipt-quote').select({source:'thirukkural',order:'sequential',showQr:true}, 'S222'));
    assert.equal((await b.collection('items').findOne({ _id: itemId })).available_quantity, 6.952);
    const parked = require('../src/services/parked-sales');
    await parked.clearAll(apiClient.db('till_b'), { branchId: String(branch), licenseId: new ApiId(String(license)), userId: new ApiId() });
    assert.equal(await pushCollection(b, sb, cfg('b'), 'settings'), 1);
    assert.equal(await pullCollection(a, sa, cfg('a'), 'settings'), 1);
    for (const database of [a,b,cloud]) {
      assert.equal(await database.collection('sales').countDocuments(), 1);
      const visible = await database.collection('sales').aggregate(parked.visibilityStages()).toArray();
      assert.equal(visible.length, 0);
      assert.equal((await database.collection('items').findOne({ _id: itemId })).available_quantity, 6.952);
    }
    // Reconnect/retry from the beginning does not duplicate a sale or reapply stock.
    await sb.setPullSince('sales', null); await pullCollection(b, sb, cfg('b'), 'sales');
    await sb.setPushSince('settings', null); await pushCollection(b, sb, cfg('b'), 'settings');
    assert.equal(await b.collection('sales').countDocuments(), 1);
    assert.equal(await cloud.collection('settings').countDocuments({ kind: 'parked_sale_clearance' }), 1);
    // A newer cloud item configuration travels back; old sale conversion remains unchanged.
    await cloud.collection('items').updateOne({ _id: itemId }, { $set: { selling_units: [], updated_date: new Date(Date.now() + 1000) } });
    await pullCollection(a, sa, cfg('a'), 'items');
    assert.deepEqual((await a.collection('items').findOne({ _id: itemId })).selling_units, []);
    assert.deepEqual((await a.collection('sales').findOne({ _id: saleId })).items[0].unit_conversion, conversion);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await apiClient.close(); await client.close(); await mongo.stop();
  }
});
