'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { withOriginalItemFacts } = require('../src/services/business-item-origin');

// Explicit checkout dependency: this exercises the shipped agent and Gateway,
// rather than a test implementation of their document transport.
const root = process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT;
assert.ok(root, 'Set POSNIC_BUSINESS_TEST_GATEWAY_ROOT to the Gateway checkout');
const express = require(path.join(root, 'apps/sync-gateway/node_modules/express'));
const { MongoClient: SyncMongoClient } = require(
  path.join(root, 'apps/sync-agent/node_modules/mongodb')
);
const { createSyncRouter } = require(path.join(root, 'apps/sync-gateway/src/routes/sync'));
const { pushCollection, pullCollection } = require(path.join(root, 'apps/sync-agent/src/sync'));
const { SyncState } = require(path.join(root, 'apps/sync-agent/src/state'));
let mongo, client, syncClient, server, source, syncSource, destination, cloud, gatewayUrl;
const branchId = new ObjectId();
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  syncClient = await SyncMongoClient.connect(mongo.getUri());
  source = client.db('item_source');
  syncSource = syncClient.db('item_source');
  destination = syncClient.db('item_destination');
  cloud = client.db('item_cloud');
  await cloud.collection('branches').insertOne({ _id: branchId });
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  // Identity is injected only in this transport fixture; deployment auth is
  // covered separately by the Gateway's device authentication tests.
  app.use((req, res, next) => {
    req.device = {
      deviceId: req.headers.authorization === 'Bearer source' ? 'source' : 'destination',
      tenantDb: cloud.databaseName,
      branches: [String(branchId)],
    };
    next();
  });
  app.use('/v1/sync', createSyncRouter(syncClient));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  gatewayUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await client?.close();
  await syncClient?.close();
  await mongo?.stop();
});

test('original item facts survive actual incremental push and pull after partial and full returns', async () => {
  const itemId = new ObjectId();
  const sale = {
    _id: new ObjectId(),
    license: new ObjectId(),
    branch_id: branchId,
    sale_process: 'Add',
    date: new Date('2026-09-01T18:00:00Z'),
    updated_date: new Date('2026-09-01T18:00:00Z'),
    sales_total: '10.005',
    items: [
      {
        item_id: String(itemId),
        item_name: 'Measured item',
        item_unit: 'kg',
        item_quantity: '1.125',
        total_amount: '10.005',
      },
    ],
  };
  await source.collection('sales').insertOne(sale);
  const firstAt = new Date('2026-09-02T18:00:00Z');
  await source.collection('sales').updateOne(
    { _id: sale._id },
    withOriginalItemFacts(
      sale,
      {
        $push: {
          items_return: {
            returnArray: {
              returnObjId: new ObjectId(),
              itemsTotalAmount: '3.335',
              returnDate: firstAt,
            },
          },
        },
        $set: {
          sale_process: 'PartialReturn',
          updated_date: firstAt,
          items_return_total: '3.335',
          items: [{ ...sale.items[0], item_quantity: '0.750', total_amount: '6.670' }],
        },
      },
      firstAt
    )
  );
  const expected = (await source.collection('sales').findOne({ _id: sale._id }))
    .business_item_origin;
  assert.equal(expected.lines[0].quantity, '1.125');
  assert.equal(expected.lines[0].grossAmount, '10.005');
  const sourceState = new SyncState(syncSource),
    destinationState = new SyncState(destination);
  const sourceConfig = { gatewayUrl, deviceToken: 'source' };
  const destinationConfig = { gatewayUrl, deviceToken: 'destination' };
  for (const full of [false, true]) {
    if (full) {
      const current = await source.collection('sales').findOne({ _id: sale._id });
      const at = new Date('2026-09-03T18:00:00Z');
      await source.collection('sales').updateOne(
        { _id: sale._id },
        withOriginalItemFacts(
          current,
          {
            $push: {
              items_return: {
                returnArray: {
                  returnObjId: new ObjectId(),
                  itemsTotalAmount: '6.670',
                  returnDate: at,
                },
              },
            },
            $set: {
              sale_process: 'FullReturn',
              updated_date: at,
              items: [],
              items_return_total: '10.005',
            },
          },
          at
        )
      );
    }
    assert.equal(await pushCollection(syncSource, sourceState, sourceConfig, 'sales'), 1);
    assert.deepEqual(
      (await cloud.collection('sales').findOne({ _id: sale._id })).business_item_origin,
      expected
    );
    assert.equal(
      await pullCollection(destination, destinationState, destinationConfig, 'sales'),
      1
    );
    const synced = await client
      .db('item_destination')
      .collection('sales')
      .findOne({ _id: sale._id });
    assert.deepEqual(synced.business_item_origin, expected);
    assert.equal(String(synced._id), String(sale._id));
    assert.deepEqual(synced.date, sale.date);
    assert.equal(synced.items.length, full ? 0 : 1);
    assert.equal(synced.items_return.length, full ? 2 : 1);
    assert.equal(synced.sales_total, '10.005');
    assert.equal(
      await pushCollection(destination, destinationState, destinationConfig, 'sales'),
      0
    );
    assert.equal(
      await pullCollection(destination, destinationState, destinationConfig, 'sales'),
      0
    );
  }
});
