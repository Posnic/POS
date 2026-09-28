'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  getApprovalPreference,
  saveApprovalPreference,
  canReceiveApproval,
  drainApprovalAlerts,
} = require('../src/services/business-approval-notifications');
let mongo, client, db;
const oldFlag = process.env.POSNIC_BUSINESS_DECISIONS;
before(async () => {
  process.env.POSNIC_BUSINESS_DECISIONS = '1';
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('approval_notifications');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
  if (oldFlag === undefined) delete process.env.POSNIC_BUSINESS_DECISIONS;
  else process.env.POSNIC_BUSINESS_DECISIONS = oldFlag;
});
function fixture() {
  const user = {
    _id: new ObjectId(),
    license: new ObjectId(),
    usertype: 'manager',
    access: {
      dashboard: { read: true, financials: true },
      pos: { discount_approve_remote: true, discount_max_percent: 20 },
    },
  };
  const branchId = String(new ObjectId());
  const context = {
    accountId: String(user._id),
    businessId: String(user.license),
    capabilities: ['approvals.read', 'notifications.self.manage'],
    branches: [{ id: branchId, timezone: 'Asia/Kolkata' }],
  };
  return { user, context, branchId };
}
const quiet = { enabled: true, start: '22:00', end: '07:00' };
test('Inbox negotiates approval entries and revalidates permission, limits and request state on read', async () => {
  const f = await deliveryFixture(),
    decision = f.request();
  const { createBusinessAccess } = require('../src/services/business-access');
  const context = await createBusinessAccess(f.local, { now: f.now }).contextFor(f.user);
  const { listInbox, markRead } = require('../src/services/business-notifications');
  await f.local.collection('business_decisions').insertOne(decision);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal((await listInbox(f.local, context, { now: f.now })).entries.length, 0);
  const read = () => listInbox(f.local, context, { now: f.now, includeApprovals: true });
  const result = await read();
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].requestId, String(decision._id));
  assert.equal(result.entries[0].summary, null);
  await markRead(f.local, context, result.entries[0].id);
  assert.equal((await read()).entries[0].read, true);
  await f.local
    .collection('business_decisions')
    .updateOne({ _id: decision._id }, { $set: { state: 'approved' } });
  assert.equal((await read()).entries.length, 0);
  await assert.rejects(markRead(f.local, context, result.entries[0].id), { code: 'access_denied' });
  await f.local
    .collection('business_decisions')
    .updateOne({ _id: decision._id }, { $set: { state: 'pending' } });
  await f.local
    .collection('users')
    .updateOne({ _id: f.user._id }, { $set: { 'access.pos.discount_max_percent': 5 } });
  assert.equal((await read()).entries.length, 0);
  await f.local
    .collection('users')
    .updateOne({ _id: f.user._id }, { $set: { 'access.pos.discount_max_percent': 20 } });
  await f.local
    .collection('business_approval_notification_preferences')
    .updateOne({ accountId: context.accountId }, { $set: { enabled: false } });
  assert.equal((await read()).entries.length, 0);
});
async function deliveryFixture() {
  const f = fixture(),
    local = client.db('alerts_' + f.branchId);
  let at = Date.now();
  const now = () => at;
  f.user.activate = true;
  f.user.branch_access = [{ branch_id: new ObjectId(f.branchId) }];
  await local.collection('users').insertOne(f.user);
  await local.collection('branches').insertOne({
    _id: new ObjectId(f.branchId),
    license: f.user.license,
    branch_name: 'Test',
    currency: 'INR',
    time_zone: 'Asia/Kolkata',
  });
  await saveApprovalPreference(
    local,
    f.context,
    f.branchId,
    { enabled: true, quiet, expectedRevision: 0 },
    { now }
  );
  at++;
  const request = () => ({
    _id: new ObjectId(),
    license: f.user.license,
    branchId: f.branchId,
    requesterId: String(new ObjectId()),
    state: 'pending',
    createdAt: new Date(at),
    expiresAt: new Date(at + 300000),
    summary: { beforeDiscountMinor: 10000, discountMinor: 1000 },
  });
  return {
    ...f,
    local,
    now,
    request,
    advance: (ms) => {
      at += ms;
    },
  };
}
test('bounded scans deduplicate pages and reset to discover late ledger writes', async () => {
  const f = await deliveryFixture();
  const requests = Array.from({ length: 28 }, f.request);
  await f.local.collection('business_decisions').insertMany(requests);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 25);
  f.advance(1001);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 28);
  const late = {
    ...f.request(),
    _id: new ObjectId('000000000000000000000001'),
    createdAt: requests[0].createdAt,
  };
  await f.local.collection('business_decisions').insertOne(late);
  f.advance(15001);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 29);
  const event = await f.local.collection('business_inbox').findOne({ requestId: String(late._id) });
  assert.equal(event.kind, 'approval_requested');
  assert.equal(event.summary, null);
  assert.equal(event.pushPending, true);
});
test('crash after insertion replays safely and revoked recipients cannot receive later events', async () => {
  const f = await deliveryFixture();
  await f.local.collection('business_decisions').insertOne(f.request());
  let crash = true;
  const broken = {
    collection(name) {
      const collection = f.local.collection(name);
      if (name !== 'business_inbox') return collection;
      return {
        createIndex: (...args) => collection.createIndex(...args),
        async updateOne(...args) {
          const result = await collection.updateOne(...args);
          if (crash) {
            crash = false;
            throw new Error('interrupted after insertion');
          }
          return result;
        },
      };
    },
  };
  await drainApprovalAlerts(broken, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 1);
  f.advance(30001);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 1);
  await f.local.collection('business_decisions').insertOne(f.request());
  await f.local.collection('users').updateOne({ _id: f.user._id }, { $set: { activate: false } });
  f.advance(15001);
  await drainApprovalAlerts(f.local, { now: f.now });
  assert.equal(await f.local.collection('business_inbox').countDocuments(), 1);
});
test('approval opt-in is separate from daily summaries, scoped and protected against concurrent edits', async () => {
  const f = fixture();
  assert.equal((await getApprovalPreference(db, f.context, f.branchId)).enabled, false);
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      saveApprovalPreference(
        db,
        f.context,
        f.branchId,
        { enabled: true, quiet, expectedRevision: 0 },
        { now: () => 1000 }
      )
    )
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await db.collection('business_notification_preferences').countDocuments(), 0);
  await saveApprovalPreference(
    db,
    f.context,
    f.branchId,
    { enabled: true, quiet: { ...quiet, enabled: false }, expectedRevision: 1 },
    { now: () => 2000 }
  );
  const key = f.context.accountId + ':' + f.branchId;
  assert.equal(
    (
      await db.collection('business_approval_notification_preferences').findOne({ _id: key })
    ).enabledAt.getTime(),
    1000
  );
  await saveApprovalPreference(
    db,
    f.context,
    f.branchId,
    { enabled: false, quiet, expectedRevision: 2 },
    { now: () => 3000 }
  );
  await saveApprovalPreference(
    db,
    f.context,
    f.branchId,
    { enabled: true, quiet, expectedRevision: 3 },
    { now: () => 4000 }
  );
  assert.equal(
    (
      await db.collection('business_approval_notification_preferences').findOne({ _id: key })
    ).enabledAt.getTime(),
    4000
  );
  await assert.rejects(getApprovalPreference(db, { ...f.context, capabilities: [] }, f.branchId), {
    code: 'access_denied',
  });
  await assert.rejects(getApprovalPreference(db, f.context, String(new ObjectId())), {
    code: 'access_denied',
  });
  await assert.rejects(
    saveApprovalPreference(db, f.context, f.branchId, {
      enabled: true,
      quiet: { ...quiet, end: '22:00' },
      expectedRevision: 4,
    }),
    { code: 'invalid_preference' }
  );
});
test('eligible alerts require a current pending request, matching scope, another requester and sufficient discount limit', () => {
  const f = fixture();
  const decision = {
    state: 'pending',
    expiresAt: new Date(2000),
    license: f.user.license,
    branchId: f.branchId,
    requesterId: String(new ObjectId()),
    summary: { beforeDiscountMinor: 10000, discountMinor: 2000 },
  };
  assert.equal(canReceiveApproval(f.user, f.context, decision, 1000), true);
  for (const change of [
    { state: 'approved' },
    { expiresAt: new Date(1000) },
    { requesterId: f.context.accountId },
    { branchId: String(new ObjectId()) },
    { license: new ObjectId() },
    { summary: { beforeDiscountMinor: 10000, discountMinor: 2001 } },
  ])
    assert.equal(canReceiveApproval(f.user, f.context, { ...decision, ...change }, 1000), false);
  assert.equal(
    canReceiveApproval(f.user, { ...f.context, capabilities: [] }, decision, 1000),
    false
  );
});
