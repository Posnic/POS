'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { REGISTER_STATUS } = require('../constants/registers.constants');
const { businessDate } = require('./business-metrics');

const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const validDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const CLOSE_GRACE_MS = 10 * 60_000;

/** A register close is an explicit source fact, not proof of branch closure,
 * report completeness or session revenue. No financial arrays are read here. */
function registerCloseFact(row, branch, { now = Date.now } = {}) {
  if (!validId(branch?.id) || !validId(branch?.license)) fail('invalid_scope');
  if (!row) return null;
  if (String(row.branch_id) !== branch.id || String(row.license) !== branch.license)
    fail('access_denied', 403);
  if (row.register_status === REGISTER_STATUS.OPENED) return null;
  if (
    row.register_status !== REGISTER_STATUS.CLOSED ||
    !validId(String(row._id)) ||
    !validId(String(row.register_id)) ||
    typeof row.register_name !== 'string' ||
    !row.register_name.trim() ||
    row.register_name.trim().length > 200 ||
    !validDate(row.register_opendate) ||
    !validDate(row.register_closedate) ||
    row.register_opendate > row.register_closedate ||
    row.register_closedate.getTime() > now()
  )
    fail('close_unavailable', 503);
  const openedAt = row.register_opendate.toISOString(),
    closedAt = row.register_closedate.toISOString(),
    sessionId = String(row._id),
    registerId = String(row.register_id);
  let day;
  try {
    day = businessDate(row.register_closedate, branch.timezone);
  } catch {
    fail('close_unavailable', 503);
  }
  // The existing close writer accepts Opened -> Closed once. The fingerprint
  // also changes if imported source data revises either bound or register scope.
  const closeRevision = crypto
    .createHash('sha256')
    .update(JSON.stringify([branch.license, branch.id, sessionId, registerId, openedAt, closedAt]))
    .digest('hex');
  return {
    schemaVersion: 1,
    branchId: branch.id,
    sessionId,
    registerId,
    registerName: row.register_name.trim(),
    openedAt,
    closedAt,
    closeRevision,
    businessDate: day,
    timezone: branch.timezone,
    eligibleAt: new Date(row.register_closedate.getTime() + CLOSE_GRACE_MS).toISOString(),
  };
}

/** Worker-side source recheck by primary key. This is not a new HTTP endpoint.
 * A missing/reopened source is no longer eligible for queued close delivery. */
async function readRegisterClose(db, context, branchId, sessionId, options = {}) {
  const branch = context.branches.find((entry) => entry.id === branchId);
  if (
    !branch ||
    !context.capabilities.includes('overview.read') ||
    !context.capabilities.includes('notifications.self.manage') ||
    !validId(context.businessId) ||
    !validId(branchId) ||
    !validId(sessionId)
  )
    fail('access_denied', 403);
  const row = await db.collection('cashregister').findOne(
    {
      _id: new ObjectId(sessionId),
      license: new ObjectId(context.businessId),
      branch_id: new ObjectId(branchId),
    },
    {
      projection: {
        _id: 1,
        license: 1,
        branch_id: 1,
        register_id: 1,
        register_name: 1,
        register_status: 1,
        register_opendate: 1,
        register_closedate: 1,
      },
      maxTimeMS: 250,
    }
  );
  return registerCloseFact(row, { ...branch, license: context.businessId }, options);
}
module.exports = { registerCloseFact, readRegisterClose, CLOSE_GRACE_MS };
