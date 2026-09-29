'use strict';
const { ObjectId } = require('mongodb');
const { recipientState } = require('./business-stock-recipient');
const { visibleStockEvents } = require('./business-stock-inbox');
const { readStockSnapshotPage } = require('./business-stock-snapshot-read');
const { validateState } = require('./business-stock-recipient-journal');
const { deferQuiet } = require('./business-notification-time');
const indexes = new WeakMap();
async function ready(db) {
  if (!indexes.has(db))
    indexes.set(
      db,
      db
        .collection('business_stock_recipient_state')
        .createIndex({
          license: 1,
          accountId: 1,
          branchId: 1,
          activationId: 1,
          itemId: 1,
        })
        .catch((error) => {
          indexes.delete(db);
          throw error;
        })
    );
  await indexes.get(db);
}
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const sameScope = (a, b) =>
  a.status === 'eligible' &&
  a.preference.activationId === b.preference.activationId &&
  a.preference.revision === b.preference.revision &&
  a.branch.timezone === b.branch.timezone;

/** One bounded page of current stock, checked against private group membership.
 * This is evidence for a delivery worker, never a durable authorization token.
 * A worker must re-run validation immediately before handing off to a provider. */
async function stockPushScope(db, target, eventId, { cursor, now = Date.now } = {}) {
  if (![target?.accountId, target?.businessId, target?.branchId, eventId].every(id))
    return { status: 'denied' };
  const state = await recipientState(db, target, now, { observeOnly: true });
  if (state.status !== 'eligible') return state;
  const scope = {
    accountId: target.accountId,
    license: new ObjectId(target.businessId),
    branchId: target.branchId,
  };
  const event = await db
    .collection('business_inbox')
    .findOne({ _id: new ObjectId(eventId), ...scope }, { maxTimeMS: 250 });
  if (!event || !(await visibleStockEvents(db, state.context, [event], now)).has(eventId))
    return { status: 'denied' };
  if (event.readAt || now() - event.createdAt.getTime() >= 3600000) return { status: 'suppressed' };
  const prefix = target.accountId + ':' + target.branchId + ':stock:';
  const groupId =
    typeof event.eventKey === 'string' && event.eventKey.startsWith(prefix)
      ? event.eventKey.slice(prefix.length)
      : '';
  if (!/^[a-f\d-]{36}$/.test(groupId)) return { status: 'denied' };
  // Cadence was committed with this Inbox event. Applying lastNotifiedAt here
  // would postpone the event behind its own interval; quiet hours still apply.
  const retryAt = deferQuiet(new Date(now()), {
    time: '23:00',
    quiet: state.preference.quiet,
    timezone: state.branch.timezone,
  });
  if (retryAt.getTime() > now()) return { status: 'deferred', retryAt };
  if (
    cursor &&
    (Object.keys(cursor).sort().join(',') !==
      'activationId,eventId,pageIndex,revision,snapshotId' ||
      cursor.eventId !== eventId ||
      cursor.activationId !== state.preference.activationId ||
      cursor.revision !== state.preference.revision ||
      !Number.isInteger(cursor.pageIndex) ||
      cursor.pageIndex < 0 ||
      cursor.pageIndex >= 100 ||
      typeof cursor.snapshotId !== 'string' ||
      !/^[a-f\d]{64}$/.test(cursor.snapshotId))
  )
    return { status: 'changed' };
  await ready(db);
  const frame = await readStockSnapshotPage(
    db,
    { id: target.branchId, license: target.businessId },
    { now, ...(cursor ? { pageIndex: cursor.pageIndex, snapshotId: cursor.snapshotId } : {}) }
  );
  if (frame.status !== 'ready') return frame;
  if (
    Date.parse(frame.summary.observedFrom) < event.createdAt.getTime() &&
    frame.snapshotId !== event.stock.snapshotId
  )
    return { status: 'unavailable' };
  const membership = {
    ...scope,
    activationId: event.activationId,
    $or: [
      { 'pending.groupId': groupId },
      { lastDeliveredGroup: groupId, pending: { $exists: false } },
    ],
  };
  const candidates = await db
    .collection('business_stock_recipient_state')
    .find({
      ...membership,
      itemId: { $in: frame.facts.filter((fact) => fact.low).map((fact) => fact.itemId) },
    })
    .limit(101)
    .maxTimeMS(250)
    .toArray();
  if (candidates.length > 100) return { status: 'unavailable' };
  let candidate;
  for (const row of candidates) {
    try {
      validateState(
        row,
        target.businessId + ':' + target.accountId + ':' + target.branchId + ':' + row.itemId,
        target,
        row.itemId
      );
    } catch {
      return { status: 'unavailable' };
    }
    if (row.fact.low && row.preparedAt <= frame.summary.preparedAt) {
      candidate = row;
      break;
    }
  }
  // Read again after membership lookup so a replacement/partial publisher or
  // settings edit during validation cannot authorize a stale provider handoff.
  const finalFrame = await readStockSnapshotPage(
    db,
    { id: target.branchId, license: target.businessId },
    {
      now,
      pageIndex: frame.pageIndex,
      snapshotId: frame.snapshotId,
    }
  );
  if (finalFrame.status !== 'ready') return { status: 'unavailable' };
  const final = await recipientState(db, target, now, { observeOnly: true });
  if (!sameScope(final, state)) return { status: 'changed' };
  const finalQuiet = deferQuiet(new Date(now()), {
    time: '23:00',
    quiet: final.preference.quiet,
    timezone: final.branch.timezone,
  });
  if (finalQuiet.getTime() > now()) return { status: 'deferred', retryAt: finalQuiet };
  const retained = await db.collection('business_inbox').findOne(
    {
      _id: event._id,
      ...scope,
      stockDigest: event.stockDigest,
      activationId: event.activationId,
      materializationPending: false,
      readAt: { $exists: false },
      expiresAt: { $gt: new Date(now()) },
    },
    { maxTimeMS: 250 }
  );
  if (!retained || now() - event.createdAt.getTime() >= 3600000) return { status: 'suppressed' };
  if (candidate) {
    if (
      !(await db.collection('business_stock_recipient_state').findOne(
        {
          ...membership,
          _id: candidate._id,
          revision: candidate.revision,
        },
        { projection: { _id: 1 }, maxTimeMS: 250 }
      ))
    )
      return { status: 'changed' };
    return {
      status: 'eligible',
      snapshotId: frame.snapshotId,
      itemId: candidate.itemId,
      preferenceRevision: final.preference.revision,
      activationId: final.preference.activationId,
      context: final.context,
      branch: final.branch,
      preference: { ...final.preference, time: '23:00' },
    };
  }
  if (frame.nextPageIndex === null) return { status: 'suppressed' };
  return {
    status: 'pending',
    cursor: {
      eventId,
      snapshotId: frame.snapshotId,
      activationId: state.preference.activationId,
      revision: state.preference.revision,
      pageIndex: frame.nextPageIndex,
    },
  };
}
module.exports = { stockPushScope };
