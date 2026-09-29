'use strict';
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const { validateBatch, digestOf } = require('./business-stock-alert-handoff');
const { receiveCommunityStockAlerts } = require('./business-stock-alert-community-ingest');
/** Resolve the local Community installation, never a user-supplied device ID.
 * Freeze the reporting job's assignment before acceptance so a retry cannot
 * relabel an old batch after a publisher change. No Cloud credential is used. */
function createCommunityStockAlertTransport(db, { now = Date.now } = {}) {
  return async (batch) => {
    if (
      process.env.POSNIC_DESKTOP !== '1' ||
      process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1' ||
      isMultiTenant()
    )
      throw new MetricError('desktop_required');
    if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1')
      throw new MetricError('stock_alerts_disabled');
    const branch = { id: batch?.branchId, license: batch?.license };
    if (
      ![branch.id, branch.license].every(
        (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value)
      )
    )
      throw new MetricError('invalid_scope');
    validateBatch(batch, branch);
    const handoffs = db.collection('business_stock_alert_local');
    const local = db.collection('business_reporting_local');
    const key = 'handoff:' + batch.license + ':' + batch.branchId;
    let row = await handoffs.findOne(
      { _id: key, kind: 'handoff', 'batch.batchId': batch.batchId },
      { maxTimeMS: 500 }
    );
    if (!row || digestOf(row.batch) !== digestOf(batch))
      throw new MetricError('stock_alert_handoff_changed');
    if (row.transport && row.transport !== 'community')
      throw new MetricError('stock_alert_transport_changed');
    const installation = await local.findOne({ _id: 'community-installation' }, { maxTimeMS: 500 });
    if (
      !installation ||
      typeof installation.deviceId !== 'string' ||
      !/^community-[a-f\d-]{36}$/.test(installation.deviceId)
    )
      throw new MetricError('stock_alert_assignment_required');
    if (!row.transportPublication) {
      const job = await local.findOne(
        {
          _id: batch.branchId + ':stock',
          kind: 'job',
          publisherMode: 'community',
          summaryKind: 'stock',
          license: batch.license,
          branchId: batch.branchId,
          expiresAt: { $gt: new Date(now()) },
        },
        { maxTimeMS: 500 }
      );
      if (
        !job ||
        typeof job.assignmentId !== 'string' ||
        !/^[\w-]{43}$/.test(job.assignmentId) ||
        !Number.isSafeInteger(job.epoch) ||
        job.epoch < 1
      )
        throw new MetricError('stock_alert_assignment_required');
      await handoffs.updateOne(
        {
          _id: key,
          'batch.batchId': batch.batchId,
          transportPublication: { $exists: false },
          transport: { $in: [null, 'community'] },
        },
        {
          $set: {
            transport: 'community',
            transportPublication: { assignmentId: job.assignmentId, epoch: job.epoch, batch },
          },
        },
        { maxTimeMS: 500 }
      );
      row = await handoffs.findOne(
        { _id: key, 'batch.batchId': batch.batchId },
        { maxTimeMS: 500 }
      );
    }
    const publication = row?.transportPublication;
    if (
      !publication ||
      Object.keys(publication).sort().join(',') !== 'assignmentId,batch,epoch' ||
      digestOf(publication.batch) !== digestOf(batch)
    )
      throw new MetricError('stock_alert_handoff_changed');
    return receiveCommunityStockAlerts(
      db,
      { deviceId: installation.deviceId, branches: [branch.id] },
      publication,
      { now }
    );
  };
}
module.exports = { createCommunityStockAlertTransport };
