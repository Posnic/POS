'use strict';
const crypto = require('node:crypto');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const {
  validateStockObservation,
  journalStockObservation,
} = require('./business-stock-alert-journal');
const MAX_AGE_MS = 86400000;
const fail = (code) => {
  throw new MetricError(code);
};
const localOnly = () => {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) fail('desktop_required');
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const digestOf = (observation) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(observation)))
    .digest('hex');
function validateRow(row) {
  if (
    row.kind !== 'observation' ||
    ![row.license, row.branchId].every(
      (id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id)
    ) ||
    row._id !== 'observation:' + row.license + ':' + row.branchId ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    row.revision >= Number.MAX_SAFE_INTEGER ||
    typeof row.observationId !== 'string' ||
    !/^[a-f\d-]{36}$/.test(row.observationId) ||
    typeof row.digest !== 'string' ||
    !/^[a-f\d]{64}$/.test(row.digest) ||
    typeof row.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.preparedAt)) ||
    new Date(row.preparedAt).toISOString() !== row.preparedAt
  )
    fail('invalid_stock_observation_state');
}
/** Durable source observation, separate from the public reporting snapshot.
 * One branch cannot replace an unfinished observation. Lease loss only causes
 * replay: the per-item journal is idempotent and the cursor is lease-fenced.
 * No timer is started here; activation awaits the acknowledged delivery path. */
function createStockAlertWorker(db, { now = Date.now, journal = journalStockObservation } = {}) {
  const collection = db.collection('business_stock_alert_local');
  let running = false,
    stopped = false,
    controller = null,
    indexed = false;
  return {
    async stage(input, branch) {
      localOnly();
      if (stopped) fail('worker_stopped');
      const observation = structuredClone(input);
      validateStockObservation(observation, branch, { now });
      const preparedAt = Date.parse(observation.summary.preparedAt);
      if (now() - preparedAt > MAX_AGE_MS) fail('stale_stock_observation');
      const digest = digestOf(observation);
      const key = 'observation:' + branch.license + ':' + branch.id;
      for (let attempt = 0; attempt < 5; attempt++) {
        const prior = await collection.findOne({ _id: key }, { maxTimeMS: 500 });
        if (prior) validateRow(prior);
        if (prior?.digest === digest)
          return { observationId: prior.observationId, duplicate: true };
        if (prior?.observation) fail('stock_observation_pending');
        if (prior?.preparedAt && prior.preparedAt >= observation.summary.preparedAt)
          fail('stale_stock_observation');
        if (prior?.preparedAt && prior.preparedAt > observation.summary.observedFrom)
          fail('overlapping_stock_observation');
        const observationId = crypto.randomUUID();
        try {
          const result = await collection.updateOne(
            {
              _id: key,
              ...(prior
                ? { revision: prior.revision, observation: { $exists: false } }
                : { revision: { $exists: false } }),
            },
            {
              $set: {
                kind: 'observation',
                license: branch.license,
                branchId: branch.id,
                observationId,
                digest,
                observation,
                preparedAt: observation.summary.preparedAt,
                afterItemId: null,
                revision: (prior?.revision ?? 0) + 1,
                nextAttemptAt: new Date(now()),
              },
              $unset: { leaseId: '', leaseUntil: '', error: '', completedAt: '' },
            },
            { upsert: !prior, maxTimeMS: 500 }
          );
          if (result.matchedCount || result.upsertedCount)
            return { observationId, duplicate: false };
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      fail('stock_alert_busy');
    },
    stop() {
      stopped = true;
      controller?.abort();
    },
    async tick() {
      localOnly();
      if (running || stopped) return;
      running = true;
      let job, lease;
      try {
        if (!indexed) {
          await collection.createIndex({ kind: 1, nextAttemptAt: 1, leaseUntil: 1 });
          indexed = true;
        }
        const at = new Date(now());
        job = await collection.findOneAndUpdate(
          {
            kind: 'observation',
            observation: { $exists: true },
            nextAttemptAt: { $lte: at },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: at } }],
          },
          { $set: { leaseId: crypto.randomUUID(), leaseUntil: new Date(now() + 30000) } },
          { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
        );
        if (!job) return;
        lease = { _id: job._id, leaseId: job.leaseId };
        validateRow(job);
        lease = {
          _id: job._id,
          observationId: job.observationId,
          revision: job.revision,
          leaseId: job.leaseId,
        };
        validateStockObservation(
          job.observation,
          { id: job.branchId, license: job.license },
          { now }
        );
        if (
          job.observation.summary.preparedAt !== job.preparedAt ||
          digestOf(job.observation) !== job.digest
        )
          fail('invalid_stock_observation_state');
        if (now() - Date.parse(job.preparedAt) > MAX_AGE_MS) {
          await collection.updateOne(
            lease,
            {
              $set: {
                lastDiscarded: {
                  observationId: job.observationId,
                  reason: 'stale_stock_observation',
                  at,
                },
                revision: job.revision + 1,
              },
              $unset: {
                observation: '',
                leaseId: '',
                leaseUntil: '',
                afterItemId: '',
                nextAttemptAt: '',
              },
            },
            { maxTimeMS: 500 }
          );
          return;
        }
        controller = new AbortController();
        const result = await journal(
          db,
          job.observation,
          { id: job.branchId, license: job.license },
          { now, signal: controller.signal, afterItemId: job.afterItemId, limit: 100 }
        );
        if (stopped) return;
        await collection.updateOne(
          lease,
          {
            $set: {
              revision: job.revision + 1,
              ...(result.complete
                ? { completedAt: new Date(now()) }
                : { afterItemId: result.nextAfter, nextAttemptAt: new Date(now()) }),
            },
            $unset: {
              leaseId: '',
              leaseUntil: '',
              error: '',
              ...(result.complete ? { observation: '', afterItemId: '', nextAttemptAt: '' } : {}),
            },
          },
          { maxTimeMS: 500 }
        );
        return result;
      } catch (error) {
        if (lease)
          await collection.updateOne(
            lease,
            {
              $set: {
                error: typeof error.code === 'string' ? error.code : 'stock_alert_unavailable',
                nextAttemptAt: new Date(now() + 300000),
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
module.exports = { createStockAlertWorker };
