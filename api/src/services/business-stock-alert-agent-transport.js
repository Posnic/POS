'use strict';
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const { validateBatch, validReceipt, digestOf } = require('./business-stock-alert-handoff');
/** Local mailbox adapter. The API never reads or copies sync-agent credentials.
 * Returning a receipt requires the agent's durable acknowledgement of this exact
 * handoff batch; a queued request is not reported as accepted. */
function createStockAlertAgentTransport(db, { now = Date.now } = {}) {
  return async (batch) => {
    if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant())
      throw new MetricError('desktop_required');
    const branch = { id: batch?.branchId, license: batch?.license };
    if (
      ![branch.id, branch.license].every(
        (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value)
      )
    )
      throw new MetricError('invalid_scope');
    validateBatch(batch, branch);
    const local = db.collection('business_stock_alert_local');
    const key = 'handoff:' + batch.license + ':' + batch.branchId;
    const row = await local.findOne(
      { _id: key, kind: 'handoff', 'batch.batchId': batch.batchId },
      { maxTimeMS: 500 }
    );
    if (!row || digestOf(row.batch) !== digestOf(batch))
      throw new MetricError('stock_alert_handoff_changed');
    if (row.receipt) {
      if (!validReceipt(row.receipt, batch)) throw new MetricError('invalid_stock_alert_receipt');
      return row.receipt;
    }
    if (row.transport && row.transport !== 'cloud')
      throw new MetricError('stock_alert_transport_changed');
    if (!row.nextTransportAt && !row.transportPublication) {
      const assignment = await db.collection('business_reporting_local').findOne(
        {
          _id: batch.branchId + ':stock',
          kind: 'job',
          publisherMode: 'cloud',
          summaryKind: 'stock',
          license: batch.license,
          branchId: batch.branchId,
          expiresAt: { $gt: new Date(now()) },
        },
        { maxTimeMS: 500 }
      );
      if (
        !assignment ||
        typeof assignment.assignmentId !== 'string' ||
        !/^[\w-]{43}$/.test(assignment.assignmentId) ||
        !Number.isSafeInteger(assignment.epoch) ||
        assignment.epoch < 1
      )
        throw new MetricError('stock_alert_assignment_required');
      await local.updateOne(
        {
          _id: key,
          'batch.batchId': batch.batchId,
          transportPublication: { $exists: false },
          nextTransportAt: { $exists: false },
        },
        {
          $set: {
            transport: 'cloud',
            transportAssignmentId: assignment.assignmentId,
            transportEpoch: assignment.epoch,
            nextTransportAt: new Date(now()),
          },
        },
        { maxTimeMS: 500 }
      );
    }
    throw new MetricError('stock_alert_awaiting_agent');
  };
}
module.exports = { createStockAlertAgentTransport };
