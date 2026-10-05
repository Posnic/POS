'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createBusinessAccess } = require('../src/services/business-access');
const service = require('../src/services/business-notifications');
const readInbox = (db, context) => service.listInbox(db, context, { now: () => due });
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
});
beforeEach(() => {
  db = client.db('notifications_' + new ObjectId());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture() {
  const license = new ObjectId(),
    branch = {
      _id: new ObjectId(),
      license,
      branch_name: 'Central',
      currency: 'INR',
      time_zone: 'Asia/Kolkata',
    };
  const user = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'manager',
    branch_access: [{ branch_id: branch._id }],
    access: { dashboard: { read: true, financials: true } },
  };
  await db.collection('branches').insertOne(branch);
  await db.collection('users').insertOne(user);
  const context = await createBusinessAccess(db).contextFor(user),
    branchId = String(branch._id);
  return { user, branchId, context };
}
const input = () => ({
  expectedRevision: 0,
  enabled: true,
  time: '23:00',
  locale: 'en',
  quiet: { enabled: false, start: '22:00', end: '07:00' },
});
const beforeDue = Date.parse('2026-09-28T17:00:00Z'),
  due = Date.parse('2026-09-28T17:30:00Z');
const summary = (f) => ({
  schemaVersion: 2,
  metricDefinitionVersion: 2,
  businessId: f.context.businessId,
  branchIds: [f.branchId],
  businessDate: '2026-09-28',
  currency: 'INR',
  currencyDigits: 2,
  billedSalesMinor: 10000,
  refundsMinor: 0,
  salesAfterReturnsMinor: 10000,
  completedSales: 1,
  preparedAt: new Date(due).toISOString(),
  freshness: {
    state: 'partial',
    sourceUpdatedAt: null,
    checkedAt: new Date(due).toISOString(),
    complete: false,
  },
});

test('scheduled daily summary reads server sales without a desktop and is delivered once', async () => {
  const f = await fixture();
  await require('../src/services/business-cloud-reports').ensureCloudReportingIndexes(db);
  await db.collection('sales').insertOne({
    _id: new ObjectId(),
    license: f.user.license,
    branch_id: new ObjectId(f.branchId),
    sale_process: 'Add',
    payment_status: 'Paid',
    sales_total: 150,
    date: new Date(beforeDue),
    updated_date: new Date(beforeDue),
  });
  await service.savePreference(db, f.context, f.branchId, input(), { now: () => beforeDue });
  await Promise.all([
    service.drainDue(db, { now: () => due }),
    service.drainDue(db, { now: () => due }),
  ]);
  const inbox = await db.collection('business_inbox').find({}).toArray();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].kind, 'daily_summary');
  assert.equal(inbox[0].summary.completedSales, 1);
  assert.equal(inbox[0].summary.salesAfterReturnsMinor, 15000);
  assert.equal(inbox[0].summary.freshness.complete, false);
  assert.equal(await db.collection('business_reporting_requests').countDocuments({}), 0);
});
test('upcoming schedules request desktop preparation without an open phone and throttle duplicate workers', async () => {
  const f = await fixture();
  await service.savePreference(db, f.context, f.branchId, input(), { now: () => beforeDue });
  let requests = 0;
  const options = {
    now: () => due - 9 * 60000,
    readSummary: async (_db, context, query) => {
      requests++;
      assert.equal(context.accountId, f.context.accountId);
      assert.equal(query.businessDate, '2026-09-28');
      throw Object.assign(new Error('not prepared'), { code: 'summary_unavailable' });
    },
  };
  await Promise.all([service.prepareUpcoming(db, options), service.prepareUpcoming(db, options)]);
  assert.equal(requests, 1);
  assert.equal((await readInbox(db, f.context)).entries.length, 0);
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
  await service.prepareUpcoming(db, { ...options, now: () => due - 3 * 60000 });
  assert.equal(requests, 1);
});
test('notification preferences are scoped to the account and branch and use compare-and-swap revisions', async () => {
  const f = await fixture();
  const initial = await service.getPreference(db, f.context, f.branchId);
  assert.equal(initial.enabled, false);
  assert.equal(initial.revision, 0);
  assert.deepEqual(Object.keys(initial).sort(), [
    'branchId',
    'channel',
    'enabled',
    'locale',
    'nextSendAt',
    'quiet',
    'revision',
    'time',
    'timezone',
  ]);
  const saved = await service.savePreference(db, f.context, f.branchId, input(), {
    now: () => beforeDue,
  });
  assert.equal(saved.nextSendAt, '2026-09-28T17:30:00.000Z');
  await assert.rejects(service.savePreference(db, f.context, f.branchId, input()), {
    code: 'preference_changed',
  });
  await assert.rejects(service.getPreference(db, f.context, String(new ObjectId())), {
    code: 'access_denied',
  });
  await assert.rejects(
    service.savePreference(
      db,
      { ...f.context, capabilities: ['notifications.self.manage'] },
      f.branchId,
      input()
    ),
    { code: 'access_denied' }
  );
  await assert.rejects(
    service.savePreference(db, f.context, f.branchId, { ...input(), recipient: 'someone-else' }),
    { code: 'invalid_preference' }
  );
  await service.savePreference(db, f.context, f.branchId, {
    ...input(),
    enabled: false,
    expectedRevision: 1,
  });
});
test('a scheduled digest is durable without an open app and concurrent workers do not duplicate it', async () => {
  const f = await fixture();
  await service.savePreference(db, f.context, f.branchId, input(), { now: () => beforeDue });
  const options = {
    now: () => due,
    readSummary: async (_db, context, query) => {
      assert.equal(context.accountId, f.context.accountId);
      assert.equal(query.branchId, f.branchId);
      return summary(f);
    },
  };
  await Promise.all([service.drainDue(db, options), service.drainDue(db, options)]);
  const inbox = await readInbox(db, f.context);
  assert.equal(inbox.entries.length, 1);
  assert.equal(inbox.entries[0].summary.salesAfterReturnsMinor, 10000);
  assert.equal(inbox.entries[0].read, false);
  await service.markRead(db, f.context, inbox.entries[0].id);
  assert.equal((await readInbox(db, f.context)).entries[0].read, true);
  const other = await fixture();
  await assert.rejects(service.markRead(db, other.context, inbox.entries[0].id), {
    code: 'entry_unavailable',
  });
  assert.equal((await readInbox(db, other.context)).entries.length, 0);
});
test('missing prepared data creates an unavailable notice, never a zero total, and revoked access stops delivery', async () => {
  const f = await fixture();
  await service.savePreference(db, f.context, f.branchId, input(), { now: () => beforeDue });
  await service.drainDue(db, {
    now: () => due,
    readSummary: async () => {
      throw Object.assign(new Error('missing'), { code: 'summary_unavailable' });
    },
  });
  const inbox = await readInbox(db, f.context);
  assert.equal(inbox.entries[0].kind, 'daily_unavailable');
  assert.equal(inbox.entries[0].summary, null);
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
  await service.drainDue(db, {
    now: () => due + 86400000,
    readSummary: async () => {
      assert.fail('revoked users cannot request financial summaries');
    },
  });
  const current = await createBusinessAccess(db).contextFor({ ...f.user, branch_access: [] });
  assert.equal((await readInbox(db, current)).entries.length, 0);
  assert.equal(
    (
      await db
        .collection('business_notification_preferences')
        .findOne({ accountId: f.context.accountId })
    ).enabled,
    false
  );
});
test('quiet hours defer delivery and an interrupted checkpoint does not insert the same logical day twice', async () => {
  const f = await fixture();
  await service.savePreference(
    db,
    f.context,
    f.branchId,
    { ...input(), quiet: { enabled: true, start: '22:00', end: '07:00' } },
    { now: () => beforeDue }
  );
  await service.drainDue(db, {
    now: () => due,
    readSummary: async () => {
      assert.fail('quiet hours');
    },
  });
  assert.equal((await readInbox(db, f.context)).entries.length, 0);
  const deferred = Date.parse('2026-09-29T01:30:00Z');
  await service.drainDue(db, { now: () => deferred, readSummary: async () => summary(f) });
  const prefs = db.collection('business_notification_preferences');
  await prefs.updateOne(
    { accountId: f.context.accountId },
    { $set: { nextRunAt: new Date(deferred), businessDate: '2026-09-28' } }
  );
  await service.drainDue(db, { now: () => deferred, readSummary: async () => summary(f) });
  assert.equal((await readInbox(db, f.context)).entries.length, 1);
});

test('versioned close mode prevents legacy overwrite and daily delivery, with one winner per revision', async () => {
  const f = await fixture();
  const options = { now: () => beforeDue, scheduleVersion: 2 };
  const closeInput = { ...input(), scheduleVersion: 2, mode: 'register-close' };
  const results = await Promise.allSettled([
    service.savePreference(db, f.context, f.branchId, closeInput, options),
    service.savePreference(db, f.context, f.branchId, closeInput, options),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'preference_changed');
  const saved = await service.getPreference(db, f.context, f.branchId, options);
  assert.equal(saved.mode, 'register-close');
  assert.equal(saved.nextSendAt, null);
  await assert.rejects(service.getPreference(db, f.context, f.branchId), {
    code: 'schedule_version_required',
  });
  await assert.rejects(
    service.savePreference(db, f.context, f.branchId, { ...input(), expectedRevision: 1 }),
    { code: 'preference_changed' }
  );
  await db
    .collection('business_notification_preferences')
    .updateOne({ accountId: f.context.accountId }, { $set: { nextRunAt: new Date(due) } });
  await service.drainDue(db, {
    now: () => due,
    readSummary: () => assert.fail('close mode must not deliver daily'),
  });
  await service.prepareUpcoming(db, {
    now: () => due - 60000,
    readSummary: () => assert.fail('close mode must not prepare daily'),
  });
  assert.equal((await readInbox(db, f.context)).entries.length, 0);
  const daily = await service.savePreference(
    db,
    f.context,
    f.branchId,
    { ...closeInput, mode: 'daily', expectedRevision: 1 },
    options
  );
  assert.equal(daily.nextSendAt, '2026-09-28T17:30:00.000Z');
  assert.equal((await service.getPreference(db, f.context, f.branchId)).revision, 2);
  const stored = await db
    .collection('business_notification_preferences')
    .findOne({ accountId: f.context.accountId });
  assert.equal(stored.closeNotBefore.toISOString(), new Date(beforeDue).toISOString());
  await assert.rejects(
    service.savePreference(
      db,
      f.context,
      f.branchId,
      { ...closeInput, mode: 'both', expectedRevision: 2 },
      options
    ),
    { code: 'invalid_preference' }
  );
});

async function closeFixture() {
  const f = await fixture();
  const start = due - 3 * 3600000;
  await service.savePreference(
    db,
    f.context,
    f.branchId,
    {
      ...input(),
      mode: 'register-close',
      scheduleVersion: 2,
    },
    { now: () => start, scheduleVersion: 2 }
  );
  const close = async (offset = 0, fields = {}) => {
    const row = {
      _id: new ObjectId(),
      license: new ObjectId(f.context.businessId),
      branch_id: new ObjectId(f.branchId),
      register_id: new ObjectId(),
      register_name: 'Counter',
      register_status: 'Closed',
      register_opendate: new Date(start - 3600000),
      register_closedate: new Date(due - 3600000 + offset),
      ...fields,
    };
    await db.collection('cashregister').insertOne(row);
    return row;
  };
  return { ...f, close };
}
const { prepareRegisterCloses } = require('../src/services/business-register-notifications');

test('automatic close preparation is bounded, catches delayed sync and never reads sales', async () => {
  const f = await closeFixture();
  for (let i = 0; i < 12; i++) await f.close();
  await f.close(0, { register_status: 'Opened' });
  await f.close(0, { register_closedate: new Date(due - 5 * 60000) });
  await f.close(0, { register_closedate: new Date(due - 4 * 3600000) });
  await f.close(0, { branch_id: new ObjectId() });
  const guarded = {
    collection: (name) => {
      assert.notEqual(name, 'sales');
      return db.collection(name);
    },
  };
  const first = await Promise.all([
    prepareRegisterCloses(guarded, { now: () => due }),
    prepareRegisterCloses(guarded, { now: () => due }),
  ]);
  assert.equal(
    first.reduce((n, r) => n + r.requested, 0),
    10
  );
  assert.equal(await db.collection('business_reporting_requests').countDocuments(), 10);
  await prepareRegisterCloses(guarded, { now: () => due + 60000 });
  assert.equal(await db.collection('business_reporting_requests').countDocuments(), 12);
  // An old close arriving behind the previous cursor is found by the next sweep.
  const late = await f.close(-60000);
  await prepareRegisterCloses(guarded, { now: () => due + 120000 });
  assert.ok(
    await db.collection('business_reporting_requests').findOne({ sessionId: String(late._id) })
  );
  assert.ok((await db.collection('business_inbox').countDocuments()) > 0);
  assert.equal((await readInbox(db, f.context)).entries.length, 0);
});

test('close preparation revokes lost access and a changed preference stops the claimed page', async () => {
  const f = await closeFixture();
  await f.close();
  await f.close();
  let calls = 0;
  await prepareRegisterCloses(db, {
    now: () => due,
    readSummary: async () => {
      calls++;
      await service.savePreference(
        db,
        f.context,
        f.branchId,
        {
          ...input(),
          expectedRevision: 1,
          mode: 'daily',
          scheduleVersion: 2,
        },
        { now: () => due, scheduleVersion: 2 }
      );
    },
  });
  assert.equal(calls, 1);
  const preference = await db
    .collection('business_notification_preferences')
    .findOne({ accountId: f.context.accountId });
  assert.equal(preference.closeCursor, undefined);
  assert.equal(preference.mode, 'daily');
  await service.savePreference(
    db,
    f.context,
    f.branchId,
    {
      ...input(),
      expectedRevision: 2,
      mode: 'register-close',
      scheduleVersion: 2,
    },
    { now: () => due, scheduleVersion: 2 }
  );
  await db.collection('users').updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
  await prepareRegisterCloses(db, {
    now: () => due + 60000,
    readSummary: () => assert.fail('revoked access'),
  });
  assert.equal(
    (
      await db
        .collection('business_notification_preferences')
        .findOne({ accountId: f.context.accountId })
    ).enabled,
    false
  );
});

test('close preparation retries database failures without advancing past the failed session', async () => {
  const f = await closeFixture();
  await f.close();
  await prepareRegisterCloses(db, {
    now: () => due,
    readSummary: () => {
      throw new Error('temporary database failure');
    },
  });
  let pref = await db
    .collection('business_notification_preferences')
    .findOne({ accountId: f.context.accountId });
  assert.equal(pref.enabled, true);
  assert.equal(pref.closeCursor, undefined);
  assert.equal(pref.closeScanError, 'preparation_unavailable');
  await prepareRegisterCloses(db, { now: () => due + 60000 });
  assert.equal(await db.collection('business_reporting_requests').countDocuments(), 1);
  pref = await db
    .collection('business_notification_preferences')
    .findOne({ accountId: f.context.accountId });
  assert.equal(pref.closeScanError, undefined);
});

test('close Inbox materialization obeys quiet hours and survives a lost scan checkpoint exactly once', async () => {
  const f = await closeFixture();
  const row = await f.close();
  await db
    .collection('business_notification_preferences')
    .updateOne(
      { accountId: f.context.accountId },
      { $set: { quiet: { enabled: true, start: '22:00', end: '07:00' } } }
    );
  await prepareRegisterCloses(db, { now: () => due });
  assert.equal(await db.collection('business_inbox').countDocuments(), 0);
  const morning = Date.parse('2026-09-29T01:30:00Z');
  let interrupted = true;
  const crash = {
    collection(name) {
      const c = db.collection(name);
      if (name !== 'business_notification_preferences') return c;
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'updateOne')
            return async (filter, update, ...args) => {
              if (interrupted && update.$set?.closeCursor) {
                interrupted = false;
                throw new Error('checkpoint interrupted');
              }
              return target.updateOne(filter, update, ...args);
            };
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await prepareRegisterCloses(crash, { now: () => morning });
  assert.equal(await db.collection('business_inbox').countDocuments(), 1);
  await prepareRegisterCloses(db, { now: () => morning + 60000 });
  assert.equal(await db.collection('business_inbox').countDocuments(), 1);
  const event = await db.collection('business_inbox').findOne({});
  assert.equal(event.kind, 'register_unavailable');
  assert.equal(event.summary, null);
  assert.equal(event.sessionId, String(row._id));
  assert.equal(event.scheduleRevision, 1);
});

test('close materialization rechecks source, permission and preparation wait before inserting', async () => {
  for (const change of ['reopen', 'permission', 'wait']) {
    const f = await closeFixture();
    const row = await f.close(
      0,
      change === 'wait' ? { register_closedate: new Date(due - 15 * 60000) } : {}
    );
    await prepareRegisterCloses(db, {
      now: () => due,
      readSummary: async () => {
        if (change === 'reopen')
          await db
            .collection('cashregister')
            .updateOne({ _id: row._id }, { $set: { register_status: 'Opened' } });
        if (change === 'permission')
          await db
            .collection('users')
            .updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
        throw Object.assign(new Error('not ready'), { code: 'summary_unavailable' });
      },
    });
    assert.equal(
      await db.collection('business_inbox').countDocuments({ accountId: f.context.accountId }),
      0
    );
    await db
      .collection('business_notification_preferences')
      .updateOne({ accountId: f.context.accountId }, { $set: { enabled: false } });
  }
});

test('an actual desktop-prepared session becomes one incomplete-source Inbox summary', async () => {
  const f = await closeFixture();
  const row = await f.close();
  await db.collection('sales').insertOne({
    license: row.license,
    branch_id: row.branch_id,
    cashregister_id: String(row._id),
    sale_process: 'Add',
    payment_status: 'Paid',
    sales_total: 125,
    date: new Date(due - 2 * 3600000),
    updated_date: new Date(due - 2 * 3600000),
  });
  const old = process.env.POSNIC_DESKTOP;
  let prepared;
  try {
    process.env.POSNIC_DESKTOP = '1';
    const branch = { ...f.context.branches[0], license: f.context.businessId };
    prepared =
      await require('../src/services/business-register-summary').prepareDesktopRegisterSummary(
        db,
        branch,
        String(row._id),
        { now: () => due }
      );
  } finally {
    if (old === undefined) delete process.env.POSNIC_DESKTOP;
    else process.env.POSNIC_DESKTOP = old;
  }
  await db.collection('business_reporting_publishers').insertOne({
    _id: f.branchId,
    license: row.license,
    assignmentId: 'assignment',
    deviceId: 'desktop',
    epoch: 1,
    lastSequence: 1,
  });
  await db.collection('business_prepared_summaries').insertOne({
    _id: f.branchId + ':session:' + row._id,
    license: row.license,
    branch_id: row.branch_id,
    publisherAssignmentId: 'assignment',
    publisherDeviceId: 'desktop',
    publisherEpoch: 1,
    sequence: 1,
    receivedAt: new Date(due),
    summary: prepared,
  });
  await prepareRegisterCloses(db, { now: () => due });
  await prepareRegisterCloses(db, { now: () => due + 60000 });
  const events = await db.collection('business_inbox').find({}).toArray();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'register_summary');
  assert.equal(events[0].summary.salesAfterReturnsMinor, 12500);
  assert.equal(events[0].summary.freshness.complete, false);
  assert.equal(events[0].summary.close.closeRevision, events[0].closeRevision);
  const options = { now: () => due + 60000, includeRegisters: true };
  assert.equal((await readInbox(db, f.context)).entries.length, 0);
  const visible = await service.listInbox(db, f.context, options);
  assert.equal(visible.entries[0].summary.salesAfterReturnsMinor, 12500);
  assert.equal(visible.entries[0].close.sessionId, String(row._id));
  assert.equal(
    (await service.listInbox(db, { ...f.context, capabilities: ['overview.read'] }, options))
      .entries.length,
    0
  );
  // Stored financial data must not outlive the assigned publisher on a fresh read.
  await db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branchId }, { $set: { epoch: 2 } });
  const invalidated = await service.listInbox(db, f.context, options);
  assert.equal(invalidated.entries[0].kind, 'register_unavailable');
  assert.equal(invalidated.entries[0].summary, null);
  await db
    .collection('cashregister')
    .updateOne({ _id: row._id }, { $set: { register_status: 'Opened' } });
  assert.equal((await service.listInbox(db, f.context, options)).entries.length, 0);
  await assert.rejects(service.markRead(db, f.context, String(events[0]._id)), {
    code: 'entry_unavailable',
  });
});

test('negotiated close Inbox uses bounded pages and keeps a cursor through hidden events', async () => {
  const f = await closeFixture();
  for (let i = 0; i < 12; i++) await f.close();
  await prepareRegisterCloses(db, { now: () => due });
  await prepareRegisterCloses(db, { now: () => due + 60000 });
  const options = { now: () => due + 60000, includeRegisters: true };
  const page = await service.listInbox(db, f.context, options);
  assert.equal(page.entries.length, 10);
  assert.ok(page.next);
  const next = await service.listInbox(db, f.context, { ...options, before: page.next });
  assert.equal(next.entries.length, 2);
  assert.equal(next.next, null);
  await db.collection('cashregister').updateMany({}, { $set: { register_status: 'Opened' } });
  const hidden = await service.listInbox(db, f.context, options);
  assert.equal(hidden.entries.length, 0);
  assert.equal(hidden.next, page.next);
});
