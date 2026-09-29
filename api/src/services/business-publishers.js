'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
function scope(context, branchId) {
  if (
    !context.capabilities.includes('reporting.manage') ||
    !context.branches.some((branch) => branch.id === branchId)
  )
    fail('access_denied', 403);
  if (!/^[a-f\d]{24}$/.test(branchId)) fail('invalid_request');
  return new ObjectId(context.businessId);
}
async function flushAudit(db, row) {
  if (!row?.pendingTransition) return;
  await db
    .collection('business_reporting_audit')
    .updateOne(
      { _id: row._id + ':' + row.epoch },
      { $setOnInsert: row.pendingTransition },
      { upsert: true }
    );
  await db
    .collection('business_reporting_publishers')
    .updateOne(
      { _id: row._id, epoch: row.epoch, 'pendingTransition.id': row.pendingTransition.id },
      { $unset: { pendingTransition: '' } }
    );
}
async function listPublishers(db, context, branchId, { now = Date.now } = {}) {
  const license = scope(context, branchId);
  const row = await db
    .collection('business_reporting_publishers')
    .findOne({ _id: branchId, license });
  await flushAudit(db, row);
  const candidates = await db
    .collection('business_reporting_candidates')
    .find({ branchId, license, expiresAt: { $gt: new Date(now()) } })
    .sort({ lastSeenAt: -1 })
    .limit(100)
    .maxTimeMS(250)
    .toArray();
  return {
    branchId,
    publisher: row
      ? {
          deviceId: row.deviceId,
          epoch: row.epoch,
          lastPublishedAt: row.lastPublishedAt?.toISOString() ?? null,
          name:
            candidates.find((candidate) => candidate.deviceId === row.deviceId)?.name ||
            'Reporting desktop',
          online: candidates.some((candidate) => candidate.deviceId === row.deviceId),
        }
      : null,
    candidates: candidates.map((candidate) => ({
      deviceId: candidate.deviceId,
      name: candidate.name,
      lastSeenAt: candidate.lastSeenAt.toISOString(),
    })),
  };
}
async function changePublisher(db, context, branchId, input, { now = Date.now } = {}) {
  const license = scope(context, branchId);
  if (
    !input ||
    typeof input.deviceId !== 'string' ||
    input.deviceId.length < 1 ||
    input.deviceId.length > 128 ||
    !Number.isSafeInteger(input.expectedEpoch) ||
    input.expectedEpoch < 0 ||
    input.expectedEpoch >= Number.MAX_SAFE_INTEGER
  )
    fail('invalid_request');
  const publishers = db.collection('business_reporting_publishers');
  const prior = await publishers.findOne({ _id: branchId, license });
  await flushAudit(db, prior);
  if ((prior?.epoch || 0) !== input.expectedEpoch) fail('publisher_changed', 409);
  const candidate = await db
    .collection('business_reporting_candidates')
    .findOne({ branchId, license, deviceId: input.deviceId, expiresAt: { $gt: new Date(now()) } });
  if (!candidate) fail('desktop_unavailable', 409);
  if (prior?.deviceId === input.deviceId) return { changed: false, epoch: prior.epoch };
  const epoch = input.expectedEpoch + 1,
    at = new Date(now());
  const pendingTransition = {
    id: crypto.randomUUID(),
    branchId,
    license,
    epoch,
    fromDeviceId: prior?.deviceId ?? null,
    toDeviceId: input.deviceId,
    accountId: context.accountId,
    at,
  };
  let updated;
  try {
    updated = await publishers.findOneAndUpdate(
      {
        _id: branchId,
        ...(prior ? { license, epoch: input.expectedEpoch } : { epoch: { $exists: false } }),
        pending: { $exists: false },
        pendingTransition: { $exists: false },
      },
      {
        $set: {
          license,
          deviceId: input.deviceId,
          assignmentId: crypto.randomBytes(32).toString('base64url'),
          epoch,
          lastSequence: 0,
          pendingTransition,
          changedAt: at,
        },
        $unset: { lastDigest: '', lastPublishedAt: '' },
        $setOnInsert: { createdAt: at },
      },
      { upsert: !prior, returnDocument: 'after' }
    );
  } catch (error) {
    if (error.code === 11000) fail('publisher_changed', 409);
    throw error;
  }
  if (!updated) fail('publisher_changed', 409);
  await flushAudit(db, updated);
  return { changed: true, epoch };
}
module.exports = { listPublishers, changePublisher };
