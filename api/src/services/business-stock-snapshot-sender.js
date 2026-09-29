'use strict';
const crypto = require('node:crypto');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const {
  createSnapshotPages,
  digestOf,
  FRESHNESS_MS,
} = require('./business-stock-snapshot-contract');
const { receiveCommunityStockSnapshot } = require('./business-stock-snapshot-community');
const fail = (code) => {
  throw new MetricError(code);
};
const localOnly = () => {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) fail('desktop_required');
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') fail('stock_alerts_disabled');
};
const validAssignment = (job) =>
  job &&
  typeof job.assignmentId === 'string' &&
  /^[\w-]{43}$/.test(job.assignmentId) &&
  Number.isSafeInteger(job.epoch) &&
  job.epoch > 0;
function validateRow(row) {
  if (
    row.kind !== 'snapshot' ||
    !validAssignment(row) ||
    !['cloud', 'community'].includes(row.mode) ||
    ![row.license, row.branchId].every(
      (id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id)
    ) ||
    row._id !== 'snapshot:' + row.license + ':' + row.branchId ||
    typeof row.snapshotId !== 'string' ||
    !/^[a-f\d]{64}$/.test(row.snapshotId) ||
    typeof row.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.preparedAt)) ||
    new Date(row.preparedAt).toISOString() !== row.preparedAt ||
    !Number.isInteger(row.nextPage) ||
    row.nextPage < 0 ||
    row.nextPage > 100
  )
    fail('invalid_stock_snapshot_state');
}
function validReceipt(receipt, page, final) {
  return (
    receipt &&
    Object.keys(receipt).sort().join(',') ===
      'accepted,complete,digest,pageIndex,schemaVersion,snapshotId' &&
    receipt.schemaVersion === 1 &&
    receipt.accepted === true &&
    typeof receipt.complete === 'boolean' &&
    (!final || receipt.complete) &&
    receipt.snapshotId === page.snapshotId &&
    receipt.pageIndex === page.pageIndex &&
    receipt.digest === digestOf(page)
  );
}
/** One immutable source observation per branch. Assignment is frozen before any
 * page is sent; the cursor advances only after an exact durable receipt. */
function createStockSnapshotSender(db, { send, now = Date.now } = {}) {
  if (typeof send !== 'function') fail('stock_snapshot_transport_required');
  const local = db.collection('business_stock_alert_local');
  let running = false,
    stopped = false,
    controller;
  return {
    async stage(input, branch, mode) {
      localOnly();
      if (stopped) fail('worker_stopped');
      if (
        !['cloud', 'community'].includes(mode) ||
        (mode === 'community' && process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1')
      )
        fail('invalid_stock_snapshot_transport');
      const observation = structuredClone(input);
      const pages = createSnapshotPages(observation, branch, { now });
      const preparedAt = observation.summary.preparedAt;
      if (now() - Date.parse(preparedAt) >= FRESHNESS_MS) fail('stale_stock_snapshot');
      const snapshotId = pages[0].snapshotId;
      const key = 'snapshot:' + branch.license + ':' + branch.id;
      const prior = await local.findOne({ _id: key }, { maxTimeMS: 500 });
      if (prior) {
        validateRow(prior);
        if (prior.observation && digestOf(prior.observation) !== prior.snapshotId)
          fail('invalid_stock_snapshot_state');
      }
      if (prior?.snapshotId === snapshotId) {
        if (prior.mode !== mode) fail('stock_snapshot_transport_changed');
        return { snapshotId, duplicate: true };
      }
      if (prior?.observation && now() - Date.parse(prior.preparedAt) < FRESHNESS_MS)
        fail('stock_snapshot_pending');
      if (
        prior &&
        (prior.preparedAt >= preparedAt || prior.preparedAt > observation.summary.observedFrom)
      )
        fail('stale_stock_snapshot');
      const job = await db.collection('business_reporting_local').findOne(
        {
          _id: branch.id + ':stock',
          kind: 'job',
          publisherMode: mode,
          summaryKind: 'stock',
          license: branch.license,
          branchId: branch.id,
          expiresAt: { $gt: new Date(now()) },
        },
        { maxTimeMS: 500 }
      );
      if (!validAssignment(job)) fail('stock_snapshot_assignment_required');
      const result = await local.updateOne(
        { _id: key, snapshotId: prior ? prior.snapshotId : { $exists: false } },
        {
          $set: {
            kind: 'snapshot',
            license: branch.license,
            branchId: branch.id,
            snapshotId,
            preparedAt,
            observation,
            mode,
            assignmentId: job.assignmentId,
            epoch: job.epoch,
            nextPage: 0,
            nextAttemptAt: new Date(now()),
            ...(prior?.observation
              ? {
                  lastDiscarded: {
                    snapshotId: prior.snapshotId,
                    reason: 'stale_stock_snapshot',
                    at: new Date(now()),
                  },
                }
              : {}),
          },
          $unset: { leaseId: '', leaseUntil: '', error: '', lastReceipt: '', completedAt: '' },
        },
        { upsert: !prior, maxTimeMS: 500 }
      );
      if (!result.matchedCount && !result.upsertedCount) fail('stock_snapshot_busy');
      return { snapshotId, duplicate: false };
    },
    stop() {
      stopped = true;
      controller?.abort();
    },
    async tick() {
      localOnly();
      if (running || stopped) return;
      running = true;
      let lease;
      try {
        await local.createIndex({ kind: 1, nextAttemptAt: 1, leaseUntil: 1 });
        const row = await local.findOneAndUpdate(
          {
            kind: 'snapshot',
            observation: { $exists: true },
            nextAttemptAt: { $lte: new Date(now()) },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date(now()) } }],
          },
          { $set: { leaseId: crypto.randomUUID(), leaseUntil: new Date(now() + 30000) } },
          { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 500 }
        );
        if (!row) return;
        lease = { _id: row._id, snapshotId: row.snapshotId, leaseId: row.leaseId };
        validateRow(row);
        if (
          !validAssignment(row) ||
          !['cloud', 'community'].includes(row.mode) ||
          row._id !== 'snapshot:' + row.license + ':' + row.branchId
        )
          fail('invalid_stock_snapshot_state');
        const pages = createSnapshotPages(
          row.observation,
          { id: row.branchId, license: row.license },
          { now }
        );
        if (
          pages[0].snapshotId !== row.snapshotId ||
          row.preparedAt !== row.observation.summary.preparedAt ||
          !Number.isInteger(row.nextPage) ||
          row.nextPage < 0 ||
          row.nextPage >= pages.length
        )
          fail('invalid_stock_snapshot_state');
        if (now() - Date.parse(row.preparedAt) >= FRESHNESS_MS) {
          await local.updateOne(
            lease,
            {
              $set: {
                lastDiscarded: {
                  snapshotId: row.snapshotId,
                  reason: 'stale_stock_snapshot',
                  at: new Date(now()),
                },
              },
              $unset: { observation: '', nextAttemptAt: '', leaseId: '', leaseUntil: '' },
            },
            { maxTimeMS: 500 }
          );
          return { discarded: true };
        }
        const started = now();
        let sent = 0;
        for (let index = row.nextPage; index < pages.length && sent < 10; index++) {
          const remaining = 20000 - (now() - started);
          if (remaining <= 0 || stopped) break;
          if (now() - Date.parse(row.preparedAt) >= FRESHNESS_MS) fail('stale_stock_snapshot');
          if (
            !(await local.findOne(
              { ...lease, nextPage: index, leaseUntil: { $gt: new Date(now()) } },
              { maxTimeMS: 250 }
            ))
          )
            return;
          const page = pages[index];
          controller = new AbortController();
          let timer;
          let receipt;
          try {
            receipt = await Promise.race([
              send(
                { assignmentId: row.assignmentId, epoch: row.epoch, page: structuredClone(page) },
                { mode: row.mode, signal: controller.signal }
              ),
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  controller.abort();
                  reject(new MetricError('stock_snapshot_timeout'));
                }, remaining);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (stopped || controller.signal.aborted) return;
          const final = index === pages.length - 1;
          if (!validReceipt(receipt, page, final)) fail('invalid_stock_snapshot_receipt');
          const changed = await local.updateOne(
            { ...lease, nextPage: index, leaseUntil: { $gt: new Date(now()) } },
            {
              $set: {
                nextPage: index + 1,
                lastReceipt: receipt,
                ...(final ? { completedAt: new Date(now()) } : {}),
              },
              ...(final
                ? {
                    $unset: {
                      observation: '',
                      nextAttemptAt: '',
                      leaseId: '',
                      leaseUntil: '',
                      error: '',
                    },
                  }
                : {}),
            },
            { maxTimeMS: 500 }
          );
          if (!changed.matchedCount) return;
          sent++;
          if (final) return { sent, complete: true };
        }
        await local.updateOne(
          lease,
          {
            $set: { nextAttemptAt: new Date(now()) },
            $unset: { leaseId: '', leaseUntil: '', error: '' },
          },
          { maxTimeMS: 500 }
        );
        return { sent, complete: false };
      } catch (error) {
        if (lease)
          await local.updateOne(
            lease,
            {
              $set: {
                error: error.code || 'stock_snapshot_unavailable',
                nextAttemptAt: new Date(now() + 10000),
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
function createCommunityStockSnapshotTransport(db, { now = Date.now } = {}) {
  return async (publication, { mode, signal } = {}) => {
    localOnly();
    if (mode !== 'community' || process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1')
      fail('invalid_stock_snapshot_transport');
    if (signal?.aborted) fail('cancelled');
    const installation = await db
      .collection('business_reporting_local')
      .findOne({ _id: 'community-installation' }, { maxTimeMS: 500 });
    if (
      !installation ||
      typeof installation.deviceId !== 'string' ||
      !/^community-[a-f\d-]{36}$/.test(installation.deviceId)
    )
      fail('stock_snapshot_assignment_required');
    if (signal?.aborted) fail('cancelled');
    return receiveCommunityStockSnapshot(
      db,
      { deviceId: installation.deviceId, branches: [publication.page.summary.branchId] },
      publication,
      { now }
    );
  };
}
module.exports = { createStockSnapshotSender, createCommunityStockSnapshotTransport, validReceipt };
