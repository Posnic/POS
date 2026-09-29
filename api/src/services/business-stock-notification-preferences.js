'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { validateSchedule } = require('./business-notification-time');
const INTERVALS = Object.freeze([15, 30, 60, 180]);
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
function branchFor(context, branchId) {
  const branch = context?.branches?.find((row) => row.id === branchId);
  if (
    !branch ||
    !id(branchId) ||
    !id(context.accountId) ||
    !id(context.businessId) ||
    !context.capabilities?.includes('stock.read') ||
    !context.capabilities.includes('notifications.self.manage')
  )
    fail('access_denied', 403);
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') fail('stock_alerts_disabled', 404);
  return branch;
}
function validSettings(value, branch) {
  if (
    typeof value.enabled !== 'boolean' ||
    !INTERVALS.includes(value.minimumIntervalMinutes) ||
    !exact(value.quiet, ['enabled', 'start', 'end'])
  )
    return false;
  try {
    validateSchedule({ time: '23:00', timezone: branch.timezone, quiet: value.quiet });
    return true;
  } catch {
    return false;
  }
}
function validateStored(row, context, branch) {
  if (!row) return;
  if (
    row.accountId !== context.accountId ||
    row.branchId !== branch.id ||
    String(row.license) !== context.businessId ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    row.revision >= Number.MAX_SAFE_INTEGER ||
    !validSettings(row, branch) ||
    (row.enabled &&
      (!(row.enabledAt instanceof Date) ||
        !Number.isFinite(row.enabledAt.getTime()) ||
        typeof row.activationId !== 'string' ||
        !/^[a-f\d-]{36}$/.test(row.activationId)))
  )
    fail('preference_unavailable', 503);
}
function publicPreference(branch, row) {
  return {
    branchId: branch.id,
    timezone: branch.timezone,
    revision: row?.revision ?? 0,
    enabled: row?.enabled ?? false,
    minimumIntervalMinutes: row?.minimumIntervalMinutes ?? 60,
    quiet: row?.quiet ?? { enabled: false, start: '22:00', end: '07:00' },
  };
}
async function readStockPreferenceState(db, context, branchId) {
  const branch = branchFor(context, branchId);
  const row = await db.collection('business_stock_notification_preferences').findOne(
    {
      _id: context.accountId + ':' + branchId,
      license: new ObjectId(context.businessId),
    },
    { maxTimeMS: 500 }
  );
  validateStored(row, context, branch);
  return { branch, row };
}
async function getStockPreference(db, context, branchId) {
  const { branch, row } = await readStockPreferenceState(db, context, branchId);
  return publicPreference(branch, row);
}
async function saveStockPreference(db, context, branchId, input, { now = Date.now } = {}) {
  const branch = branchFor(context, branchId);
  if (
    !exact(input, ['enabled', 'expectedRevision', 'minimumIntervalMinutes', 'quiet']) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= Number.MAX_SAFE_INTEGER - 1 ||
    !validSettings(input, branch)
  )
    fail('invalid_preference');
  const preferences = db.collection('business_stock_notification_preferences');
  const key = context.accountId + ':' + branchId,
    license = new ObjectId(context.businessId);
  const prior = await preferences.findOne({ _id: key, license }, { maxTimeMS: 500 });
  validateStored(prior, context, branch);
  if ((prior?.revision ?? 0) !== input.expectedRevision) fail('preference_changed', 409);
  const at = new Date(now());
  if (!Number.isFinite(at.getTime())) fail('invalid_preference');
  const enabling = input.enabled && prior?.enabled !== true;
  let row;
  try {
    row = await preferences.findOneAndUpdate(
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
          minimumIntervalMinutes: input.minimumIntervalMinutes,
          revision: input.expectedRevision + 1,
          updatedAt: at,
          ...(enabling ? { enabledAt: at, activationId: crypto.randomUUID(), nextScanAt: at } : {}),
        },
        $unset: {
          leaseId: '',
          leaseUntil: '',
          deliveryLeaseId: '',
          deliveryLeaseUntil: '',
          materializeLeaseId: '',
          materializeLeaseUntil: '',
          nextMaterializeAt: '',
          cleanupLeaseId: '',
          cleanupLeaseUntil: '',
          nextCleanupAt: '',
          ...(enabling ? { cursor: '', lastNotifiedAt: '' } : {}),
          ...(!input.enabled ? { nextScanAt: '' } : {}),
        },
      },
      { upsert: input.expectedRevision === 0, returnDocument: 'after', maxTimeMS: 500 }
    );
  } catch (error) {
    if (error.code === 11000) fail('preference_changed', 409);
    throw error;
  }
  if (!row) fail('preference_changed', 409);
  return publicPreference(branch, row);
}
module.exports = { getStockPreference, saveStockPreference, readStockPreferenceState, INTERVALS };
