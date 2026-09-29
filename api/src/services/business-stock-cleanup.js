'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);

/** Delete obsolete activations and dormant opted-out state after thirty days.
 * Never expire an active low episode:
 * losing that classification could create another alert without restocking. */
async function drainStockRecipientCleanup(
  db,
  { now = Date.now, signal, limit = 100, budgetMs = 3000 } = {}
) {
  if (signal?.aborted) return { status: 'cancelled' };
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') return { status: 'disabled' };
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 3000
  )
    throw new Error('invalid_stock_cleanup_budget');
  const preferences = db.collection('business_stock_notification_preferences');
  const states = db.collection('business_stock_recipient_state');
  await preferences.createIndex({ nextCleanupAt: 1, cleanupLeaseUntil: 1 });
  await states.createIndex({ license: 1, accountId: 1, branchId: 1, activationId: 1, _id: 1 });
  const job = await preferences.findOneAndUpdate(
    {
      activationId: { $type: 'string' },
      $and: [
        {
          $or: [
            { nextCleanupAt: { $exists: false } },
            { nextCleanupAt: { $lte: new Date(now()) } },
          ],
        },
        {
          $or: [
            { cleanupLeaseUntil: { $exists: false } },
            { cleanupLeaseUntil: { $lte: new Date(now()) } },
          ],
        },
      ],
    },
    { $set: { cleanupLeaseId: crypto.randomUUID(), cleanupLeaseUntil: new Date(now() + 30000) } },
    { sort: { nextCleanupAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
  );
  if (!job) return { status: 'idle' };
  const purgeDisabled =
    job.enabled === false &&
    job.updatedAt instanceof Date &&
    Number.isFinite(job.updatedAt.getTime()) &&
    job.updatedAt.getTime() <= now() - 30 * 86400000 &&
    !Object.hasOwn(job, 'stockDelivery');
  let purgeOrphan = false;
  const lease = () => ({
    _id: job._id,
    revision: job.revision,
    activationId: job.activationId,
    cleanupLeaseId: job.cleanupLeaseId,
    cleanupLeaseUntil: { $gt: new Date(now()) },
    ...(purgeOrphan
      ? { missingAccountSince: job.missingAccountSince, stockDelivery: { $exists: false } }
      : {}),
    ...(purgeDisabled
      ? { enabled: false, updatedAt: job.updatedAt, stockDelivery: { $exists: false } }
      : {}),
  });
  try {
    if (
      job._id !== job.accountId + ':' + job.branchId ||
      ![job.accountId, job.branchId, String(job.license)].every(validId) ||
      !/^[a-f\d-]{36}$/.test(job.activationId) ||
      !Number.isSafeInteger(job.revision) ||
      job.revision < 1
    )
      throw new Error('invalid_stock_cleanup_scope');
    const scope = { license: job.license, accountId: job.accountId, branchId: job.branchId };
    const account = () =>
      db
        .collection('users')
        .findOne(
          { _id: new ObjectId(job.accountId), license: job.license },
          { projection: { _id: 1 }, maxTimeMS: 250 }
        );
    const exists = await account();
    if (exists) {
      await preferences.updateOne(
        lease(),
        { $unset: { missingAccountSince: '' } },
        { maxTimeMS: 500 }
      );
    } else if (!Object.hasOwn(job, 'missingAccountSince')) {
      // Retire opt-in before erasing any state. A restored account must opt in
      // again, creating a new activation and fencing this cleanup's old rows.
      await preferences.updateOne(
        lease(),
        {
          $set: {
            missingAccountSince: new Date(now()),
            enabled: false,
            updatedAt: new Date(now()),
            nextCleanupAt: new Date(now() + 86400000),
          },
          $inc: { revision: 1 },
          $unset: {
            leaseId: '',
            leaseUntil: '',
            deliveryLeaseId: '',
            deliveryLeaseUntil: '',
            materializeLeaseId: '',
            materializeLeaseUntil: '',
          },
        },
        { maxTimeMS: 500 }
      );
      return { status: 'orphaned', deleted: 0 };
    } else if (
      job.enabled === false &&
      job.missingAccountSince instanceof Date &&
      Number.isFinite(job.missingAccountSince.getTime()) &&
      job.missingAccountSince.getTime() <= now() - 30 * 86400000 &&
      !Object.hasOwn(job, 'stockDelivery')
    ) {
      purgeOrphan = true;
    }

    const rows = await states
      .find({
        ...scope,
        ...(!(purgeDisabled || purgeOrphan) ? { activationId: { $ne: job.activationId } } : {}),
      })
      .sort({ _id: 1 })
      .limit(limit + 1)
      .maxTimeMS(250)
      .toArray();
    let deleted = 0,
      visited = 0;
    const started = now();
    for (const row of rows.slice(0, limit)) {
      if (signal?.aborted) return { status: 'cancelled', deleted };
      if (now() - started >= budgetMs) break;
      if (!(await preferences.findOne(lease(), { projection: { _id: 1 }, maxTimeMS: 250 })))
        return { status: 'changed', deleted };
      if (purgeOrphan && (await account())) {
        await preferences.updateOne(
          lease(),
          { $unset: { missingAccountSince: '' } },
          { maxTimeMS: 500 }
        );
        return { status: 'changed', deleted };
      }
      const result = await states.deleteOne(
        {
          ...scope,
          _id: row._id,
          activationId: Object.hasOwn(row, 'activationId') ? row.activationId : { $exists: false },
          revision: Object.hasOwn(row, 'revision') ? row.revision : { $exists: false },
        },
        { maxTimeMS: 500 }
      );
      visited++;
      deleted += result.deletedCount;
    }
    if (signal?.aborted) return { status: 'cancelled', deleted };
    const more = rows.length > limit || visited < rows.length || deleted < visited;
    if (
      purgeOrphan &&
      !more &&
      !(await account()) &&
      !(await states.findOne(scope, { projection: { _id: 1 }, maxTimeMS: 250 }))
    ) {
      const removed = await preferences.deleteOne(lease(), { maxTimeMS: 500 });
      return { status: removed.deletedCount ? 'removed' : 'changed', deleted };
    }

    await preferences.updateOne(
      lease(),
      {
        $set: {
          nextCleanupAt: new Date(now() + (more ? 1 : 86400000)),
          lastCleanupAt: new Date(now()),
          lastCleanupDeleted: deleted,
        },
        $unset: { cleanupLeaseId: '', cleanupLeaseUntil: '', cleanupError: '' },
      },
      { maxTimeMS: 500 }
    );
    return { status: more ? 'partial' : 'complete', deleted };
  } catch (error) {
    await preferences.updateOne(
      lease(),
      {
        $set: { nextCleanupAt: new Date(now() + 60000), cleanupError: 'stock_cleanup_unavailable' },
        $unset: { cleanupLeaseId: '', cleanupLeaseUntil: '' },
      },
      { maxTimeMS: 500 }
    );
    throw error;
  } finally {
    await preferences.updateOne(
      { _id: job._id, cleanupLeaseId: job.cleanupLeaseId },
      { $unset: { cleanupLeaseId: '', cleanupLeaseUntil: '' } },
      { maxTimeMS: 500 }
    );
  }
}
module.exports = { drainStockRecipientCleanup };
