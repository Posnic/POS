'use strict';
const { ObjectId } = require('mongodb');
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
        $unset: { leaseId: '', leaseUntil: '', ...(enabling ? { lastDecisionId: '' } : {}) },
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
module.exports = { getApprovalPreference, saveApprovalPreference, canReceiveApproval };
