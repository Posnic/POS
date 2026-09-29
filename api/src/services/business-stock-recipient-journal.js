'use strict';
const { ObjectId } = require('mongodb');
const { readRecipientStockPage } = require('./business-stock-recipient');
const { digestOf, FRESHNESS_MS } = require('./business-stock-snapshot-contract');
const { validateStockFact } = require('./business-stock-contract');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const candidateId = (key, activationId, episode) => digestOf([key, activationId, episode]);
function validateState(row, key, target, itemId) {
  if (
    row._id !== key ||
    row.schemaVersion !== 1 ||
    row.sourceComplete !== false ||
    typeof row.snapshotId !== 'string' ||
    !/^[a-f\d]{64}$/.test(row.snapshotId) ||
    String(row.license) !== target.businessId ||
    row.accountId !== target.accountId ||
    row.branchId !== target.branchId ||
    row.itemId !== itemId ||
    typeof row.activationId !== 'string' ||
    !/^[a-f\d-]{36}$/.test(row.activationId) ||
    !Number.isSafeInteger(row.preferenceRevision) ||
    row.preferenceRevision < 1 ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    row.revision >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(row.episode) ||
    row.episode < 0 ||
    row.episode >= Number.MAX_SAFE_INTEGER ||
    typeof row.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.preparedAt)) ||
    new Date(row.preparedAt).toISOString() !== row.preparedAt
  )
    fail('invalid_stock_recipient_state');
  validateStockFact(row.fact);
  if (row.fact.itemId !== itemId || (row.fact.low && row.episode === 0))
    fail('invalid_stock_recipient_state');
  if (
    row.pending &&
    (Object.keys(row.pending).sort().join(',') !== 'episode,id,observedAt' ||
      row.pending.id !== candidateId(key, row.activationId, row.episode) ||
      row.pending.episode !== row.episode ||
      row.fact.low !== true ||
      row.episode < 1 ||
      typeof row.pending.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.pending.observedAt)) ||
      new Date(row.pending.observedAt).toISOString() !== row.pending.observedAt ||
      row.pending.observedAt > row.preparedAt)
  )
    fail('invalid_stock_recipient_state');
}
/** Observe during quiet hours/cadence so an explicit healthy fact can re-arm a
 * later low episode. Pending identities are private candidates, never Inbox or
 * push authority. Delivery must use the normal (non-observation) recipient gate. */
async function journalRecipientStockPage(
  db,
  target,
  { cursor, afterItemId = null, limit = 100, budgetMs = 3000, signal, now = Date.now } = {}
) {
  const started = now();
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 3000
  )
    fail('invalid_stock_recipient_cursor');
  if (signal?.aborted) return { status: 'cancelled' };
  const frame = await readRecipientStockPage(db, target, { cursor, now, observeOnly: true });
  if (frame.status !== 'ready') return frame;
  if (afterItemId !== null && !frame.facts.some((fact) => fact.itemId === afterItemId))
    fail('invalid_stock_recipient_cursor');
  const rows = db.collection('business_stock_recipient_state');
  await rows.createIndex({
    license: 1,
    accountId: 1,
    branchId: 1,
    activationId: 1,
    'pending.id': 1,
    itemId: 1,
  });
  const remaining = frame.facts.filter((fact) => afterItemId === null || fact.itemId > afterItemId);
  let processed = 0,
    queued = 0,
    last = afterItemId;
  const frameCursor = {
    activationId: frame.activationId,
    revision: frame.preferenceRevision,
    snapshotId: frame.snapshotId,
    pageIndex: frame.pageIndex,
  };
  const progress = () => ({
    status: 'processed',
    snapshotId: frame.snapshotId,
    preparedAt: frame.summary.preparedAt,
    processed,
    queued,
    next:
      processed === remaining.length
        ? frame.nextCursor
          ? { cursor: frame.nextCursor }
          : null
        : { cursor: frameCursor, afterItemId: last },
  });
  for (const fact of remaining) {
    if (signal?.aborted) return { status: 'cancelled' };
    if (processed >= limit || now() - started >= budgetMs) return progress();
    if (now() - Date.parse(frame.summary.preparedAt) >= FRESHNESS_MS)
      return { status: 'unavailable' };
    const key = [target.businessId, target.accountId, target.branchId, fact.itemId].join(':');
    let saved = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) return { status: 'cancelled' };
      if (now() - started >= budgetMs) return progress();
      // The preference edit/activation check prevents ordinary stale work. A
      // racing edit can leave only an old tagged candidate, which cannot pass
      // the materializer's mandatory live activation/revision checks.
      const enabled = await db.collection('business_stock_notification_preferences').findOne(
        {
          _id: target.accountId + ':' + target.branchId,
          license: new ObjectId(target.businessId),
          enabled: true,
          activationId: frame.activationId,
          revision: frame.preferenceRevision,
        },
        { projection: { _id: 1 }, maxTimeMS: 250 }
      );
      if (!enabled) return { status: 'changed' };
      const prior = await rows.findOne({ _id: key }, { maxTimeMS: 250 });
      if (prior) validateState(prior, key, target, fact.itemId);
      if (
        prior &&
        (prior.preferenceRevision > frame.preferenceRevision ||
          (prior.activationId !== frame.activationId &&
            prior.preferenceRevision >= frame.preferenceRevision))
      )
        return { status: 'changed' };
      const sameActivation = prior?.activationId === frame.activationId;
      if (sameActivation && prior.preparedAt > frame.summary.preparedAt) {
        saved = true;
        break;
      }
      if (sameActivation && prior.preparedAt === frame.summary.preparedAt) {
        if (digestOf(prior.fact) !== digestOf(fact))
          fail('conflicting_stock_recipient_observation');
        saved = true;
        break;
      }
      if (sameActivation && prior.preparedAt > frame.summary.observedFrom)
        fail('overlapping_stock_recipient_observation');
      const newLow = fact.low && (!sameActivation || prior.fact.low !== true);
      const episode = (sameActivation ? prior.episode : 0) + (newLow ? 1 : 0);
      const pending = newLow
        ? {
            id: candidateId(key, frame.activationId, episode),
            episode,
            observedAt: frame.summary.preparedAt,
          }
        : sameActivation && fact.low
          ? prior.pending
          : undefined;
      const update = {
        $set: {
          schemaVersion: 1,
          license: new ObjectId(target.businessId),
          accountId: target.accountId,
          branchId: target.branchId,
          itemId: fact.itemId,
          activationId: frame.activationId,
          preferenceRevision: frame.preferenceRevision,
          revision: (prior?.revision ?? 0) + 1,
          episode,
          fact,
          preparedAt: frame.summary.preparedAt,
          snapshotId: frame.snapshotId,
          sourceComplete: false,
          ...(pending ? { pending } : {}),
          ...(prior?.pending && (!pending || !sameActivation)
            ? {
                lastSuppressed: {
                  id: prior.pending.id,
                  reason: sameActivation ? 'verified_healthy' : 'activation_changed',
                  at: new Date(now()),
                },
              }
            : {}),
        },
        ...(!pending ? { $unset: { pending: '' } } : {}),
      };
      try {
        const result = await rows.updateOne(
          { _id: key, revision: prior ? prior.revision : { $exists: false } },
          update,
          { upsert: !prior, maxTimeMS: 500 }
        );
        if (result.matchedCount || result.upsertedCount) {
          queued += newLow ? 1 : 0;
          saved = true;
          break;
        }
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    if (!saved) fail('stock_recipient_busy');
    processed++;
    last = fact.itemId;
  }
  return progress();
}
module.exports = { journalRecipientStockPage, candidateId };
