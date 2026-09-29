'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { isMultiTenant } = require('../db/tenant-context');
const { branchInfo } = require('./business-access');
const { prepareDesktopSummary } = require('./business-summary-preparer');
const { prepareDesktopRegisterSummary } = require('./business-register-summary');
const {
  prepareDesktopStockSummary,
  prepareDesktopStockObservation,
} = require('./business-stock-summary');
const {
  createStockSnapshotSender,
  createCommunityStockSnapshotTransport,
} = require('./business-stock-snapshot-sender');
const { createStockSnapshotAgentTransport } = require('./business-stock-snapshot-agent-transport');
const { validateStockSummary } = require('./business-stock-contract');
const { reportingJobKind } = require('./business-reporting-job');
const { MetricError } = require('./business-metrics');

function createDesktopReportingWorker(
  db,
  {
    now = Date.now,
    prepare = prepareDesktopSummary,
    prepareRegister = prepareDesktopRegisterSummary,
    prepareStock = prepareDesktopStockSummary,
    prepareObservation = prepareDesktopStockObservation,
  } = {}
) {
  const local = db.collection('business_reporting_local');
  const community =
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING === '1'
      ? require('./business-local-reporting').createLocalReportingBridge(db, { now })
      : null;
  let snapshots;
  const stockEnabled = () => process.env.POSNIC_BUSINESS_STOCK_ALERTS === '1';
  const sender = () =>
    (snapshots ??= createStockSnapshotSender(db, {
      now,
      send: community
        ? createCommunityStockSnapshotTransport(db, { now })
        : createStockSnapshotAgentTransport(db, { now }),
    }));
  const drainSnapshots = async () => {
    if (!stockEnabled() || stopped) return;
    try {
      await sender().tick({ maxPages: 100 });
    } catch {
      /* Durable transfer backoff is independent of reporting jobs. */
    }
  };
  let running = false,
    stopped = false,
    controller = null,
    indexReady = false,
    stockIndexReady = false;
  return {
    stop() {
      stopped = true;
      controller?.abort();
      snapshots?.stop();
    },
    async tick() {
      if (running || stopped || process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) return;
      running = true;
      let job;
      try {
        const at = new Date(now());
        if (community) {
          await community.enqueue();
          await community.publish();
        } else
          await local.updateOne(
            { _id: 'desktop-runtime' },
            {
              $set: {
                protocolVersion: 2,
                itemSummaryVersion: 1,
                registerSummaryVersion: 1,
                stockSummaryVersion: 1,
                ...(stockEnabled()
                  ? {
                      stockSnapshotVersion: 1,
                      stockSnapshotExpiresAt: new Date(at.getTime() + 120000),
                    }
                  : {}),
                stockSummaryExpiresAt: new Date(at.getTime() + 120000),
                registerSummaryExpiresAt: new Date(at.getTime() + 120000),
                expiresAt: new Date(at.getTime() + 120000),
              },
              ...(!stockEnabled()
                ? { $unset: { stockSnapshotVersion: '', stockSnapshotExpiresAt: '' } }
                : {}),
            },
            { upsert: true }
          );
        await drainSnapshots();
        if (stopped) return;
        job = await local.findOneAndUpdate(
          {
            kind: 'job',
            publisherMode: community ? 'community' : { $ne: 'community' },
            expiresAt: { $gt: at },
            pendingSummary: { $exists: false },
            $and: [
              {
                $or: [
                  { preparedAt: { $exists: false } },
                  { $expr: { $gt: ['$requestedAt', '$preparedAt'] } },
                ],
              },
              {
                $or: [
                  { lastAttemptAt: { $exists: false } },
                  { lastAttemptAt: { $lt: new Date(now() - 5 * 60000) } },
                ],
              },
              { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: at } }] },
            ],
          },
          {
            $set: {
              leaseId: crypto.randomBytes(16).toString('hex'),
              leaseUntil: new Date(now() + 45000),
              lastAttemptAt: at,
            },
          },
          { sort: { lastAttemptAt: 1, _id: 1 }, returnDocument: 'after' }
        );
        if (!job) return;
        const summaryKind = reportingJobKind(job);
        if (!/^[a-f\d]{24}$/.test(job.branchId || '') || !/^[a-f\d]{24}$/.test(job.license || ''))
          throw new Error('invalid_reporting_scope');
        const branch = await db
          .collection('branches')
          .findOne({ _id: new ObjectId(job.branchId), license: new ObjectId(job.license) });
        if (!branch) throw new Error('reporting_branch_unavailable');
        const info = branchInfo(branch);
        if (info.currency !== job.currency || info.timezone !== job.timezone)
          throw new Error('reporting_branch_changed');
        if (!stockIndexReady && summaryKind === 'stock') {
          await db.collection('items').createIndex({ license: 1, branch_id: 1, _id: 1 });
          await db
            .collection('items')
            .createIndex({ license: 1, 'branch_access.branch_id': 1, _id: 1 });
          stockIndexReady = true;
        }
        if (!indexReady && summaryKind !== 'stock') {
          await db.collection('sales').createIndex({ license: 1, branch_id: 1, _id: 1 });
          indexReady = true;
        }
        controller = new AbortController();
        const observation =
          summaryKind === 'stock' && stockEnabled()
            ? await prepareObservation(
                db,
                { ...info, license: job.license },
                { signal: controller.signal, now }
              )
            : null;
        const summary =
          summaryKind === 'stock'
            ? validateStockSummary(
                observation?.summary ??
                  (await prepareStock(
                    db,
                    { ...info, license: job.license },
                    { signal: controller.signal, now }
                  )),
                { id: job.branchId, license: job.license },
                { now }
              )
            : await (summaryKind === 'register-session' ? prepareRegister : prepare)(
                db,
                { ...info, license: job.license },
                summaryKind === 'register-session' ? job.sessionId : job.businessDate,
                {
                  signal: controller.signal,
                  now,
                  includeItems: job.includeItems === true,
                }
              );
        if (
          summaryKind === 'register-session' &&
          (summary.metricDefinitionVersion !== 'register-session-v1' ||
            summary.branchId !== job.branchId ||
            summary.license !== job.license ||
            summary.close?.sessionId !== job.sessionId ||
            summary.close?.closeRevision !== job.closeRevision ||
            summary.close?.businessDate !== job.businessDate)
        )
          throw new MetricError('close_changed');
        if (stopped) return;
        if (observation) {
          await sender().stage(
            observation,
            { ...info, license: job.license },
            community ? 'community' : 'cloud',
            { assignmentId: job.assignmentId, epoch: job.epoch }
          );
          await drainSnapshots();
        }
        if (stopped) return;
        await local.updateOne(
          {
            _id: job._id,
            assignmentId: job.assignmentId,
            leaseId: job.leaseId,
            ...(summaryKind === 'stock' ? { summaryKind: 'stock', stockSummaryVersion: 1 } : {}),
            ...(summaryKind === 'register-session'
              ? { closeRevision: job.closeRevision, sessionId: job.sessionId }
              : {}),
            pendingSummary: { $exists: false },
          },
          {
            $set: { pendingSummary: summary, preparedAt: new Date(now()) },
            $unset: { leaseId: '', leaseUntil: '', error: '' },
          }
        );
        if (community) await community.publish();
      } catch (error) {
        if (job)
          await local
            .updateOne(
              { _id: job._id, leaseId: job.leaseId },
              {
                $set: {
                  error: typeof error.code === 'string' ? error.code : 'preparation_unavailable',
                },
                $unset: { leaseId: '', leaseUntil: '' },
              }
            )
            .catch(() => {});
      } finally {
        controller = null;
        running = false;
      }
    },
  };
}
function startDesktopReporting(db) {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) return () => {};
  const worker = createDesktopReportingWorker(db);
  const recovery = require('./business-decision-recovery').createDecisionRecovery(db);
  const timer = setInterval(() => {
    void worker.tick().catch(() => {});
    void recovery.tick().catch(() => {});
  }, 30000);
  timer.unref();
  void worker.tick().catch(() => {});
  void recovery.tick().catch(() => {});
  return () => {
    clearInterval(timer);
    worker.stop();
  };
}
module.exports = { createDesktopReportingWorker, startDesktopReporting };
