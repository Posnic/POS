'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { recipientState, readRecipientStockPage } = require('./business-stock-recipient');
const { validateState } = require('./business-stock-recipient-journal');
const { digestOf, FRESHNESS_MS } = require('./business-stock-snapshot-contract');
const INBOX_RETENTION_MS = 30 * 86400000;
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
/** Grouped Inbox materialization under the opt-in stock feature flag.
 * Only a committed transition can enqueue a private provider notification. */
async function materializeStockAlert(db, target, { now = Date.now, signal } = {}) {
  if (signal?.aborted) return { status: 'cancelled' };
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') return { status: 'disabled' };
  if (
    ![target?.accountId, target?.businessId, target?.branchId].every(
      (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value)
    )
  )
    return { status: 'denied' };
  const preferences = db.collection('business_stock_notification_preferences');
  const states = db.collection('business_stock_recipient_state');
  const inbox = db.collection('business_inbox');
  const scope = {
    license: new ObjectId(target.businessId),
    accountId: target.accountId,
    branchId: target.branchId,
  };
  const prefScope = { _id: target.accountId + ':' + target.branchId, license: scope.license };
  await inbox.createIndex({ eventKey: 1 }, { unique: true });
  await inbox.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await states.createIndex({
    license: 1,
    accountId: 1,
    branchId: 1,
    activationId: 1,
    snapshotId: 1,
    'pending.groupId': 1,
  });
  const pref = await preferences.findOneAndUpdate(
    {
      ...prefScope,
      $or: [
        { deliveryLeaseUntil: { $exists: false } },
        { deliveryLeaseUntil: { $lte: new Date(now()) } },
      ],
    },
    { $set: { deliveryLeaseId: crypto.randomUUID(), deliveryLeaseUntil: new Date(now() + 30000) } },
    { returnDocument: 'after', maxTimeMS: 500 }
  );
  if (!pref) return { status: 'busy' };
  const lease = { ...prefScope, revision: pref.revision, deliveryLeaseId: pref.deliveryLeaseId };
  const liveLease = () => ({ ...lease, deliveryLeaseUntil: { $gt: new Date(now()) } });
  let group = pref.stockDelivery;
  const groupRows = () => ({
    ...scope,
    activationId: group.activationId,
    'pending.groupId': group.id,
  });
  const eventKey = () => pref._id + ':stock:' + group.id;
  async function acknowledgeGroup() {
    // Revision increments make concurrent observation writers retry instead of
    // restoring a pending identity that was just acknowledged by this group.
    await states.updateMany(
      groupRows(),
      { $set: { lastDeliveredGroup: group.id }, $unset: { pending: '' }, $inc: { revision: 1 } },
      { maxTimeMS: 1000 }
    );
    await preferences.updateOne(
      { ...liveLease(), 'stockDelivery.id': group.id },
      { $unset: { stockDelivery: '', deliveryError: '' } },
      { maxTimeMS: 500 }
    );
  }
  async function finish() {
    if (now() - group.createdAt.getTime() >= INBOX_RETENTION_MS) {
      await inbox.deleteOne(
        {
          eventKey: eventKey(),
          ...scope,
          activationId: group.activationId,
          createdAt: group.createdAt,
        },
        { maxTimeMS: 500 }
      );
      await acknowledgeGroup();
      return { status: 'expired' };
    }

    const event = await inbox.findOne({ eventKey: eventKey(), ...scope }, { maxTimeMS: 500 });
    if (
      !event ||
      event.kind !== 'stock_low' ||
      event.activationId !== group.activationId ||
      event.stockDigest !== digestOf(event.stock)
    )
      fail('invalid_stock_delivery_record');
    await inbox.updateOne(
      {
        _id: event._id,
        eventKey: eventKey(),
        stockDigest: event.stockDigest,
        materializationPending: true,
      },
      { $set: { materializationPending: false, pushPending: true } },
      { maxTimeMS: 500 }
    );
    await acknowledgeGroup();
    return {
      status: 'materialized',
      eventId: String(event._id),
      newLowItemCount: event.stock.newLowItemCount,
    };
  }
  async function cancel() {
    if (
      !(
        await preferences.updateOne(
          {
            ...liveLease(),
            'stockDelivery.id': group.id,
            'stockDelivery.committedAt': { $exists: false },
          },
          { $set: { 'stockDelivery.cancelling': true } },
          { maxTimeMS: 500 }
        )
      ).matchedCount
    )
      return { status: 'changed' };
    await states.updateMany(
      groupRows(),
      { $unset: { 'pending.groupId': '', 'pending.groupSequence': '' }, $inc: { revision: 1 } },
      { maxTimeMS: 1000 }
    );
    await inbox.deleteOne(
      { eventKey: eventKey(), ...scope, materializationPending: true },
      { maxTimeMS: 500 }
    );
    await preferences.updateOne(
      { ...liveLease(), 'stockDelivery.id': group.id },
      { $unset: { stockDelivery: '' } },
      { maxTimeMS: 500 }
    );
    return { status: 'changed' };
  }
  try {
    if (
      group &&
      (!Number.isSafeInteger(group.sequence) ||
        group.sequence < 1 ||
        group.sequence !== pref.stockDeliverySequence ||
        !(group.createdAt instanceof Date) ||
        !Number.isFinite(group.createdAt.getTime()) ||
        group.createdAt.getTime() > now() ||
        (group.committedAt &&
          (!(group.committedAt instanceof Date) ||
            !Number.isFinite(group.committedAt.getTime()) ||
            group.committedAt.getTime() < group.createdAt.getTime() ||
            group.committedAt.getTime() > now())) ||
        typeof group.id !== 'string' ||
        !/^[a-f\d-]{36}$/.test(group.id) ||
        typeof group.activationId !== 'string' ||
        !/^[a-f\d-]{36}$/.test(group.activationId) ||
        typeof group.snapshotId !== 'string' ||
        !/^[a-f\d]{64}$/.test(group.snapshotId))
    )
      fail('invalid_stock_delivery_state');
    // Recovery only acknowledges an already committed event; it does not create
    // another notification or consume the new activation's cadence.
    if (group?.committedAt) return await finish();
    if (group?.cancelling || (group && now() - group.createdAt.getTime() >= FRESHNESS_MS))
      return await cancel();
    const eligibility = await recipientState(db, target, now);
    if (eligibility.status !== 'eligible') {
      if (group && ['disabled', 'denied'].includes(eligibility.status)) return await cancel();
      return eligibility;
    }
    if (group && group.activationId !== eligibility.preference.activationId) return await cancel();
    const frame = await readRecipientStockPage(db, target, { now });
    if (frame.status !== 'ready') return frame;
    if (pref.lastScannedSnapshotId !== frame.snapshotId) return { status: 'scan_required' };
    if (group && group.snapshotId !== frame.snapshotId) return await cancel();
    if (!group) {
      const sequence = pref.stockDeliverySequence ?? 0;
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER)
        fail('invalid_stock_delivery_state');
      group = {
        sequence: sequence + 1,
        id: crypto.randomUUID(),
        activationId: frame.activationId,
        snapshotId: frame.snapshotId,
        createdAt: new Date(now()),
      };
      if (
        !(
          await preferences.updateOne(
            {
              ...liveLease(),
              enabled: true,
              activationId: frame.activationId,
              stockDelivery: { $exists: false },
              stockDeliverySequence: pref.stockDeliverySequence ?? { $exists: false },
              lastScannedSnapshotId: frame.snapshotId,
            },
            { $set: { stockDelivery: group, stockDeliverySequence: group.sequence } },
            { maxTimeMS: 500 }
          )
        ).matchedCount
      )
        return { status: 'changed' };
    }
    const pending = {
      ...scope,
      schemaVersion: 1,
      sourceComplete: false,
      activationId: group.activationId,
      snapshotId: group.snapshotId,
      'fact.low': true,
      'pending.id': { $exists: true },
    };
    await states.updateMany(
      {
        ...pending,
        $or: [
          { 'pending.groupSequence': { $exists: false } },
          { 'pending.groupSequence': { $lt: group.sequence } },
        ],
      },
      {
        $set: { 'pending.groupId': group.id, 'pending.groupSequence': group.sequence },
        $inc: { revision: 1 },
      },
      { maxTimeMS: 1000 }
    );
    const claimed = await states
      .find(groupRows())
      .sort({ itemId: 1 })
      .limit(10001)
      .maxTimeMS(1000)
      .toArray();
    if (
      claimed.length !== (await states.countDocuments(pending, { limit: 10001, maxTimeMS: 1000 }))
    )
      return { status: 'pending' };
    if (!claimed.length) {
      await cancel();
      return { status: 'empty' };
    }
    if (claimed.length > 10000 || claimed.length > frame.summary.lowItemCount)
      fail('invalid_stock_delivery_count');
    for (const row of claimed) {
      const key = [target.businessId, target.accountId, target.branchId, row.itemId].join(':');
      validateState(row, key, target, row.itemId);
      if (
        row.snapshotId !== group.snapshotId ||
        row.preparedAt !== frame.summary.preparedAt ||
        row.pending.observedAt < eligibility.preference.enabledAt.toISOString()
      )
        return await cancel();
    }
    const stock = {
      schemaVersion: 1,
      snapshotId: group.snapshotId,
      observedFrom: frame.summary.observedFrom,
      preparedAt: frame.summary.preparedAt,
      sourceComplete: false,
      coverage: frame.summary.coverage,
      totalLowItemCount: frame.summary.lowItemCount,
      newLowItemCount: claimed.length,
      items: claimed.slice(0, 20).map((row) => row.fact),
      listTruncated: claimed.length > 20,
    };
    const stockDigest = digestOf(stock);
    const check = await readRecipientStockPage(db, target, { now });
    if (check.status !== 'ready') return check;
    if (
      check.snapshotId !== group.snapshotId ||
      check.activationId !== group.activationId ||
      check.preferenceRevision !== pref.revision
    )
      return await cancel();
    if (!(await preferences.findOne(liveLease(), { projection: { _id: 1 }, maxTimeMS: 250 })))
      return { status: 'changed' };
    if (signal?.aborted) return { status: 'cancelled' };
    await inbox.updateOne(
      { eventKey: eventKey() },
      {
        $setOnInsert: {
          ...scope,
          kind: 'stock_low',
          activationId: group.activationId,
          stock,
          stockDigest,
          summary: null,
          createdAt: group.createdAt,
          expiresAt: new Date(group.createdAt.getTime() + INBOX_RETENTION_MS),
          channel: 'inApp',
          pushPending: false,
          materializationPending: true,
        },
      },
      { upsert: true, maxTimeMS: 500 }
    );
    const saved = await inbox.findOne({ eventKey: eventKey(), ...scope }, { maxTimeMS: 500 });
    if (!saved || saved.stockDigest !== stockDigest || digestOf(saved.stock) !== stockDigest)
      fail('stock_delivery_conflict');
    const finalCheck = await readRecipientStockPage(db, target, { now });
    if (finalCheck.status !== 'ready') return finalCheck;
    if (
      finalCheck.snapshotId !== group.snapshotId ||
      finalCheck.activationId !== group.activationId ||
      finalCheck.preferenceRevision !== pref.revision
    )
      return await cancel();
    if (signal?.aborted) return { status: 'cancelled' };
    const committed = await preferences.updateOne(
      {
        ...liveLease(),
        enabled: true,
        activationId: group.activationId,
        'stockDelivery.id': group.id,
        'stockDelivery.cancelling': { $ne: true },
      },
      { $set: { lastNotifiedAt: new Date(now()), 'stockDelivery.committedAt': new Date(now()) } },
      { maxTimeMS: 500 }
    );
    if (!committed.matchedCount) return { status: 'changed' };
    group.committedAt = new Date(now());
    return await finish();
  } catch (error) {
    await preferences.updateOne(
      liveLease(),
      {
        $set: {
          deliveryError: typeof error.code === 'string' ? error.code : 'stock_delivery_unavailable',
        },
      },
      { maxTimeMS: 500 }
    );
    throw error;
  } finally {
    await preferences.updateOne(
      lease,
      { $unset: { deliveryLeaseId: '', deliveryLeaseUntil: '' } },
      { maxTimeMS: 500 }
    );
  }
}
module.exports = { materializeStockAlert };
