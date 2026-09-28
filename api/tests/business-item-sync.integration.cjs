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
const { createBusinessPublisher } = require(
  path.join(root, 'apps/sync-agent/src/business-reporting')
);
const { createBusinessReporting } = require(
  path.join(root, 'apps/sync-gateway/src/business-reporting')
);
const { createDesktopReportingWorker } = require('../src/services/business-reporting-worker');
const { readBusinessItems } = require('../src/services/business-reports');
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

test('actual desktop preparation negotiates, publishes and replaces item rankings through the agent and Gateway', async () => {
  const priorDesktop = process.env.POSNIC_DESKTOP;
  process.env.POSNIC_DESKTOP = '1';
  const branch = {
    _id: new ObjectId(),
    license: new ObjectId(),
    currency: 'INR',
    time_zone: 'UTC',
  };
  const localDb = client.db('ranking_source'),
    remoteDb = client.db('ranking_cloud');
  const agentDb = syncClient.db(localDb.databaseName),
    gatewayDb = syncClient.db(remoteDb.databaseName);
  const day = '2026-09-28';
  let at = Date.now();
  const now = () => at;
  await localDb.collection('branches').insertOne(branch);
  await remoteDb.collection('branches').insertOne(branch);
  const invoice = {
    _id: new ObjectId(),
    license: branch.license,
    branch_id: branch._id,
    sale_process: 'Add',
    date: new Date(day + 'T01:00:00Z'),
    updated_date: new Date(at),
    sales_total: 325,
    items: Array.from({ length: 25 }, (_, index) => ({
      item_id: (index + 1).toString(16).padStart(24, '0'),
      item_name: `Item ${index + 1}`,
      item_quantity: 1,
      item_unit: 'qty',
      total_amount: index + 1,
    })),
  };
  await localDb.collection('sales').insertOne(invoice);
  await localDb.collection('sales').updateOne(
    { _id: invoice._id },
    withOriginalItemFacts(
      invoice,
      {
        $push: {
          items_return: {
            returnArray: {
              returnObjId: new ObjectId(),
              returnDate: new Date(day + 'T02:00:00Z'),
              itemsTotalAmount: 1,
              returnValue: [invoice.items[0]],
            },
          },
        },
        $set: {
          sale_process: 'PartialReturn',
          items: invoice.items.slice(1),
          items_return_total: 1,
        },
      },
      new Date(at)
    )
  );
  const service = createBusinessReporting(gatewayDb, { now });
  const device = { deviceId: 'ranking-desktop', branches: [String(branch._id)] };
  const publisher = createBusinessPublisher({
    db: agentDb,
    now,
    send: async (url, body) => {
      if (url.endsWith('/work')) return service.work(device);
      if (url.endsWith('/claim')) return service.claim(device, body.branchId);
      if (url.endsWith('/summaries')) return service.publish(device, body);
      throw new Error('Unexpected reporting call');
    },
  });
  const worker = createDesktopReportingWorker(localDb, { now });
  const key = String(branch._id) + ':' + day;
  const context = {
    businessId: String(branch.license),
    capabilities: ['overview.read', 'items.read'],
    branches: [{ id: String(branch._id), currency: 'INR', currencyDigits: 2, timezone: 'UTC' }],
  };
  const readDb = {
    collection(name) {
      assert.ok(
        [
          'business_reporting_requests',
          'business_reporting_publishers',
          'business_prepared_summaries',
        ].includes(name),
        'Item reads must not scan sales or item collections'
      );
      return remoteDb.collection(name);
    },
  };
  async function publishCycle() {
    await remoteDb.collection('business_reporting_requests').updateOne(
      { _id: key },
      {
        $set: {
          branchId: String(branch._id),
          license: branch.license,
          businessDate: day,
          requestedAt: new Date(at),
          expiresAt: new Date(at + 1800000),
        },
      },
      { upsert: true }
    );
    await worker.tick(); // Advertise this desktop's preparation capability.
    await publisher.tick(); // Negotiate and stage the authorized job.
    assert.equal(
      (await localDb.collection('business_reporting_local').findOne({ _id: key })).includeItems,
      true
    );
    await worker.tick();
    await publisher.tick();
    return remoteDb.collection('business_prepared_summaries').findOne({ _id: key });
  }
  try {
    const first = await publishCycle();
    assert.equal(first.summary.salesAfterReturnsMinor, 32400);
    assert.equal(first.summary.itemInsights.state, 'available');
    assert.equal(first.summary.itemInsights.truncated, true);
    assert.equal(first.summary.itemInsights.totalItems, 25);
    assert.equal(first.summary.itemInsights.items.length, 20);
    assert.equal(first.summary.itemInsights.items[0].salesAfterReturnsMinor, 2500);
    const visible = await readBusinessItems(
      readDb,
      context,
      { branchId: String(branch._id), businessDate: day },
      { now }
    );
    assert.deepEqual(visible.itemInsights, first.summary.itemInsights);
    assert.equal(visible.freshness.complete, false);
    // A later imported invoice without trustworthy item facts must remove the
    // old top list rather than silently dropping that invoice from ranking.
    at += 6 * 60000;
    await localDb.collection('sales').insertOne({
      ...invoice,
      _id: new ObjectId(),
      items: [],
      sales_total: 10,
      updated_date: new Date(at),
    });
    const second = await publishCycle();
    assert.equal(second.sequence, first.sequence + 1);
    assert.equal(second.summary.salesAfterReturnsMinor, 33400);
    assert.equal(second.summary.itemInsights.state, 'incomplete');
    assert.equal(second.summary.itemInsights.unavailableSales, 1);
    assert.deepEqual(second.summary.itemInsights.items, []);
    const unavailable = await readBusinessItems(
      readDb,
      context,
      { branchId: String(branch._id), businessDate: day },
      { now }
    );
    assert.deepEqual(unavailable.itemInsights, second.summary.itemInsights);
  } finally {
    worker.stop();
    if (priorDesktop === undefined) delete process.env.POSNIC_DESKTOP;
    else process.env.POSNIC_DESKTOP = priorDesktop;
  }
});
