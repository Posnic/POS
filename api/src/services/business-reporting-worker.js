'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { isMultiTenant } = require('../db/tenant-context');
const { branchInfo } = require('./business-access');
const { prepareDesktopSummary } = require('./business-summary-preparer');

function createDesktopReportingWorker(
  db,
  { now = Date.now, prepare = prepareDesktopSummary } = {}
) {
  const local = db.collection('business_reporting_local');
  const community =
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING === '1'
      ? require('./business-local-reporting').createLocalReportingBridge(db, { now })
      : null;
  let running = false,
    stopped = false,
    controller = null,
    indexReady = false;
  return {
    stop() {
      stopped = true;
      controller?.abort();
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
            { $set: { protocolVersion: 2, expiresAt: new Date(now() + 120000) } },
            { upsert: true }
          );
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
        if (!/^[a-f\d]{24}$/.test(job.branchId || '') || !/^[a-f\d]{24}$/.test(job.license || ''))
          throw new Error('invalid_reporting_scope');
        const branch = await db
          .collection('branches')
          .findOne({ _id: new ObjectId(job.branchId), license: new ObjectId(job.license) });
        if (!branch) throw new Error('reporting_branch_unavailable');
        const info = branchInfo(branch);
        if (info.currency !== job.currency || info.timezone !== job.timezone)
          throw new Error('reporting_branch_changed');
        if (!indexReady) {
          await db.collection('sales').createIndex({ license: 1, branch_id: 1, _id: 1 });
          indexReady = true;
        }
        controller = new AbortController();
        const summary = await prepare(db, { ...info, license: job.license }, job.businessDate, {
          signal: controller.signal,
          now,
        });
        if (stopped) return;
        await local.updateOne(
          {
            _id: job._id,
            assignmentId: job.assignmentId,
            leaseId: job.leaseId,
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
  const timer = setInterval(() => {
    void worker.tick().catch(() => {});
  }, 30000);
  timer.unref();
  void worker.tick().catch(() => {});
  return () => {
    clearInterval(timer);
    worker.stop();
  };
}
module.exports = { createDesktopReportingWorker, startDesktopReporting };
