'use strict';
const { ObjectId } = require('mongodb');
const { createBusinessAccess } = require('./business-access');
const { readStockPreferenceState } = require('./business-stock-notification-preferences');
const { deferQuiet } = require('./business-notification-time');
const { readStockSnapshotPage } = require('./business-stock-snapshot-read');
const { FRESHNESS_MS } = require('./business-stock-snapshot-contract');
const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const unavailable = () => ({ status: 'unavailable' });
const invalid = () => {
  throw Object.assign(new Error('preference_unavailable'), {
    code: 'preference_unavailable',
    status: 503,
  });
};
async function recipientState(db, target, now, { observeOnly = false } = {}) {
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') return { status: 'disabled' };
  if (![target?.accountId, target?.businessId, target?.branchId].every(validId))
    return { status: 'denied' };
  const user = await db
    .collection('users')
    .findOne(
      { _id: new ObjectId(target.accountId), license: new ObjectId(target.businessId) },
      { maxTimeMS: 500 }
    );
  let context, state;
  try {
    context = await createBusinessAccess(db, { now }).contextFor(user);
    state = await readStockPreferenceState(db, context, target.branchId);
  } catch (error) {
    if ([401, 403].includes(error.status)) return { status: 'denied' };
    throw error;
  }
  const { branch, row } = state;
  if (!row?.enabled) return { status: 'disabled' };
  const at = now();
  if (!Number.isFinite(at) || row.enabledAt.getTime() > at) invalid();
  let earliest = at;
  if (row.lastNotifiedAt !== undefined) {
    if (
      !(row.lastNotifiedAt instanceof Date) ||
      !Number.isFinite(row.lastNotifiedAt.getTime()) ||
      row.lastNotifiedAt.getTime() > at
    )
      invalid();
    earliest = Math.max(at, row.lastNotifiedAt.getTime() + row.minimumIntervalMinutes * 60000);
  }
  const retryAt = deferQuiet(new Date(earliest), {
    time: '23:00',
    timezone: branch.timezone,
    quiet: row.quiet,
  });
  if (!observeOnly && retryAt.getTime() > at) return { status: 'deferred', retryAt };
  return { status: 'eligible', branch, preference: row, context };
}
/** Read-only candidate selection, not authority to publish an Inbox event. The
 * materializer and push consumer must repeat these live checks at their writes. */
async function readRecipientStockPage(
  db,
  target,
  { cursor, now = Date.now, observeOnly = false } = {}
) {
  const before = await recipientState(db, target, now, { observeOnly });
  if (before.status !== 'eligible') return before;
  const preference = before.preference;
  if (
    cursor &&
    (Object.keys(cursor).sort().join(',') !== 'activationId,pageIndex,revision,snapshotId' ||
      cursor.activationId !== preference.activationId ||
      cursor.revision !== preference.revision)
  )
    return { status: 'changed' };
  const frame = await readStockSnapshotPage(
    db,
    { id: target.branchId, license: target.businessId },
    { ...(cursor ? { pageIndex: cursor.pageIndex, snapshotId: cursor.snapshotId } : {}), now }
  );
  if (frame.status !== 'ready') return frame;
  // First opt-in uses a fresh baseline, never a replay of observations prepared
  // before this activation. Missing facts remain unknown to downstream state.
  if (Date.parse(frame.summary.observedFrom) < preference.enabledAt.getTime()) return unavailable();
  const after = await recipientState(db, target, now, { observeOnly });
  if (after.status !== 'eligible') return after;
  if (
    after.preference.activationId !== preference.activationId ||
    after.preference.revision !== preference.revision ||
    after.branch.timezone !== before.branch.timezone
  )
    return { status: 'changed' };
  if (now() - Date.parse(frame.summary.preparedAt) >= FRESHNESS_MS) return unavailable();
  return {
    ...frame,
    activationId: preference.activationId,
    preferenceRevision: preference.revision,
    nextCursor:
      frame.nextPageIndex === null
        ? null
        : {
            activationId: preference.activationId,
            revision: preference.revision,
            snapshotId: frame.snapshotId,
            pageIndex: frame.nextPageIndex,
          },
  };
}
module.exports = { recipientState, readRecipientStockPage };
