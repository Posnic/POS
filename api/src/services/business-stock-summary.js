'use strict';
const { ObjectId } = require('mongodb');
const { setTimeout: pause } = require('node:timers/promises');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const { stockFact } = require('./business-stock-facts');
const MAX_DOCUMENTS = 10000,
  MAX_DURATION_MS = 15000,
  PAGE_SIZE = 100,
  MAX_LOW_ITEMS = 100;
const scope = (value) => ({ $in: [new ObjectId(value), value] });
const projection = {
  _id: 1,
  license: 1,
  branch_id: 1,
  branch_access: 1,
  name: 1,
  unit: 1,
  item_status: 1,
  del_status: 1,
  track_inventory: 1,
  available_quantity: 1,
  reorder_point: 1,
};
const reasons = new Set([
  'invalid_stock_scope',
  'stock_tracking_unknown',
  'stock_status_unknown',
  'ambiguous_branch_stock',
  'invalid_stock_item',
  'stock_threshold_unconfigured',
  'invalid_stock_quantity',
  'invalid_stock_threshold',
]);
/** Desktop-only stored-stock observation. A completed scan is not proof of
 * source completeness, a point-in-time balance, or sync convergence. */
async function prepareDesktopStockSummary(db, branch, { signal, now = Date.now } = {}) {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant())
    throw new MetricError('desktop_required');
  if (
    ![branch?.id, branch?.license].every((id) => typeof id === 'string' && /^[a-f\d]{24}$/.test(id))
  )
    throw new MetricError('invalid_scope');
  const started = now();
  const checkBudget = () => {
    if (signal?.aborted) throw new MetricError('cancelled');
    if (now() - started > MAX_DURATION_MS) throw new MetricError('preparation_budget_exceeded');
  };
  checkBudget();
  const readBranch = () =>
    db
      .collection('branches')
      .findOne(
        { _id: new ObjectId(branch.id), license: scope(branch.license) },
        { projection: { _id: 1, notification_range: 1 }, maxTimeMS: 250 }
      );
  const settings = await readBranch();
  if (!settings) throw new MetricError('invalid_scope');
  const factBranch = { ...branch, notificationRange: settings.notification_range };
  const coverage = {
    scannedItems: 0,
    excludedItems: 0,
    verifiedItems: 0,
    unavailableItems: 0,
    reasons: {},
  };
  let lowItemCount = 0;
  const lowItems = [];
  const cursor = db
    .collection('items')
    .find(
      {
        license: scope(branch.license),
        $or: [{ branch_id: scope(branch.id) }, { 'branch_access.branch_id': scope(branch.id) }],
      },
      { projection }
    )
    .sort({ _id: 1 })
    .batchSize(PAGE_SIZE)
    .limit(MAX_DOCUMENTS + 1)
    .maxTimeMS(1500);
  try {
    for await (const item of cursor) {
      checkBudget();
      if (++coverage.scannedItems > MAX_DOCUMENTS)
        throw new MetricError('preparation_budget_exceeded');
      let fact;
      try {
        fact = stockFact(item, factBranch);
      } catch (error) {
        if (!(error instanceof MetricError) || !reasons.has(error.code)) throw error;
        coverage.unavailableItems++;
        coverage.reasons[error.code] = (coverage.reasons[error.code] || 0) + 1;
      }
      if (fact === null) coverage.excludedItems++;
      else if (fact) {
        coverage.verifiedItems++;
        if (fact.low) {
          lowItemCount++;
          if (lowItems.length < MAX_LOW_ITEMS) lowItems.push(fact);
        }
      }
      if (coverage.scannedItems % PAGE_SIZE === 0) await pause(10, undefined, { signal });
    }
    checkBudget();
    const after = await readBranch();
    checkBudget();
    if (
      !after ||
      JSON.stringify(after.notification_range) !== JSON.stringify(settings.notification_range)
    )
      throw new MetricError('stock_settings_changed');
    return {
      schemaVersion: 1,
      metricDefinitionVersion: 'stored-stock-v1',
      license: branch.license,
      branchId: branch.id,
      observedFrom: new Date(started).toISOString(),
      preparedAt: new Date(now()).toISOString(),
      sourceComplete: false,
      coverage,
      lowItemCount,
      lowItems,
      listTruncated: lowItemCount > lowItems.length,
    };
  } finally {
    await cursor.close();
  }
}
module.exports = { prepareDesktopStockSummary, MAX_DOCUMENTS, MAX_DURATION_MS, MAX_LOW_ITEMS };
