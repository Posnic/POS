'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const {
  getApprovalPreference,
  saveApprovalPreference,
  canReceiveApproval,
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
