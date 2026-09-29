'use strict';
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const {
  PAGE_SIZE,
  digestOf,
  validateSnapshotPage,
  pageCount,
} = require('./business-stock-snapshot-contract');
const { validReceipt } = require('./business-stock-snapshot-sender');
/** Queue the already staged snapshot for the agent; never access its credentials.
 * The agent can upload consecutive pages independently of this receipt consumer. */
function createStockSnapshotAgentTransport(db, { now = Date.now } = {}) {
  return async (publication, { mode, signal } = {}) => {
    if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant())
      throw new MetricError('desktop_required');
    if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1')
      throw new MetricError('stock_alerts_disabled');
    if (mode !== 'cloud' || signal?.aborted)
      throw new MetricError('stock_snapshot_transport_unavailable');
    const page = publication?.page;
    const branch = { id: page?.summary?.branchId, license: page?.summary?.license };
    validateSnapshotPage(page, branch, { now });
    const local = db.collection('business_stock_alert_local');
    const filter = {
      _id: 'snapshot:' + branch.license + ':' + branch.id,
      kind: 'snapshot',
      mode: 'cloud',
      snapshotId: page.snapshotId,
      assignmentId: publication.assignmentId,
      epoch: publication.epoch,
      nextPage: page.pageIndex,
    };
    const row = await local.findOne(filter, { maxTimeMS: 500 });
    if (
      !row?.observation ||
      digestOf(row.observation.summary) !== digestOf(page.summary) ||
      digestOf(
        row.observation.facts.slice(page.pageIndex * PAGE_SIZE, (page.pageIndex + 1) * PAGE_SIZE)
      ) !== digestOf(page.facts)
    )
      throw new MetricError('stock_snapshot_handoff_changed');
    const receipt = row.transportReceipts?.[String(page.pageIndex)];
    if (receipt) {
      if (!validReceipt(receipt, page, page.pageIndex === pageCount(page.summary) - 1))
        throw new MetricError('invalid_stock_snapshot_receipt');
      return receipt;
    }
    await local.updateOne(
      { ...filter, nextTransportAt: { $exists: false }, transportCompletedAt: { $exists: false } },
      { $set: { nextTransportAt: new Date(now()), transportNextPage: row.transportNextPage ?? 0 } },
      { maxTimeMS: 500 }
    );
    throw new MetricError('stock_snapshot_awaiting_agent');
  };
}
module.exports = { createStockSnapshotAgentTransport };
