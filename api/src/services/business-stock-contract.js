'use strict';
const { MetricError } = require('./business-metrics');
const MAX_DOCUMENTS = 10000,
  MAX_DURATION_MS = 15000,
  MAX_LOW_ITEMS = 100;
const STOCK_REASONS = Object.freeze([
  'invalid_stock_scope',
  'stock_tracking_unknown',
  'stock_status_unknown',
  'ambiguous_branch_stock',
  'invalid_stock_item',
  'stock_threshold_unconfigured',
  'invalid_stock_quantity',
  'invalid_stock_threshold',
]);
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DOCUMENTS;
const instant = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const label = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
const fail = () => {
  throw new MetricError('invalid_stock_summary');
};
/** Strict wire contract shared by desktop preparation and subsequent publication
 * and read boundaries. Unknown coverage never permits a completeness claim. */
function validateStockSummary(value, branch, { now = Date.now } = {}) {
  if (
    !id(branch?.id) ||
    !id(branch?.license) ||
    !exact(value, [
      'schemaVersion',
      'metricDefinitionVersion',
      'license',
      'branchId',
      'observedFrom',
      'preparedAt',
      'sourceComplete',
      'coverage',
      'lowItemCount',
      'lowItems',
      'listTruncated',
    ]) ||
    value.schemaVersion !== 1 ||
    value.metricDefinitionVersion !== 'stored-stock-v1' ||
    value.branchId !== branch.id ||
    value.license !== branch.license ||
    value.sourceComplete !== false ||
    !instant(value.observedFrom) ||
    !instant(value.preparedAt)
  )
    fail();
  const start = Date.parse(value.observedFrom),
    end = Date.parse(value.preparedAt),
    at = now();
  if (!Number.isFinite(at) || start > end || end > at || end - start > MAX_DURATION_MS) fail();
  const c = value.coverage;
  if (
    !exact(c, ['scannedItems', 'excludedItems', 'verifiedItems', 'unavailableItems', 'reasons']) ||
    ![c.scannedItems, c.excludedItems, c.verifiedItems, c.unavailableItems].every(count) ||
    c.excludedItems + c.verifiedItems + c.unavailableItems !== c.scannedItems ||
    !c.reasons ||
    typeof c.reasons !== 'object' ||
    Array.isArray(c.reasons)
  )
    fail();
  let unavailable = 0;
  for (const [reason, amount] of Object.entries(c.reasons)) {
    if (!STOCK_REASONS.includes(reason) || !count(amount) || amount === 0) fail();
    unavailable += amount;
  }
  if (
    unavailable !== c.unavailableItems ||
    !count(value.lowItemCount) ||
    value.lowItemCount > c.verifiedItems ||
    !Array.isArray(value.lowItems) ||
    value.lowItems.length !== Math.min(value.lowItemCount, MAX_LOW_ITEMS) ||
    value.listTruncated !== value.lowItemCount > MAX_LOW_ITEMS
  )
    fail();
  let previous = '';
  for (const item of value.lowItems) {
    if (
      !exact(item, [
        'itemId',
        'name',
        'unit',
        'availableMilli',
        'thresholdMilli',
        'thresholdSource',
        'low',
      ]) ||
      !id(item.itemId) ||
      item.itemId <= previous ||
      !label(item.name, 200) ||
      !label(item.unit, 40) ||
      !Number.isSafeInteger(item.availableMilli) ||
      !Number.isSafeInteger(item.thresholdMilli) ||
      item.thresholdMilli < 0 ||
      item.availableMilli > item.thresholdMilli ||
      item.low !== true ||
      !['item', 'branch'].includes(item.thresholdSource)
    )
      fail();
    previous = item.itemId;
  }
  return value;
}
module.exports = {
  validateStockSummary,
  STOCK_REASONS,
  MAX_DOCUMENTS,
  MAX_DURATION_MS,
  MAX_LOW_ITEMS,
};
