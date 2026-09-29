'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createDesktopReportingWorker } = require('../src/services/business-reporting-worker');
const { prepareDesktopRegisterSummary } = require('../src/services/business-register-summary');
const { registerCloseFact } = require('../src/services/business-register-close');
const { readRegisterSummary } = require('../src/services/business-register-reports');
const at = Date.parse('2026-09-29T12:00:00Z'),
  now = () => at;
const previous = {
  desktop: process.env.POSNIC_DESKTOP,
  local: process.env.POSNIC_BUSINESS_LOCAL_REPORTING,
};
let mongo, client;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  process.env.POSNIC_DESKTOP = '1';
  delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
});
after(async () => {
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
  const db = client.db('register_publication_' + new ObjectId());
  const branch = {
    id: String(new ObjectId()),
    license: String(new ObjectId()),
    currency: 'INR',
    currencyDigits: 2,
    timezone: 'Asia/Kolkata',
  };
  await db.collection('branches').insertOne({
    _id: new ObjectId(branch.id),
    license: new ObjectId(branch.license),
    currency: branch.currency,
    time_zone: branch.timezone,
  });
  const close = {
    _id: new ObjectId(),
    license: new ObjectId(branch.license),
    branch_id: new ObjectId(branch.id),
    register_id: new ObjectId(),
    register_name: 'Main till',
    register_status: 'Closed',
    register_opendate: new Date(at - 3 * 3600000),
    register_closedate: new Date(at - 3600000),
  };
  await db.collection('cashregister').insertOne(close);
  await db.collection('sales').insertOne({
    _id: new ObjectId(),
    license: close.license,
    branch_id: close.branch_id,
    cashregister_id: String(close._id),
    sale_process: 'Add',
    payment_status: 'Paid',
    sales_total: 100,
    date: new Date(at - 2 * 3600000),
    updated_date: new Date(at - 2 * 3600000),
  });
  const fact = registerCloseFact(close, branch, { now });
  const job = {
    _id: branch.id + ':session:' + close._id,
    kind: 'job',
    summaryKind: 'register-session',
    registerSummaryVersion: 1,
    branchId: branch.id,
    license: branch.license,
    sessionId: String(close._id),
    closeRevision: fact.closeRevision,
    businessDate: fact.businessDate,
    currency: branch.currency,
    timezone: branch.timezone,
    assignmentId: 'assigned',
    requestedAt: new Date(at),
    expiresAt: new Date(at + 1800000),
  };
  await db.collection('business_reporting_local').insertOne(job);
  return { db, branch, close, job };
}

const readContext = (f) => ({
  businessId: f.branch.license,
  accountId: String(new ObjectId()),
  branches: [f.branch],
  capabilities: ['overview.read', 'notifications.self.manage'],
});
const readQuery = (f) => ({ branchId: f.branch.id, sessionId: f.job.sessionId });
function guardedReads(db) {
  return {
    collection(name) {
      assert.ok(
        [
          'cashregister',
          'business_reporting_requests',
          'business_reporting_publishers',
          'business_prepared_summaries',
        ].includes(name),
        'reads may not calculate financial reports'
      );
      return db.collection(name);
    },
  };
}
async function publishedFixture() {
  const f = await fixture(),
    context = readContext(f);
  await assert.rejects(readRegisterSummary(guardedReads(f.db), context, readQuery(f), { now }), {
    code: 'summary_unavailable',
  });
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  const worker = createDesktopReportingWorker(f.db, { now });
  try {
    await worker.tick();
  } finally {
    worker.stop();
    delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
  }
  return { ...f, context };
}
test('bounded reads request actual desktop preparation and return only scoped partial or delayed totals', async () => {
  const f = await publishedFixture();
  const readDb = guardedReads(f.db);
  const result = await readRegisterSummary(readDb, f.context, readQuery(f), { now });
  assert.equal(result.salesAfterReturnsMinor, 10000);
  assert.equal(result.close.sessionId, f.job.sessionId);
  assert.equal(result.businessId, f.branch.license);
  assert.equal(result.freshness.state, 'partial');
  assert.equal(result.freshness.complete, false);
  assert.equal(result.publisherAssignmentId, undefined);
  assert.equal(result.sourceDocuments, undefined);
  const request = await f.db.collection('business_reporting_requests').findOne({ _id: f.job._id });
  assert.equal(request.summaryKind, 'register-session');
  assert.equal(request.closeRevision, result.close.closeRevision);
  assert.equal(request.expiresAt - request.requestedAt, 1800000);
  assert.equal(
    (await readRegisterSummary(readDb, f.context, readQuery(f), { now: () => at + 16 * 60000 }))
      .freshness.state,
    'delayed'
  );
});
test('register reads enforce permission and branch scope before I/O and do not queue ineligible closes', async () => {
  const f = await fixture(),
    context = readContext(f);
  const noIo = {
    collection() {
      throw new Error('unauthorized database access');
    },
  };
  for (const capabilities of [[], ['overview.read'], ['notifications.self.manage']])
    await assert.rejects(
      readRegisterSummary(noIo, { ...context, capabilities }, readQuery(f), { now }),
      { code: 'access_denied' }
    );
  await assert.rejects(
    readRegisterSummary(noIo, { ...context, branches: [] }, readQuery(f), { now }),
    { code: 'access_denied' }
  );
  await assert.rejects(
    readRegisterSummary(noIo, context, { ...readQuery(f), license: 'override' }, { now }),
    { code: 'invalid_request' }
  );
  await assert.rejects(
    readRegisterSummary(f.db, context, readQuery(f), { now: () => at - 55 * 60000 }),
    { code: 'close_grace_pending' }
  );
  await assert.rejects(
    readRegisterSummary(f.db, context, readQuery(f), { now: () => at + 33 * 86400000 }),
    { code: 'date_out_of_range' }
  );
  assert.equal(await f.db.collection('business_reporting_requests').countDocuments({}), 0);
});
test('register reads reject corrupt metrics and unexpected payloads without returning plausible totals', async () => {
  const f = await publishedFixture(),
    snapshots = f.db.collection('business_prepared_summaries');
  const row = await snapshots.findOne({ _id: f.job._id });
  for (const mutate of [
    (s) => {
      s.salesAfterReturnsMinor++;
    },
    (s) => {
      s.sourceComplete = true;
    },
    (s) => {
      s.sourceDocuments = 100001;
    },
    (s) => {
      s.close.sessionId = String(new ObjectId());
    },
    (s) => {
      s.close.privateData = 'hidden';
    },
    (s) => {
      s.secret = 'hidden';
    },
    (s) => {
      s.currencyDigits = 3;
    },
    (s) => {
      s.preparedAt = s.close.closedAt;
    },
    (s) => {
      s.billedSalesMinor = Number.MAX_SAFE_INTEGER + 1;
    },
  ]) {
    const summary = structuredClone(row.summary);
    mutate(summary);
    await snapshots.updateOne({ _id: f.job._id }, { $set: { summary } });
    await assert.rejects(
      readRegisterSummary(guardedReads(f.db), f.context, readQuery(f), { now }),
      { code: 'summary_unavailable' }
    );
  }
});
test('register reads recheck publisher and close state after fetching the snapshot', async () => {
  for (const change of ['publisher', 'source']) {
    const f = await publishedFixture();
    let changed = false;
    const racing = {
      collection(name) {
        const c = guardedReads(f.db).collection(name);
        if (name !== 'business_prepared_summaries') return c;
        return {
          async findOne(...args) {
            const row = await c.findOne(...args);
            if (!changed) {
              changed = true;
              if (change === 'publisher')
                await f.db
                  .collection('business_reporting_publishers')
                  .updateOne(
                    { _id: f.branch.id },
                    { $set: { assignmentId: 'x'.repeat(43), epoch: 2 } }
                  );
              else
                await f.db
                  .collection('cashregister')
                  .updateOne({ _id: f.close._id }, { $set: { register_status: 'Opened' } });
            }
            return row;
          },
        };
      },
    };
    await assert.rejects(readRegisterSummary(racing, f.context, readQuery(f), { now }), {
      code: 'summary_unavailable',
    });
  }
});
test('a negotiated session job prepares its own totals and stages once without running the daily preparer', async () => {
  const f = await fixture();
  let scans = 0;
  const worker = createDesktopReportingWorker(f.db, {
    now,
    prepare: () => {
      throw new Error('daily preparer called');
    },
    prepareRegister: (...args) => {
      scans++;
      return prepareDesktopRegisterSummary(...args);
    },
  });
  await worker.tick();
  await worker.tick();
  worker.stop();
  const staged = await f.db.collection('business_reporting_local').findOne({ _id: f.job._id });
  assert.equal(staged.pendingSummary.close.sessionId, f.job.sessionId);
  assert.equal(staged.pendingSummary.billedSalesMinor, 10000);
  assert.equal(staged.pendingSummary.sourceComplete, false);
  assert.equal(staged.pendingSummary.businessDate, undefined);
  assert.equal(scans, 1);
  assert.equal(
    (await f.db.collection('business_reporting_local').findOne({ _id: 'desktop-runtime' }))
      .registerSummaryVersion,
    1
  );
});
test('malformed or future job contracts cannot fall through to daily preparation', async () => {
  for (const change of [
    { summaryKind: 'future' },
    { registerSummaryVersion: 2 },
    { closeRevision: 'bad' },
    { sessionId: 'bad' },
    { businessDate: '2026-02-30' },
  ]) {
    const f = await fixture();
    await f.db
      .collection('business_reporting_local')
      .updateOne({ _id: f.job._id }, { $set: change });
    let scans = 0;
    const worker = createDesktopReportingWorker(f.db, {
      now,
      prepare: () => {
        scans++;
      },
      prepareRegister: () => {
        scans++;
      },
    });
    await worker.tick();
    worker.stop();
    const state = await f.db.collection('business_reporting_local').findOne({ _id: f.job._id });
    assert.equal(scans, 0);
    assert.equal(state.pendingSummary, undefined);
    assert.equal(state.error, 'invalid_reporting_job');
  }
});
test('a mismatched source revision or request replaced during a scan cannot stage a result', async () => {
  for (const concurrent of [false, true]) {
    const f = await fixture();
    if (!concurrent)
      await f.db
        .collection('business_reporting_local')
        .updateOne({ _id: f.job._id }, { $set: { closeRevision: '0'.repeat(64) } });
    const worker = createDesktopReportingWorker(f.db, {
      now,
      prepareRegister: async (...args) => {
        const result = await prepareDesktopRegisterSummary(...args);
        if (concurrent)
          await f.db
            .collection('business_reporting_local')
            .updateOne({ _id: f.job._id }, { $set: { closeRevision: '0'.repeat(64) } });
        return result;
      },
    });
    await worker.tick();
    worker.stop();
    assert.equal(
      (await f.db.collection('business_reporting_local').findOne({ _id: f.job._id }))
        .pendingSummary,
      undefined
    );
  }
});
async function request(f) {
  await f.db
    .collection('business_reporting_requests')
    .insertOne({ ...f.job, license: new ObjectId(f.branch.license) });
}
test('Community session publication recovers a reserved write without replacing the daily snapshot', async () => {
  const f = await fixture();
  await request(f);
  const dailyKey = f.branch.id + ':' + f.job.businessDate;
  await f.db
    .collection('business_prepared_summaries')
    .insertOne({ _id: dailyKey, sentinel: 'daily remains separate' });
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  let fail = true;
  const interrupted = {
    collection(name) {
      const c = f.db.collection(name);
      return name !== 'business_prepared_summaries'
        ? c
        : {
            replaceOne(...args) {
              if (fail) {
                fail = false;
                throw new Error('interrupted write');
              }
              return c.replaceOne(...args);
            },
          };
    },
  };
  let worker = createDesktopReportingWorker(interrupted, { now });
  try {
    await worker.tick();
    worker.stop();
    assert.ok(
      (await f.db.collection('business_reporting_publishers').findOne({ _id: f.branch.id })).pending
    );
    worker = createDesktopReportingWorker(f.db, { now });
    await worker.tick();
    const result = await f.db.collection('business_prepared_summaries').findOne({ _id: f.job._id });
    assert.equal(result.summary.salesAfterReturnsMinor, 10000);
    assert.equal(result.summary.close.closeRevision, f.job.closeRevision);
    const other = {
      ...f.close,
      _id: new ObjectId(),
      register_opendate: new Date(at - 5 * 3600000),
      register_closedate: new Date(at - 4 * 3600000),
    };
    await f.db.collection('cashregister').insertOne(other);
    await f.db.collection('sales').insertOne({
      license: other.license,
      branch_id: other.branch_id,
      cashregister_id: String(other._id),
      sale_process: 'Add',
      payment_status: 'Paid',
      sales_total: 35,
      date: new Date(at - 4.5 * 3600000),
      updated_date: new Date(at - 4.5 * 3600000),
    });
    const otherFact = registerCloseFact(other, f.branch, { now });
    const otherKey = f.branch.id + ':session:' + other._id;
    await f.db.collection('business_reporting_requests').insertOne({
      ...f.job,
      _id: otherKey,
      sessionId: String(other._id),
      closeRevision: otherFact.closeRevision,
      license: new ObjectId(f.branch.license),
    });
    await worker.tick();
    assert.equal(
      (await f.db.collection('business_prepared_summaries').findOne({ _id: otherKey })).summary
        .salesAfterReturnsMinor,
      3500
    );
    assert.equal(
      (await f.db.collection('business_prepared_summaries').findOne({ _id: f.job._id })).summary
        .salesAfterReturnsMinor,
      10000
    );
    assert.equal(
      (await f.db.collection('business_prepared_summaries').findOne({ _id: dailyKey })).sentinel,
      'daily remains separate'
    );
    assert.equal(
      (await f.db.collection('business_reporting_publishers').findOne({ _id: f.branch.id }))
        .pending,
      undefined
    );
  } finally {
    worker.stop();
    delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
  }
});
test('Community recovery rejects a source reopened after the reserved publication', async () => {
  const f = await fixture();
  await request(f);
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  const interrupted = {
    collection(name) {
      return name !== 'business_prepared_summaries'
        ? f.db.collection(name)
        : {
            replaceOne() {
              throw new Error('interrupted write');
            },
          };
    },
  };
  let worker = createDesktopReportingWorker(interrupted, { now });
  try {
    await worker.tick();
    worker.stop();
    await f.db
      .collection('cashregister')
      .updateOne({ _id: f.close._id }, { $set: { register_status: 'Opened' } });
    worker = createDesktopReportingWorker(f.db, { now });
    await worker.tick();
    assert.equal(
      await f.db.collection('business_prepared_summaries').findOne({ _id: f.job._id }),
      null
    );
    const owner = await f.db
      .collection('business_reporting_publishers')
      .findOne({ _id: f.branch.id });
    assert.equal(owner.pending, undefined);
    assert.equal(owner.lastPublicationError, 'close_changed');
  } finally {
    worker.stop();
    delete process.env.POSNIC_BUSINESS_LOCAL_REPORTING;
  }
});
