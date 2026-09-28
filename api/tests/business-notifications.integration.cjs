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
