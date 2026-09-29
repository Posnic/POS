'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createDesktopReportingWorker } = require('../src/services/business-reporting-worker');
const { createLocalReportingBridge } = require('../src/services/business-local-reporting');
const { prepareDesktopStockSummary } = require('../src/services/business-stock-summary');
const { reportingJobKind } = require('../src/services/business-reporting-job');
let mongo, client, gatewayClient;
const previous = {
  desktop: process.env.POSNIC_DESKTOP,
  local: process.env.POSNIC_BUSINESS_LOCAL_REPORTING,
};
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  process.env.POSNIC_DESKTOP = '1';
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
});
after(async () => {
  await gatewayClient?.close();
  await client?.close();
  await mongo?.stop();
  for (const [name, value] of [
    ['POSNIC_DESKTOP', previous.desktop],
    ['POSNIC_BUSINESS_LOCAL_REPORTING', previous.local],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
async function fixture() {
  const db = client.db('stock_publication_' + new ObjectId());
  const branch = { id: String(new ObjectId()), license: String(new ObjectId()) };
  await db.collection('branches').insertOne({
    _id: new ObjectId(branch.id),
    license: new ObjectId(branch.license),
    currency: 'INR',
    time_zone: 'Asia/Kolkata',
    notification_range: 5,
  });
  await db.collection('items').insertOne({
    _id: new ObjectId(),
    license: new ObjectId(branch.license),
    branch_id: new ObjectId(branch.id),
    name: 'Rice',
    unit: 'kg',
    track_inventory: true,
    item_status: 'regular',
    available_quantity: 2,
  });
  const key = branch.id + ':stock';
  await db.collection('business_reporting_requests').insertOne({
    _id: key,
    summaryKind: 'stock',
    stockSummaryVersion: 1,
    branchId: branch.id,
    license: new ObjectId(branch.license),
    requestedAt: new Date(),
    expiresAt: new Date(Date.now() + 1800000),
  });
  return { db, branch, key };
}
test('Community worker prepares and publishes stock separately without querying sales', async () => {
  const f = await fixture();
  const guarded = {
    collection(name) {
      assert.notEqual(name, 'sales');
      return f.db.collection(name);
    },
  };
  await createDesktopReportingWorker(guarded).tick();
  const saved = await f.db.collection('business_prepared_summaries').findOne({ _id: f.key });
  assert.ok(saved);
  assert.equal(saved.summary.metricDefinitionVersion, 'stored-stock-v1');
  assert.equal(saved.summary.lowItemCount, 1);
  assert.equal(saved.summary.lowItems[0].availableMilli, 2000);
  assert.equal(saved.summary.sourceComplete, false);
  const job = await f.db.collection('business_reporting_local').findOne({ _id: f.key });
  assert.equal(job.pendingSummary, undefined);
  assert.ok(job.lastPublishedAt);
  assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 1);
});
test('worker refuses an invalid stock snapshot before staging or publication', async () => {
  const f = await fixture();
  const worker = createDesktopReportingWorker(f.db, {
    prepareStock: async (...args) => ({
      ...(await prepareDesktopStockSummary(...args)),
      sourceComplete: true,
    }),
  });
  await worker.tick();
  const job = await f.db.collection('business_reporting_local').findOne({ _id: f.key });
  assert.equal(job.error, 'invalid_stock_summary');
  assert.equal(job.pendingSummary, undefined);
  assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
});
test('Community publication revalidates a tampered staged snapshot against the assigned tenant', async () => {
  const f = await fixture();
  const bridge = createLocalReportingBridge(f.db);
  await bridge.enqueue();
  const summary = await prepareDesktopStockSummary(f.db, f.branch);
  summary.license = String(new ObjectId());
  await f.db
    .collection('business_reporting_local')
    .updateOne({ _id: f.key }, { $set: { pendingSummary: summary, preparedAt: new Date() } });
  await bridge.publish();
  const job = await f.db.collection('business_reporting_local').findOne({ _id: f.key });
  assert.equal(job.error, 'invalid_stock_summary');
  assert.equal(job.pendingSummary, undefined);
  assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
});
test('publisher reassignment while stock is prepared prevents publication by the previous owner', async () => {
  const f = await fixture();
  const worker = createDesktopReportingWorker(f.db, {
    prepareStock: async (...args) => {
      const summary = await prepareDesktopStockSummary(...args);
      await f.db
        .collection('business_reporting_publishers')
        .updateOne(
          { _id: f.branch.id },
          { $set: { deviceId: 'replacement', assignmentId: 'replacement' }, $inc: { epoch: 1 } }
        );
      return summary;
    },
  });
  await worker.tick();
  assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
});
test('stock jobs require the negotiated version and cannot alias daily or register work', () => {
  const branchId = 'a'.repeat(24);
  const job = { _id: branchId + ':stock', branchId, summaryKind: 'stock', stockSummaryVersion: 1 };
  assert.equal(reportingJobKind(job), 'stock');
  for (const change of [
    { stockSummaryVersion: 2 },
    { stockSummaryVersion: undefined },
    { businessDate: '2026-09-29' },
    { _id: branchId + ':2026-09-29' },
    { sessionId: 'b'.repeat(24) },
    { registerSummaryVersion: 1 },
  ]) {
    assert.throws(() => reportingJobKind({ ...job, ...change }), { code: 'invalid_reporting_job' });
  }
});

test('Community reserved stock publication recovers after interruption without replacing another summary kind', async () => {
  const f = await fixture();
  const bridge = createLocalReportingBridge(f.db);
  await bridge.enqueue();
  const summary = await prepareDesktopStockSummary(f.db, f.branch);
  await f.db.collection('business_reporting_publishers').updateOne(
    { _id: f.branch.id },
    {
      $set: { lastSequence: 1, pending: { sequence: 1, summary, receivedAt: new Date() } },
    }
  );
  const dailyKey = f.branch.id + ':2026-09-29';
  await f.db
    .collection('business_prepared_summaries')
    .insertOne({ _id: dailyKey, marker: 'daily' });
  await bridge.enqueue();
  const saved = await f.db.collection('business_prepared_summaries').findOne({ _id: f.key });
  assert.equal(saved.sequence, 1);
  assert.deepEqual(saved.summary, summary);
  assert.equal(
    (await f.db.collection('business_prepared_summaries').findOne({ _id: dailyKey })).marker,
    'daily'
  );
  assert.equal(
    (await f.db.collection('business_reporting_publishers').findOne({ _id: f.branch.id })).pending,
    undefined
  );
});
test('Community reserved recovery discards a corrupt stock observation', async () => {
  const f = await fixture();
  const bridge = createLocalReportingBridge(f.db);
  await bridge.enqueue();
  const summary = await prepareDesktopStockSummary(f.db, f.branch);
  summary.coverage.unavailableItems = 10;
  await f.db.collection('business_reporting_publishers').updateOne(
    { _id: f.branch.id },
    {
      $set: { lastSequence: 1, pending: { sequence: 1, summary, receivedAt: new Date() } },
    }
  );
  await bridge.enqueue();
  assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
  const owner = await f.db
    .collection('business_reporting_publishers')
    .findOne({ _id: f.branch.id });
  assert.equal(owner.pending, undefined);
  assert.equal(owner.lastPublicationError, 'invalid_stock_summary');
});

test(
  'actual desktop stock snapshot traverses the Cloud agent and Gateway without a Cloud catalogue scan',
  {
    skip: !process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT,
  },
  async () => {
    const path = require('node:path');
    const root = process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT;
    const { createBusinessPublisher } = require(
      path.join(root, 'apps/sync-agent/src/business-reporting')
    );
    const { createBusinessReporting } = require(
      path.join(root, 'apps/sync-gateway/src/business-reporting')
    );
    const f = await fixture();
    const cloudDb = client.db('stock_cloud_' + new ObjectId());
    await cloudDb
      .collection('branches')
      .insertOne(await f.db.collection('branches').findOne({ _id: new ObjectId(f.branch.id) }));
    await cloudDb
      .collection('business_reporting_requests')
      .insertOne(await f.db.collection('business_reporting_requests').findOne({ _id: f.key }));
    const { MongoClient: GatewayClient } = require(
      path.join(root, 'apps/sync-gateway/node_modules/mongodb')
    );
    gatewayClient = await GatewayClient.connect(mongo.getUri());
    const gatewayDb = gatewayClient.db(cloudDb.databaseName);
    const guarded = {
      collection(name) {
        assert.notEqual(name, 'items');
        assert.notEqual(name, 'sales');
        return gatewayDb.collection(name);
      },
    };
    const gateway = createBusinessReporting(guarded);
    const device = { deviceId: 'stock-cloud-desktop', branches: [f.branch.id] };
    const send = (endpoint, body) =>
      endpoint.endsWith('/work')
        ? gateway.work(device, body)
        : endpoint.endsWith('/claim')
          ? gateway.claim(device, body.branchId)
          : gateway.publish(device, body);
    const previousLocal = process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
    delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
    try {
      const worker = createDesktopReportingWorker(f.db);
      const agent = createBusinessPublisher({ db: f.db, send });
      await worker.tick();
      await agent.tick();
      await worker.tick();
      const staged = await f.db.collection('business_reporting_local').findOne({ _id: f.key });
      assert.equal(staged.pendingSummary.lowItems[0].availableMilli, 2000);
      await agent.tick();
      const published = await cloudDb
        .collection('business_prepared_summaries')
        .findOne({ _id: f.key });
      assert.deepEqual(published.summary, staged.pendingSummary);
      assert.equal(published.summary.sourceComplete, false);
      assert.equal(
        (await f.db.collection('business_reporting_local').findOne({ _id: f.key })).pendingSummary,
        undefined
      );
    } finally {
      if (previousLocal === undefined) delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
      else process.env.POSNIC_BUSINESS_LOCAL_REPORTING = previousLocal;
    }
  }
);
