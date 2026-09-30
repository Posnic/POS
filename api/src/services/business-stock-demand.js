'use strict';
const { ObjectId } = require('mongodb');
const { recipientState } = require('./business-stock-recipient');
/** One shared branch request per minute, after current recipient authorization.
 * This queues desktop preparation only; servers never scan the inventory here. */
async function requestRecipientStock(db, target, { now = Date.now, signal, preference } = {}) {
  if (signal?.aborted) return { status: 'cancelled' };
  const state = await recipientState(db, target, now, { observeOnly: true });
  if (state.status !== 'eligible') return state;
  if (
    preference &&
    (state.preference.revision !== preference.revision ||
      state.preference.activationId !== preference.activationId)
  )
    return { status: 'changed' };
  if (signal?.aborted) return { status: 'cancelled' };
  const requests = db.collection('business_reporting_requests');
  await requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  if (signal?.aborted) return { status: 'cancelled' };
  const live = await recipientState(db, target, now, { observeOnly: true });
  if (live.status !== 'eligible') return live;
  if (
    live.preference.revision !== state.preference.revision ||
    live.preference.activationId !== state.preference.activationId
  )
    return { status: 'changed' };
  if (signal?.aborted) return { status: 'cancelled' };
  const at = now();
  try {
    const result = await requests.updateOne(
      {
        _id: target.branchId + ':stock',
        license: new ObjectId(target.businessId),
        $or: [{ requestedAt: { $lte: new Date(at - 60000) } }, { requestedAt: { $exists: false } }],
      },
      {
        $set: {
          summaryKind: 'stock',
          stockSummaryVersion: 1,
          branchId: target.branchId,
          license: new ObjectId(target.businessId),
          requestedAt: new Date(at),
          expiresAt: new Date(at + 30 * 60000),
        },
      },
      { upsert: true, maxTimeMS: 500 }
    );
    return { status: result.matchedCount || result.upsertedCount ? 'requested' : 'coalesced' };
  } catch (error) {
    // Another recipient or interactive read already requested this branch.
    if (error.code === 11000) return { status: 'coalesced' };
    throw error;
  }
}
module.exports = { requestRecipientStock };
