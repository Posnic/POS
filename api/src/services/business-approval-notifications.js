'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('node:crypto');
const { createBusinessAccess } = require('./business-access');
const { LIFETIME_MS } = require('./business-decision-ledger');
const { businessDate } = require('./business-metrics');
const { validateSchedule } = require('./business-notification-time');
const { remoteDiscountPolicy, withinDiscountLimit } = require('./business-decision-policy');
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
function branchFor(context, branchId) {
  const branch = context.branches.find((row) => row.id === branchId);
  if (
    !branch ||
    !validId(branchId) ||
    !validId(context.accountId) ||
    !validId(context.businessId) ||
    !context.capabilities.includes('approvals.read') ||
    !context.capabilities.includes('notifications.self.manage')
  )
    fail('access_denied', 403);
  return branch;
}
function publicPreference(branch, row) {
  return {
    branchId: branch.id,
    timezone: branch.timezone,
    revision: row?.revision ?? 0,
    enabled: row?.enabled ?? false,
    quiet: row?.quiet ?? { enabled: false, start: '22:00', end: '07:00' },
  };
}
async function getApprovalPreference(db, context, branchId) {
  const branch = branchFor(context, branchId);
  const row = await db.collection('business_approval_notification_preferences').findOne({
    _id: context.accountId + ':' + branchId,
    license: new ObjectId(context.businessId),
  });
  return publicPreference(branch, row);
}
async function saveApprovalPreference(db, context, branchId, input, { now = Date.now } = {}) {
  const branch = branchFor(context, branchId);
  if (
    !input ||
    Object.keys(input).sort().join(',') !== 'enabled,expectedRevision,quiet' ||
    typeof input.enabled !== 'boolean' ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    !input.quiet ||
    Object.keys(input.quiet).sort().join(',') !== 'enabled,end,start'
  )
    fail('invalid_preference');
  try {
    validateSchedule({ time: '23:00', timezone: branch.timezone, quiet: input.quiet });
  } catch {
    fail('invalid_preference');
  }
  const collection = db.collection('business_approval_notification_preferences');
  const key = context.accountId + ':' + branchId,
    license = new ObjectId(context.businessId);
  const prior = await collection.findOne({ _id: key, license });
  if ((prior?.revision ?? 0) !== input.expectedRevision) fail('preference_changed', 409);
  const at = new Date(now()),
    enabling = input.enabled && prior?.enabled !== true;
  let row;
  try {
    row = await collection.findOneAndUpdate(
      {
        _id: key,
        ...(input.expectedRevision
          ? { license, revision: input.expectedRevision }
          : { revision: { $exists: false } }),
      },
      {
        $set: {
          license,
          accountId: context.accountId,
          branchId,
          timezone: branch.timezone,
          enabled: input.enabled,
          quiet: input.quiet,
          revision: input.expectedRevision + 1,
          updatedAt: at,
          ...(enabling ? { enabledAt: at, nextScanAt: at } : {}),
        },
        $unset: { leaseId: '', leaseUntil: '', ...(enabling ? { cursor: '' } : {}) },
      },
      { upsert: input.expectedRevision === 0, returnDocument: 'after' }
    );
  } catch (error) {
    if (error.code === 11000) fail('preference_changed', 409);
    throw error;
  }
  if (!row) fail('preference_changed', 409);
  return publicPreference(branch, row);
}
/** Re-evaluate with a fresh user/context at materialization AND delivery. An
 * alert is never approval authority and cannot be sent to its own requester. */
function canReceiveApproval(user, context, decision, now = Date.now()) {
  const policy = remoteDiscountPolicy(user);
  return (
    !!decision &&
    decision.state === 'pending' &&
    decision.expiresAt instanceof Date &&
    decision.expiresAt.getTime() > now &&
    String(decision.license) === context.businessId &&
    String(user?._id) === context.accountId &&
    String(user?.license) === context.businessId &&
    decision.requesterId !== context.accountId &&
    context.capabilities.includes('approvals.read') &&
    context.branches.some((branch) => branch.id === decision.branchId) &&
    !!decision.summary &&
    withinDiscountLimit(policy, decision.summary)
  );
}
const indexes = new WeakMap();
async function ready(db) {
  if (!indexes.has(db))
    indexes.set(
      db,
      Promise.all([
        db
          .collection('business_approval_notification_preferences')
          .createIndex({ enabled: 1, nextScanAt: 1 }),
        db
          .collection('business_decisions')
          .createIndex({ license: 1, branchId: 1, state: 1, createdAt: 1, _id: 1 }),
        db.collection('business_inbox').createIndex({ eventKey: 1 }, { unique: true }),
        db.collection('business_inbox').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]).catch((error) => {
        indexes.delete(db);
        throw error;
      })
    );
  await indexes.get(db);
}
/** Bounded polling of the authoritative ledger, not a till write-path hook.
 * Events are inserted before advancing the cursor; retries cannot duplicate
 * an account/request pair. Full pages continue, then reset to catch late writes. */
async function drainApprovalAlerts(db, { now = Date.now, limit = 5 } = {}) {
  if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') return 0;
  await ready(db);
  const preferences = db.collection('business_approval_notification_preferences');
  const started = now(),
    access = createBusinessAccess(db, { now });
  let processed = 0;
  for (let i = 0; i < Math.min(5, Math.max(1, limit)); i++) {
    if (now() - started > 3000) break;
    const at = new Date(now()),
      leaseId = crypto.randomUUID();
    const job = await preferences.findOneAndUpdate(
      {
        enabled: true,
        nextScanAt: { $lte: at },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: at } }],
      },
      { $set: { leaseId, leaseUntil: new Date(now() + 30000) } },
      { sort: { nextScanAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
    );
    if (!job) break;
    const lease = { _id: job._id, revision: job.revision, leaseId, enabled: true };
    try {
      const user = await db
        .collection('users')
        .findOne({ _id: new ObjectId(job.accountId), license: job.license });
      const context = await access.contextFor(user),
        branch = branchFor(context, job.branchId);
      if (!(job.enabledAt instanceof Date) || !Number.isFinite(job.enabledAt.getTime()))
        fail('invalid_preference');
      const lower = new Date(Math.max(job.enabledAt.getTime(), now() - LIFETIME_MS));
      const cursor = job.cursor;
      const rows = await db
        .collection('business_decisions')
        .find({
          license: job.license,
          branchId: job.branchId,
          state: 'pending',
          expiresAt: { $gt: at },
          createdAt: { $gte: lower, $lte: at },
          ...(cursor
            ? {
                $or: [
                  { createdAt: { $gt: cursor.at } },
                  { createdAt: cursor.at, _id: { $gt: cursor.id } },
                ],
              }
            : {}),
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(25)
        .maxTimeMS(500)
        .toArray();
      for (const decision of rows) {
        if (!canReceiveApproval(user, context, decision, now())) continue;
        if (!(await preferences.findOne(lease))) break;
        await db.collection('business_inbox').updateOne(
          { eventKey: job._id + ':approval:' + String(decision._id) },
          {
            $setOnInsert: {
              accountId: context.accountId,
              license: job.license,
              branchId: job.branchId,
              kind: 'approval_requested',
              requestId: String(decision._id),
              businessDate: businessDate(decision.createdAt, branch.timezone),
              summary: null,
              createdAt: new Date(now()),
              expiresAt: decision.expiresAt,
              channel: 'inApp',
              pushPending: true,
            },
          },
          { upsert: true }
        );
      }
      const last = rows[rows.length - 1];
      await preferences.updateOne(lease, {
        $set: {
          nextScanAt: new Date(now() + (rows.length === 25 ? 1000 : 15000)),
          ...(rows.length === 25 ? { cursor: { at: last.createdAt, id: last._id } } : {}),
        },
        $unset: { leaseId: '', leaseUntil: '', ...(rows.length < 25 ? { cursor: '' } : {}) },
      });
      processed++;
    } catch (error) {
      await preferences.updateOne(lease, {
        $set: {
          nextScanAt: new Date(now() + 30000),
          ...([401, 403].includes(error.status) ? { enabled: false } : {}),
        },
        $unset: { leaseId: '', leaseUntil: '' },
      });
    }
  }
  return processed;
}
async function approvalAlertScope(db, accountId, license, branchId, requestId, now = Date.now) {
  if (!validId(accountId) || !validId(branchId) || !validId(requestId)) fail('access_denied', 403);
  const user = await db.collection('users').findOne({ _id: new ObjectId(accountId), license });
  const context = await createBusinessAccess(db, { now }).contextFor(user);
  const branch = branchFor(context, branchId);
  const decision = await db
    .collection('business_decisions')
    .findOne({ _id: new ObjectId(requestId), license, branchId });
  if (!canReceiveApproval(user, context, decision, now())) fail('access_denied', 403);
  const preference = await db.collection('business_approval_notification_preferences').findOne({
    _id: accountId + ':' + branchId,
    license,
    enabled: true,
  });
  if (
    !preference ||
    !(preference.enabledAt instanceof Date) ||
    !(decision.createdAt instanceof Date) ||
    preference.enabledAt > decision.createdAt
  )
    fail('access_denied', 403);
  return { context, branch, preference: { ...preference, time: '23:00' }, decision };
}
async function visibleApprovalEvents(db, context, rows, now = Date.now) {
  const events = rows.filter((row) => row.kind === 'approval_requested' && validId(row.requestId));
  if (!events.length || !context.capabilities.includes('approvals.read')) return new Set();
  const license = new ObjectId(context.businessId);
  const user = await db
    .collection('users')
    .findOne({ _id: new ObjectId(context.accountId), license });
  let current;
  try {
    current = await createBusinessAccess(db, { now }).contextFor(user);
  } catch (error) {
    if ([401, 403].includes(error.status)) return new Set();
    throw error;
  }
  const decisions = await db
    .collection('business_decisions')
    .find({
      _id: { $in: events.map((event) => new ObjectId(event.requestId)) },
      license,
    })
    .limit(50)
    .maxTimeMS(250)
    .toArray();
  const preferences = await db
    .collection('business_approval_notification_preferences')
    .find({
      _id: { $in: events.map((event) => context.accountId + ':' + event.branchId) },
      license,
      enabled: true,
    })
    .limit(50)
    .maxTimeMS(250)
    .toArray();
  return new Set(
    events
      .filter((event) => {
        const decision = decisions.find(
          (row) => String(row._id) === event.requestId && row.branchId === event.branchId
        );
        const preference = preferences.find((row) => row.branchId === event.branchId);
        return (
          preference?.enabledAt instanceof Date &&
          decision?.createdAt instanceof Date &&
          preference.enabledAt <= decision.createdAt &&
          canReceiveApproval(user, current, decision, now())
        );
      })
      .map((event) => String(event._id))
  );
}
module.exports = {
  getApprovalPreference,
  saveApprovalPreference,
  canReceiveApproval,
  drainApprovalAlerts,
  approvalAlertScope,
  visibleApprovalEvents,
};
