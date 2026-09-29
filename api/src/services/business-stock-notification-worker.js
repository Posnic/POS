'use strict';
const crypto = require('node:crypto');
const { drainStockRecipientCleanup } = require('./business-stock-cleanup');
const { createStockRecipientWorker } = require('./business-stock-recipient-worker');
const { materializeStockAlert } = require('./business-stock-materializer');

/** One recipient scan, cleanup pass and due materialization per tick, with
 * independent durable cursors/leases. This factory starts no timer and sends no push. */
function createStockNotificationWorker(
  db,
  {
    now = Date.now,
    scan,
    materialize = materializeStockAlert,
    cleanup = drainStockRecipientCleanup,
  } = {}
) {
  const scanner = scan ?? createStockRecipientWorker(db, { now });
  const preferences = db.collection('business_stock_notification_preferences');
  let running = false,
    stopped = false,
    controller;
  return {
    stop() {
      stopped = true;
      controller?.abort();
      scanner.stop();
    },
    async tick() {
      if (stopped || running || process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') return;
      running = true;
      controller = new AbortController();
      let job, lease;
      try {
        // A failed source scan must not prevent recovery of an already committed
        // Inbox group belonging to a different recipient.
        let scanResult;
        try {
          scanResult = await scanner.tick();
        } catch {
          scanResult = { state: 'error' };
        }
        if (stopped) return;
        try {
          await cleanup(db, { now, signal: controller.signal });
        } catch {
          // Cleanup has its own durable backoff; it must not starve delivery.
        }
        if (stopped) return;
        await preferences.createIndex({ nextMaterializeAt: 1, materializeLeaseUntil: 1 });
        job = await preferences.findOneAndUpdate(
          {
            $and: [
              { $or: [{ enabled: true }, { 'stockDelivery.committedAt': { $exists: true } }] },
              {
                $or: [
                  { nextMaterializeAt: { $exists: false } },
                  { nextMaterializeAt: { $lte: new Date(now()) } },
                ],
              },
              {
                $or: [
                  { materializeLeaseUntil: { $exists: false } },
                  { materializeLeaseUntil: { $lte: new Date(now()) } },
                ],
              },
            ],
          },
          {
            $set: {
              materializeLeaseId: crypto.randomUUID(),
              materializeLeaseUntil: new Date(now() + 30000),
            },
          },
          { sort: { nextMaterializeAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
        );
        if (!job) return { scan: scanResult, delivery: 'idle' };
        lease = () => ({
          _id: job._id,
          revision: job.revision,
          activationId: job.activationId,
          materializeLeaseId: job.materializeLeaseId,
          materializeLeaseUntil: { $gt: new Date(now()) },
        });
        if (stopped) return;
        const result = await materialize(
          db,
          { accountId: job.accountId, branchId: job.branchId, businessId: String(job.license) },
          { now, signal: controller.signal }
        );
        if (stopped || result.status === 'cancelled') return;
        const delay =
          result.status === 'denied'
            ? 300000
            : ['materialized', 'empty'].includes(result.status)
              ? 60000
              : 15000;
        const next = result.status === 'deferred' ? result.retryAt : new Date(now() + delay);
        if (!(next instanceof Date) || !Number.isFinite(next.getTime()) || next.getTime() <= now())
          throw new Error('invalid_stock_materialization_schedule');
        await preferences.updateOne(
          lease(),
          {
            $set: { nextMaterializeAt: next, lastMaterializeState: result.status },
            $unset: { materializeLeaseId: '', materializeLeaseUntil: '', materializeError: '' },
          },
          { maxTimeMS: 500 }
        );
        return { scan: scanResult, delivery: result.status };
      } catch (error) {
        if (lease && !stopped)
          await preferences.updateOne(
            lease(),
            {
              $set: {
                nextMaterializeAt: new Date(now() + 60000),
                lastMaterializeState: 'error',
                materializeError: 'stock_materialization_unavailable',
              },
              $unset: { materializeLeaseId: '', materializeLeaseUntil: '' },
            },
            { maxTimeMS: 500 }
          );
        throw error;
      } finally {
        try {
          if (job)
            await preferences.updateOne(
              { _id: job._id, materializeLeaseId: job.materializeLeaseId },
              { $unset: { materializeLeaseId: '', materializeLeaseUntil: '' } },
              { maxTimeMS: 500 }
            );
        } finally {
          controller = null;
          running = false;
        }
      }
    },
  };
}
module.exports = { createStockNotificationWorker };
