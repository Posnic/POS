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

const { readStockSummary } = require('../src/services/business-stock-reports');
const stockContext = (f) => ({
  businessId: f.branch.license,
  capabilities: ['stock.read'],
  branches: [f.branch],
});
const stockQuery = (f) => ({ branchId: f.branch.id });
function stockReadDb(db) {
  return {
    collection(name) {
      assert.ok(
        [
          'business_reporting_requests',
          'business_reporting_publishers',
          'business_prepared_summaries',
        ].includes(name),
        'stock reads must not query ' + name
      );
      return db.collection(name);
    },
  };
}
test('bounded stock reads request desktop work and return explicit partial coverage without financial permission', async () => {
  const f = await fixture(),
    guarded = stockReadDb(f.db),
    context = stockContext(f);
  await assert.rejects(readStockSummary(guarded, context, stockQuery(f)), {
    code: 'summary_unavailable',
  });
  await createDesktopReportingWorker(f.db).tick();
  const result = await readStockSummary(guarded, context, stockQuery(f));
  assert.equal(result.businessId, f.branch.license);
  assert.equal(result.lowItems[0].availableMilli, 2000);
  assert.equal(result.coverage.verifiedItems, 1);
  assert.equal(result.freshness.state, 'partial');
  assert.equal(result.freshness.complete, false);
  assert.equal(result.freshness.sourceUpdatedAt, null);
  assert.equal(result.license, undefined);
  assert.equal(result.publisherAssignmentId, undefined);
  const delayed = await readStockSummary(guarded, context, stockQuery(f), {
    now: () => Date.parse(result.preparedAt) + 16 * 60000,
  });
  assert.equal(delayed.freshness.state, 'delayed');
  await assert.rejects(
    readStockSummary(guarded, context, stockQuery(f), {
      now: () => Date.parse(result.preparedAt) + 25 * 3600000,
    }),
    { code: 'summary_unavailable' }
  );
});
test('stock reads reject absent stock ACL, inaccessible branches and unexpected query fields before I/O', async () => {
  const f = await fixture(),
    context = stockContext(f);
  const noIo = {
    collection() {
      throw new Error('Unauthorized I/O');
    },
  };
  for (const changed of [
    { capabilities: ['overview.read'] },
    { branches: [] },
    { businessId: 'invalid' },
  ])
    await assert.rejects(readStockSummary(noIo, { ...context, ...changed }, stockQuery(f)), {
      code: 'access_denied',
    });
  for (const query of [{ branchId: f.branch.id, page: 'all' }, {}, { branchId: [f.branch.id] }])
    await assert.rejects(readStockSummary(noIo, context, query), { code: 'invalid_request' });
});
test('stock reads reject corrupted snapshots and publisher changes rather than returning plausible stock counts', async () => {
  const f = await fixture();
  await createDesktopReportingWorker(f.db).tick();
  const collection = f.db.collection('business_prepared_summaries');
  const original = await collection.findOne({ _id: f.key });
  for (const changed of [
    { 'summary.sourceComplete': true },
    { 'summary.coverage.verifiedItems': 100 },
    { 'summary.lowItemCount': 0 },
    { 'summary.license': String(new ObjectId()) },
    { publisherAssignmentId: 'old' },
    { publisherEpoch: 0 },
    { sequence: 999 },
    { receivedAt: new Date(Date.now() + 100000) },
  ]) {
    await collection.replaceOne({ _id: f.key }, original);
    await collection.updateOne({ _id: f.key }, { $set: changed });
    await assert.rejects(readStockSummary(stockReadDb(f.db), stockContext(f), stockQuery(f)), {
      code: 'summary_unavailable',
    });
  }
  await collection.replaceOne({ _id: f.key }, original);
  let reads = 0;
  const racing = {
    collection(name) {
      const real = stockReadDb(f.db).collection(name);
      if (name !== 'business_reporting_publishers') return real;
      return {
        async findOne(...args) {
          if (++reads === 2) await real.updateOne({ _id: f.branch.id }, { $inc: { epoch: 1 } });
          return real.findOne(...args);
        },
      };
    },
  };
  await assert.rejects(readStockSummary(racing, stockContext(f), stockQuery(f)), {
    code: 'summary_unavailable',
  });
});

const { prepareDesktopStockObservation } = require('../src/services/business-stock-summary');
const { journalStockObservation } = require('../src/services/business-stock-alert-journal');
const { createStockAlertHandoff } = require('../src/services/business-stock-alert-handoff');
const {
  createCommunityStockAlertTransport,
} = require('../src/services/business-stock-alert-community-transport');
async function communityAlertFixture() {
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  const f = await fixture();
  await createDesktopReportingWorker(f.db).tick();
  await journalStockObservation(
    f.db,
    await prepareDesktopStockObservation(f.db, f.branch),
    f.branch
  );
  const pending = async () =>
    (
      await f.db
        .collection('business_stock_alert_local')
        .find({ itemId: { $exists: true } })
        .toArray()
    ).flatMap((row) => row.pendingEvents);
  const handoff = () =>
    f.db
      .collection('business_stock_alert_local')
      .findOne({ _id: 'handoff:' + f.branch.license + ':' + f.branch.id });
  return { ...f, pending, handoff };
}
test('Community stock alerts use the actual local publisher and produce durable private receipts without Cloud credentials', async () => {
  const f = await communityAlertFixture();
  const sender = createStockAlertHandoff(f.db, { send: createCommunityStockAlertTransport(f.db) });
  assert.equal((await sender.tick(f.branch)).accepted, 1);
  assert.equal((await f.pending()).length, 0);
  const batches = await f.db.collection('business_stock_alert_batches').find({}).toArray();
  assert.equal(batches.length, 1);
  const installation = await f.db
    .collection('business_reporting_local')
    .findOne({ _id: 'community-installation' });
  assert.equal(batches[0].publisherDeviceId, installation.deviceId);
  assert.equal(batches[0].batch.events[0].fact.availableMilli, 2000);
  assert.equal((await f.handoff()).transport, 'community');
  assert.equal(await f.db.collection('business_inbox').countDocuments({}), 0);
});
test('Community stock alert reservation recovers a lost database acknowledgement without losing local episodes', async () => {
  const f = await communityAlertFixture();
  let at = Date.now(),
    interrupted = false;
  const wrappedDb = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_alert_batches' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (!interrupted) {
                interrupted = true;
                throw new Error('community_ack_lost');
              }
              return result;
            };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  const sender = createStockAlertHandoff(wrappedDb, {
    now: () => at,
    send: createCommunityStockAlertTransport(wrappedDb, { now: () => at }),
  });
  await assert.rejects(sender.tick(f.branch), /community_ack_lost/);
  assert.equal((await f.pending()).length, 1);
  const initialBatch = (await f.handoff()).batch;
  at += 60001;
  await createStockAlertHandoff(f.db, {
    now: () => at,
    send: createCommunityStockAlertTransport(f.db, { now: () => at }),
  }).tick(f.branch);
  assert.equal((await f.pending()).length, 0);
  const batches = await f.db.collection('business_stock_alert_batches').find({}).toArray();
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].batch, initialBatch);
});
test('Community retries keep their original assignment even if the local job is replaced', async () => {
  const f = await communityAlertFixture();
  let at = Date.now();
  const wrappedDb = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_alert_batches' && property === 'updateOne')
            return async () => {
              throw new Error('before_queue_write');
            };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await assert.rejects(
    createStockAlertHandoff(wrappedDb, {
      now: () => at,
      send: createCommunityStockAlertTransport(wrappedDb, { now: () => at }),
    }).tick(f.branch),
    /before_queue_write/
  );
  const original = (await f.handoff()).transportPublication;
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $set: { assignmentId: 'n'.repeat(43), epoch: 2 } });
  await f.db
    .collection('business_reporting_local')
    .updateOne({ _id: f.key }, { $set: { assignmentId: 'n'.repeat(43), epoch: 2 } });
  at += 60001;
  await assert.rejects(
    createStockAlertHandoff(f.db, {
      now: () => at,
      send: createCommunityStockAlertTransport(f.db, { now: () => at }),
    }).tick(f.branch),
    { code: 'publisher_not_assigned' }
  );
  assert.deepEqual((await f.handoff()).transportPublication, original);
  assert.equal((await f.pending()).length, 1);
  assert.equal(await f.db.collection('business_stock_alert_batches').countDocuments({}), 0);
});
test('Community alert transport refuses Cloud mode and disabled activation before database access', async () => {
  const transport = createCommunityStockAlertTransport({
    collection() {
      throw new Error('unexpected_io');
    },
  });
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '0';
  try {
    await assert.rejects(transport({}), { code: 'desktop_required' });
  } finally {
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  }
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '0';
  try {
    await assert.rejects(transport({}), { code: 'stock_alerts_disabled' });
  } finally {
    process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  }
});

test('Community alert transport cannot accept an unbacked batch or switch an existing Cloud handoff', async () => {
  const f = await communityAlertFixture();
  // Queue a real handoff without publishing it, then attempt to cross its mode.
  await assert.rejects(
    createStockAlertHandoff(f.db, {
      send: async () => {
        throw new Error('hold_batch');
      },
    }).tick(f.branch),
    /hold_batch/
  );
  const row = await f.handoff(),
    transport = createCommunityStockAlertTransport(f.db);
  await f.db
    .collection('business_stock_alert_local')
    .updateOne({ _id: row._id }, { $set: { transport: 'cloud' } });
  await assert.rejects(transport(row.batch), { code: 'stock_alert_transport_changed' });
  const foreign = structuredClone(row.batch);
  foreign.batchId = require('node:crypto').randomUUID();
  await assert.rejects(transport(foreign), { code: 'stock_alert_handoff_changed' });
  assert.equal((await f.pending()).length, 1);
  assert.equal(await f.db.collection('business_stock_alert_batches').countDocuments({}), 0);
});

async function withStockRuntime(work) {
  const previousFlag = process.env.POSNIC_BUSINESS_STOCK_ALERTS;
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  try {
    await work();
  } finally {
    if (previousFlag === undefined) delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
    else process.env.POSNIC_BUSINESS_STOCK_ALERTS = previousFlag;
  }
}

test('desktop Community runtime publishes full alert facts and public summary from one scan', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    let scans = 0;
    const worker = createDesktopReportingWorker(f.db, {
      prepareStock: async () => {
        throw new Error('duplicate scan');
      },
      prepareObservation: async (...args) => {
        scans++;
        return require('../src/services/business-stock-summary').prepareDesktopStockObservation(
          ...args
        );
      },
    });
    try {
      await worker.tick();
      const owner = await f.db
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      const saved = await f.db.collection('business_prepared_summaries').findOne({ _id: f.key });
      assert.equal(scans, 1);
      assert.deepEqual(owner.stockSnapshot.summary, saved.summary);
      const frame =
        await require('../src/services/business-stock-snapshot-read').readStockSnapshotPage(
          f.db,
          f.branch
        );
      assert.equal(frame.status, 'ready');
      assert.equal(frame.facts.length, 1);
      const staged = await f.db
        .collection('business_stock_alert_local')
        .findOne({ kind: 'snapshot' });
      assert.equal(staged.observation, undefined);
      assert.ok(staged.completedAt);
      await worker.tick();
      assert.equal(scans, 1);
    } finally {
      worker.stop();
    }
  }));

test('desktop stock observation cannot adopt an assignment replaced during preparation', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    const worker = createDesktopReportingWorker(f.db, {
      prepareObservation: async (...args) => {
        const observation =
          await require('../src/services/business-stock-summary').prepareDesktopStockObservation(
            ...args
          );
        await f.db
          .collection('business_reporting_local')
          .updateOne({ _id: f.key }, { $set: { assignmentId: 'x'.repeat(43), epoch: 2 } });
        return observation;
      },
    });
    try {
      await worker.tick();
      assert.equal(
        await f.db.collection('business_stock_alert_local').countDocuments({ kind: 'snapshot' }),
        0
      );
      assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
      assert.equal(
        (await f.db.collection('business_reporting_local').findOne({ _id: f.key })).error,
        'stock_snapshot_assignment_changed'
      );
    } finally {
      worker.stop();
    }
  }));

test('Cloud desktop runtime advertises snapshot support and stages the agent mailbox without credentials', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    await createLocalReportingBridge(f.db).enqueue();
    await f.db
      .collection('business_reporting_local')
      .updateOne({ _id: f.key }, { $set: { publisherMode: 'cloud' } });
    const previousLocal = process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
    delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
    const worker = createDesktopReportingWorker(f.db);
    try {
      await worker.tick();
      const runtime = await f.db
        .collection('business_reporting_local')
        .findOne({ _id: 'desktop-runtime' });
      assert.equal(runtime.stockSnapshotVersion, 1);
      assert.equal(runtime.stockSnapshotExpiresAt.getTime(), runtime.expiresAt.getTime());
      const staged = await f.db
        .collection('business_stock_alert_local')
        .findOne({ kind: 'snapshot' });
      assert.equal(staged.mode, 'cloud');
      assert.ok(staged.nextTransportAt);
      assert.equal(staged.error, 'stock_snapshot_awaiting_agent');
      assert.equal(staged.observation.facts.length, 1);
      assert.ok(
        (await f.db.collection('business_reporting_local').findOne({ _id: f.key })).pendingSummary
      );
      delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
      await worker.tick();
      const disabled = await f.db
        .collection('business_reporting_local')
        .findOne({ _id: 'desktop-runtime' });
      assert.equal(disabled.stockSnapshotVersion, undefined);
      assert.equal(disabled.stockSnapshotExpiresAt, undefined);
    } finally {
      worker.stop();
      if (previousLocal === undefined) delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
      else process.env.POSNIC_BUSINESS_LOCAL_REPORTING = previousLocal;
    }
  }));

test('desktop runtime drains more than ten stock pages within one bounded reporting tick', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    const first = await f.db.collection('items').findOne({});
    await f.db
      .collection('items')
      .insertMany(Array.from({ length: 1100 }, () => ({ ...first, _id: new ObjectId() })));
    const worker = createDesktopReportingWorker(f.db);
    try {
      await worker.tick();
      const staged = await f.db
        .collection('business_stock_alert_local')
        .findOne({ kind: 'snapshot' });
      assert.equal(staged.observation, undefined);
      assert.ok(staged.completedAt);
      const owner = await f.db
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      assert.equal(owner.stockSnapshot.pages.length, 12);
      assert.equal(owner.stockSnapshot.summary.coverage.verifiedItems, 1101);
    } finally {
      worker.stop();
    }
  }));

test('shutdown after a desktop observation prevents staging and public publication', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    const worker = createDesktopReportingWorker(f.db, {
      prepareObservation: async (...args) => {
        const observation =
          await require('../src/services/business-stock-summary').prepareDesktopStockObservation(
            ...args
          );
        worker.stop();
        return observation;
      },
    });
    await worker.tick();
    assert.equal(
      await f.db.collection('business_stock_alert_local').countDocuments({ kind: 'snapshot' }),
      0
    );
    assert.equal(await f.db.collection('business_prepared_summaries').countDocuments({}), 0);
  }));

test('opted-in Community recipient triggers desktop preparation and Inbox without an interactive stock read', async () =>
  withStockRuntime(async () => {
    const f = await fixture();
    await f.db.collection('business_reporting_requests').deleteOne({ _id: f.key });
    let at = Date.now();
    const now = () => at;
    const user = {
      _id: new ObjectId(),
      license: new ObjectId(f.branch.license),
      activate: true,
      usertype: 'manager',
      access: { item: { read: true } },
      branch_access: [{ branch_id: new ObjectId(f.branch.id) }],
    };
    await f.db.collection('users').insertOne(user);
    const context = await require('../src/services/business-access')
      .createBusinessAccess(f.db, { now })
      .contextFor(user);
    await require('../src/services/business-stock-notification-preferences').saveStockPreference(
      f.db,
      context,
      f.branch.id,
      {
        expectedRevision: 0,
        enabled: true,
        minimumIntervalMinutes: 15,
        quiet: { enabled: false, start: '22:00', end: '07:00' },
      },
      { now }
    );
    const recipient =
      require('../src/services/business-stock-notification-worker').createStockNotificationWorker(
        f.db,
        { now }
      );
    const desktop = createDesktopReportingWorker(f.db, { now });
    try {
      assert.equal((await recipient.tick()).scan.state, 'unavailable');
      assert.ok(await f.db.collection('business_reporting_requests').findOne({ _id: f.key }));
      await desktop.tick();
      at += 15001;
      const result = await recipient.tick();
      assert.equal(result.scan.state, 'complete');
      assert.equal(result.delivery, 'materialized');
      const event = await f.db.collection('business_inbox').findOne({});
      assert.equal(event.kind, 'stock_low');
      assert.equal(event.stock.newLowItemCount, 1);
      assert.equal(event.pushPending, true);
      // Notification cadence must not stop observation of a later healthy state.
      at += 60001;
      await f.db.collection('items').updateMany({}, { $set: { available_quantity: 9 } });
      await recipient.tick();
      await desktop.tick();
      const owner = await f.db
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      assert.equal(owner.stockSnapshot.summary.preparedAt, new Date(at).toISOString());
      assert.equal(owner.stockSnapshot.summary.lowItemCount, 0);
    } finally {
      recipient.stop();
      desktop.stop();
    }
  }));

test(
  'automatic Cloud stock demand crosses desktop, agent and Gateway and recovers a lost receipt',
  { skip: !process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT },
  async () =>
    withStockRuntime(async () => {
      const root = process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT;
      const path = require('node:path');
      const { MongoClient: GatewayClient } = require(
        path.join(root, 'apps/sync-gateway/node_modules/mongodb')
      );
      const { createBusinessPublisher } = require(
        path.join(root, 'apps/sync-agent/src/business-reporting')
      );
      const { createBusinessReporting } = require(
        path.join(root, 'apps/sync-gateway/src/business-reporting')
      );
      const { receiveStockSnapshot } = require(
        path.join(root, 'apps/sync-gateway/src/business-stock-snapshots')
      );
      const f = await fixture();
      const cloud = client.db('automatic_cloud_' + new ObjectId());
      await cloud.collection('branches').insertOne(await f.db.collection('branches').findOne({}));
      let at = Date.now();
      const now = () => at;
      const user = {
        _id: new ObjectId(),
        license: new ObjectId(f.branch.license),
        activate: true,
        usertype: 'manager',
        access: { item: { read: true } },
        branch_access: [{ branch_id: new ObjectId(f.branch.id) }],
      };
      await cloud.collection('users').insertOne(user);
      const context = await require('../src/services/business-access')
        .createBusinessAccess(cloud, { now })
        .contextFor(user);
      await require('../src/services/business-stock-notification-preferences').saveStockPreference(
        cloud,
        context,
        f.branch.id,
        {
          expectedRevision: 0,
          enabled: true,
          minimumIntervalMinutes: 15,
          quiet: { enabled: false, start: '22:00', end: '07:00' },
        },
        { now }
      );
      const guarded = (db) => ({
        collection(name) {
          assert.notEqual(name, 'items');
          assert.notEqual(name, 'sales');
          return db.collection(name);
        },
      });
      const connection = await GatewayClient.connect(mongo.getUri());
      const gatewayDb = guarded(connection.db(cloud.databaseName));
      const reporting = createBusinessReporting(gatewayDb, { now });
      const device = { deviceId: 'automatic-cloud-desktop', branches: [f.branch.id] };
      const publications = [];
      let loseReceipt = true;
      const send = async (endpoint, body) => {
        if (endpoint.endsWith('/work')) return reporting.work(device, body);
        if (endpoint.endsWith('/claim')) return reporting.claim(device, body.branchId);
        if (endpoint.endsWith('/stock-snapshot')) {
          publications.push(structuredClone(body));
          const receipt = await receiveStockSnapshot(gatewayDb, device, body, { now });
          if (loseReceipt) {
            loseReceipt = false;
            throw new Error('lost snapshot receipt');
          }
          return receipt;
        }
        assert.ok(endpoint.endsWith('/summaries'));
        return reporting.publish(device, body);
      };
      const previousLocal = process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
      delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
      const desktop = createDesktopReportingWorker(f.db, { now });
      const recipient =
        require('../src/services/business-stock-notification-worker').createStockNotificationWorker(
          guarded(cloud),
          { now }
        );
      const agent = createBusinessPublisher({ db: connection.db(f.db.databaseName), send, now });
      try {
        assert.equal(await cloud.collection('business_reporting_requests').countDocuments({}), 0);
        assert.equal((await recipient.tick()).scan.state, 'unavailable');
        await desktop.tick();
        await agent.tick();
        await desktop.tick();
        await agent.tick();
        assert.equal(publications.length, 1);
        // A lost response leaves durable agent progress at the same page.
        at += 10001;
        await agent.tick();
        assert.equal(publications.length, 2);
        assert.deepEqual(publications[1], publications[0]);
        await desktop.tick();
        assert.equal(
          (await f.db.collection('business_stock_alert_local').findOne({ kind: 'snapshot' }))
            .observation,
          undefined
        );
        at += 5001;
        const result = await recipient.tick();
        assert.equal(result.scan.state, 'complete');
        assert.equal(result.delivery, 'materialized');
        const event = await cloud.collection('business_inbox').findOne({});
        assert.equal(event.accountId, String(user._id));
        assert.equal(event.kind, 'stock_low');
        assert.equal(event.stock.newLowItemCount, 1);
        assert.equal(event.pushPending, true);
        await recipient.tick();
        assert.equal(await cloud.collection('business_inbox').countDocuments({}), 1);
      } finally {
        desktop.stop();
        recipient.stop();
        await connection.close();
        if (previousLocal === undefined) delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
        else process.env.POSNIC_BUSINESS_LOCAL_REPORTING = previousLocal;
      }
    })
);

test('Community discovery rotates beyond one hundred requests across bridge recreation', async () => {
  const isolated = client.db('community_rotation_' + new ObjectId());
  let at = Date.now();
  const now = () => at;
  const license = new ObjectId();
  const branches = Array.from({ length: 105 }, () => ({
    _id: new ObjectId(),
    license,
    currency: 'INR',
    time_zone: 'Asia/Kolkata',
  }));
  await isolated.collection('branches').insertMany(branches);
  await isolated.collection('business_reporting_requests').insertMany(
    branches.map((branch) => ({
      _id: String(branch._id) + ':stock',
      branchId: String(branch._id),
      license,
      summaryKind: 'stock',
      stockSummaryVersion: 1,
      requestedAt: new Date(at),
      expiresAt: new Date(at + 1800000),
    }))
  );
  await createLocalReportingBridge(isolated, { now }).enqueue();
  assert.equal(
    await isolated.collection('business_reporting_local').countDocuments({ kind: 'job' }),
    100
  );
  at += 1000;
  await createLocalReportingBridge(isolated, { now }).enqueue();
  assert.equal(
    await isolated.collection('business_reporting_local').countDocuments({ kind: 'job' }),
    105
  );
});
