'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { prepareDesktopSummary } = require('../src/services/business-summary-preparer');
const { createDesktopReportingWorker } = require('../src/services/business-reporting-worker');
let mongo, client, db;
const priorDesktop = process.env.POSNIC_DESKTOP;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('business_summary');
  await db.collection('sales').createIndex({ license: 1, branch_id: 1, _id: 1 });
  process.env.POSNIC_DESKTOP = '1';
});
after(async () => {
  await client?.close();
  await mongo?.stop();
  if (priorDesktop === undefined) delete process.env.POSNIC_DESKTOP;
  else process.env.POSNIC_DESKTOP = priorDesktop;
});
function branch() {
  return {
    id: String(new ObjectId()),
    license: String(new ObjectId()),
    currency: 'INR',
    currencyDigits: 2,
    timezone: 'Asia/Kolkata',
  };
}
const sale = (b, extra = {}) => ({
  _id: new ObjectId(),
  license: new ObjectId(b.license),
  branch_id: new ObjectId(b.id),
  sale_process: 'Add',
  payment_status: 'Paid',
  sales_total: 100,
  date: new Date('2026-09-27T19:00:00Z'),
  updated_date: new Date('2026-09-28T10:00:00Z'),
  ...extra,
});
test('desktop preparation pages through scoped source records, includes old-sale refunds and never claims complete sync', async () => {
  const b = branch();
  await db.collection('sales').insertMany([
    ...Array.from({ length: 205 }, () => sale(b)),
    sale(b, { sale_process: 'KOT', payment_status: 'Unpaid' }),
    sale(b, { branch_id: new ObjectId() }),
    sale(b, { license: new ObjectId() }),
    sale(b, {
      date: new Date('2026-09-20T10:00:00Z'),
      sale_process: 'PartialReturn',
      items_return_total: 25,
      items_return: [
        {
          returnArray: {
            returnObjId: new ObjectId(),
            returnDate: new Date('2026-09-28T10:00:00Z'),
            itemsTotalAmount: 25,
          },
        },
      ],
    }),
  ]);
  const result = await prepareDesktopSummary(db, b, '2026-09-28');
  assert.equal(result.billedSalesMinor, 2050000);
  assert.equal(result.refundsMinor, 2500);
  assert.equal(result.salesAfterReturnsMinor, 2047500);
  assert.equal(result.completedSales, 205);
  assert.equal(result.sourceDocuments, 207);
  assert.equal(result.sourceComplete, false);
});
test('malformed source amounts do not turn into a published zero or a partial sum', async () => {
  const b = branch();
  await db.collection('sales').insertMany([sale(b), sale(b, { sales_total: 'broken' })]);
  await assert.rejects(prepareDesktopSummary(db, b, '2026-09-28'), { code: 'invalid_amount' });
});

test('opt-in item preparation ranks scoped sales and suppresses an incomplete ranking without hiding overview totals', async () => {
  const b = branch();
  const item = new ObjectId();
  await db.collection('sales').insertMany([
    sale(b, {
      items: [
        {
          item_id: String(item),
          item_name: 'Tea',
          item_unit: 'cup',
          item_quantity: 2,
          total_amount: 100,
        },
      ],
    }),
    sale(b, { date: new Date('2026-08-01T00:00:00Z') }), // Unrelated historical day has no item facts.
    sale(b, { branch_id: new ObjectId() }),
  ]);
  const legacy = await prepareDesktopSummary(db, b, '2026-09-28');
  assert.equal(Object.hasOwn(legacy, 'itemInsights'), false);
  const result = await prepareDesktopSummary(db, b, '2026-09-28', { includeItems: true });
  assert.equal(result.itemInsights.state, 'available');
  assert.equal(result.itemInsights.sourceSales, 1);
  assert.equal(result.itemInsights.items[0].salesAfterReturnsMinor, result.salesAfterReturnsMinor);
  assert.deepEqual(result.itemInsights.items[0].quantities, [
    { unit: 'cup', soldMilli: 2000, returnedMilli: 0 },
  ]);
  await db.collection('sales').insertOne(sale(b));
  const incomplete = await prepareDesktopSummary(db, b, '2026-09-28', { includeItems: true });
  assert.equal(incomplete.billedSalesMinor, 20000);
  assert.equal(incomplete.itemInsights.state, 'incomplete');
  assert.equal(incomplete.itemInsights.unavailableSales, 1);
  assert.deepEqual(incomplete.itemInsights.items, []);
  assert.equal(incomplete.itemInsights.totalItems, null);
});
test('Cloud runtime, cancellation and elapsed budgets stop preparation', async () => {
  const b = branch();
  await db.collection('sales').insertOne(sale(b));
  process.env.POSNIC_DESKTOP = '0';
  await assert.rejects(prepareDesktopSummary(db, b, '2026-09-28'), { code: 'desktop_required' });
  process.env.POSNIC_DESKTOP = '1';
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareDesktopSummary(db, b, '2026-09-28', { signal: controller.signal }), {
    code: 'cancelled',
  });
  let calls = 0;
  await assert.rejects(prepareDesktopSummary(db, b, '2026-09-28', { now: () => calls++ * 31000 }), {
    code: 'preparation_budget_exceeded',
  });
});

async function workFixture() {
  const b = branch(),
    localDb = client.db('desktop_' + b.id);
  await localDb.collection('branches').insertOne({
    _id: new ObjectId(b.id),
    license: new ObjectId(b.license),
    currency: b.currency,
    time_zone: b.timezone,
  });
  await localDb.collection('sales').insertOne(sale(b));
  const job = {
    _id: b.id + ':2026-09-28',
    kind: 'job',
    branchId: b.id,
    license: b.license,
    businessDate: '2026-09-28',
    currency: b.currency,
    timezone: b.timezone,
    assignmentId: 'assigned',
    requestedAt: new Date(),
    expiresAt: new Date(Date.now() + 1800000),
  };
  await localDb.collection('business_reporting_local').insertOne(job);
  return { localDb, job, local: localDb.collection('business_reporting_local') };
}
test('desktop worker prepares a leased job, stages it durably and does not repeat an unpublished scan', async () => {
  const f = await workFixture();
  let calls = 0;
  const worker = createDesktopReportingWorker(f.localDb, {
    prepare: async (...args) => {
      calls++;
      return prepareDesktopSummary(...args);
    },
  });
  await Promise.all([worker.tick(), worker.tick()]);
  const staged = await f.local.findOne({ _id: f.job._id });
  assert.equal(staged.pendingSummary.salesAfterReturnsMinor, 10000);
  assert.equal(staged.pendingSummary.sourceComplete, false);
  assert.equal(staged.leaseId, undefined);
  await worker.tick();
  assert.equal(calls, 1);
  assert.equal((await f.local.findOne({ _id: 'desktop-runtime' })).protocolVersion, 2);
  worker.stop();
});
test('desktop worker rejects results after ownership changes and records failure without crashing checkout', async () => {
  const f = await workFixture();
  const worker = createDesktopReportingWorker(f.localDb, {
    prepare: async () => {
      await f.local.updateOne(
        { _id: f.job._id },
        { $set: { assignmentId: 'new-owner' }, $unset: { leaseId: '', leaseUntil: '' } }
      );
      return { shouldNotPublish: true };
    },
  });
  await worker.tick();
  assert.equal((await f.local.findOne({ _id: f.job._id })).pendingSummary, undefined);
  worker.stop();
  const broken = await workFixture();
  const failed = createDesktopReportingWorker(broken.localDb, {
    prepare: async () => {
      throw Object.assign(new Error('bad sale'), { code: 'invalid_amount' });
    },
  });
  await failed.tick();
  const state = await broken.local.findOne({ _id: broken.job._id });
  assert.equal(state.error, 'invalid_amount');
  assert.equal(state.pendingSummary, undefined);
  assert.equal(state.leaseUntil, undefined);
  failed.stop();
});
test('stopping a desktop worker cancels preparation and never stages a result', async () => {
  const f = await workFixture();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const worker = createDesktopReportingWorker(f.localDb, {
    prepare: async (_db, _branch, _day, { signal }) => {
      started();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { shouldNotPublish: true };
    },
  });
  const work = worker.tick();
  await ready;
  worker.stop();
  await work;
  assert.equal((await f.local.findOne({ _id: f.job._id })).pendingSummary, undefined);
});

test('opt-in Community desktop prepares and serves the same summary without Cloud or a sync agent', async () => {
  const f = await workFixture();
  const { readBusinessOverview } = require('../src/services/business-reports');
  const at = Date.parse('2026-09-28T12:00:00Z');
  const context = {
    businessId: f.job.license,
    capabilities: ['overview.read'],
    branches: [
      { id: f.job.branchId, currency: 'INR', currencyDigits: 2, timezone: 'Asia/Kolkata' },
    ],
  };
  const query = { branchId: f.job.branchId, businessDate: f.job.businessDate };
  await assert.rejects(readBusinessOverview(f.localDb, context, query, { now: () => at }), {
    code: 'summary_unavailable',
  });
  const previous = process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  let failWrite = true;
  const failingDb = {
    collection(name) {
      const collection = f.localDb.collection(name);
      if (name !== 'business_prepared_summaries') return collection;
      return {
        async replaceOne(...args) {
          if (failWrite) {
            failWrite = false;
            throw new Error('interrupted Community publication');
          }
          return collection.replaceOne(...args);
        },
      };
    },
  };
  let worker = createDesktopReportingWorker(failingDb, { now: () => at });
  try {
    await worker.tick();
    assert.ok(
      (await f.localDb.collection('business_reporting_publishers').findOne({ _id: f.job.branchId }))
        .pending
    );
    await assert.rejects(readBusinessOverview(f.localDb, context, query, { now: () => at }), {
      code: 'summary_unavailable',
    });
    worker.stop();
    worker = createDesktopReportingWorker(f.localDb, { now: () => at });
    await worker.tick();
    const summary = await readBusinessOverview(f.localDb, context, query, { now: () => at });
    assert.equal(summary.salesAfterReturnsMinor, 10000);
    assert.equal(summary.freshness.complete, false);
    assert.equal(await f.local.findOne({ _id: 'desktop-runtime' }), null);
    const owner = await f.localDb
      .collection('business_reporting_publishers')
      .findOne({ _id: f.job.branchId });
    assert.match(owner.deviceId, /^community-/);
    assert.equal(owner.pending, undefined);
  } finally {
    worker.stop();
    if (previous === undefined) delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
    else process.env.POSNIC_BUSINESS_LOCAL_REPORTING = previous;
  }
});
