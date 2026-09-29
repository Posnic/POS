'use strict';
const crypto = require('node:crypto');
const { requestRecipientStock } = require('./business-stock-demand');
const { journalRecipientStockPage } = require('./business-stock-recipient-journal');
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
/** Durable recipient scans and lightweight desktop refresh requests.
 * No Inbox writes, pushes or timer.
 * Save the cursor after journal writes; losing the save replays idempotently. */
function createStockRecipientWorker(
  db,
  { now = Date.now, journal = journalRecipientStockPage } = {}
) {
  const preferences = db.collection('business_stock_notification_preferences');
  let running = false,
    stopped = false,
    controller;
  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
    async tick({ maxPages = 10 } = {}) {
      if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1' || stopped || running) return;
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
        fail('invalid_stock_scan_limit');
      running = true;
      let lease;
      try {
        await preferences.createIndex({ enabled: 1, nextScanAt: 1, leaseUntil: 1 });
        const job = await preferences.findOneAndUpdate(
          {
            enabled: true,
            nextScanAt: { $lte: new Date(now()) },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }],
          },
          { $set: { leaseId: crypto.randomUUID(), leaseUntil: new Date(now() + 30000) } },
          { sort: { nextScanAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
        );
        if (!job) return;
        lease = {
          _id: job._id,
          revision: job.revision,
          activationId: job.activationId,
          leaseId: job.leaseId,
          enabled: true,
        };
        if (
          job._id !== job.accountId + ':' + job.branchId ||
          ![job.accountId, job.branchId, String(job.license)].every((id) =>
            /^[a-f\d]{24}$/.test(id)
          ) ||
          !Number.isSafeInteger(job.revision) ||
          job.revision < 1 ||
          typeof job.activationId !== 'string' ||
          !/^[a-f\d-]{36}$/.test(job.activationId)
        )
          fail('invalid_stock_scan_state');
        const target = {
          accountId: job.accountId,
          branchId: job.branchId,
          businessId: String(job.license),
        };
        let continuation = job.cursor,
          pages = 0,
          queued = 0;
        const started = now();
        controller = new AbortController();
        await requestRecipientStock(db, target, {
          now,
          signal: controller.signal,
          preference: job,
        });
        while (pages < maxPages && now() - started < 3000 && !stopped) {
          const remaining = Math.max(1, Math.floor(3000 - (now() - started)));
          if (
            !(await preferences.findOne(
              { ...lease, leaseUntil: { $gt: new Date(now()) } },
              { projection: { _id: 1 }, maxTimeMS: 250 }
            ))
          )
            return;
          const result = await journal(db, target, {
            ...continuation,
            now,
            budgetMs: remaining,
            signal: controller.signal,
          });
          if (stopped || result.status === 'cancelled') return;
          const liveLease = { ...lease, leaseUntil: { $gt: new Date(now()) } };
          if (result.status !== 'processed') {
            if (
              !['changed', 'unavailable', 'disabled', 'denied', 'deferred'].includes(result.status)
            )
              fail('invalid_stock_scan_result');
            const delay = result.status === 'denied' ? 300000 : 15000;
            await preferences.updateOne(
              liveLease,
              {
                $set: { nextScanAt: new Date(now() + delay), lastScanState: result.status },
                $unset: { cursor: '', leaseId: '', leaseUntil: '' },
              },
              { maxTimeMS: 500 }
            );
            return { pages, queued, state: result.status };
          }
          if (
            !Number.isInteger(result.processed) ||
            result.processed < 0 ||
            result.processed > 100 ||
            !Number.isInteger(result.queued) ||
            result.queued < 0 ||
            result.queued > result.processed ||
            !/^[a-f\d]{64}$/.test(result.snapshotId) ||
            typeof result.preparedAt !== 'string' ||
            !Number.isFinite(Date.parse(result.preparedAt))
          )
            fail('invalid_stock_scan_result');
          continuation = result.next;
          const update = {
            $set: {
              ...(continuation
                ? { cursor: continuation }
                : {
                    lastScannedSnapshotId: result.snapshotId,
                    lastScannedPreparedAt: result.preparedAt,
                    lastScanState: 'complete',
                    nextScanAt: new Date(now() + 60000),
                  }),
            },
            ...(!continuation
              ? { $unset: { cursor: '', leaseId: '', leaseUntil: '', scanError: '' } }
              : {}),
          };
          const saved = await preferences.updateOne(liveLease, update, { maxTimeMS: 500 });
          if (!saved.matchedCount) return;
          pages++;
          queued += result.queued;
          if (!continuation) return { pages, queued, state: 'complete' };
          if (result.processed === 0) break;
        }
        await preferences.updateOne(
          lease,
          {
            $set: { nextScanAt: new Date(now() + 1), lastScanState: 'partial' },
            $unset: { leaseId: '', leaseUntil: '', scanError: '' },
          },
          { maxTimeMS: 500 }
        );
        return { pages, queued, state: 'partial' };
      } catch (error) {
        if (lease)
          await preferences.updateOne(
            lease,
            {
              $set: {
                nextScanAt: new Date(now() + 60000),
                lastScanState: 'error',
                scanError: typeof error.code === 'string' ? error.code : 'stock_scan_unavailable',
              },
              $unset: { leaseId: '', leaseUntil: '' },
            },
            { maxTimeMS: 500 }
          );
        throw error;
      } finally {
        running = false;
        controller = null;
      }
    },
  };
}
module.exports = { createStockRecipientWorker };
