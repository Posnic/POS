'use strict';
const { MetricError, minorUnits } = require('./business-metrics');
const fail = (code) => {
  throw new MetricError(code);
};
const id = (value) => /^[a-f\d]{24}$/.test(String(value ?? ''));
function quantity(value, signed = false) {
  if (!['number', 'string'].includes(typeof value)) fail('invalid_stock_quantity');
  const raw = String(value),
    negative = raw.startsWith('-');
  if (negative && !signed) fail('invalid_stock_threshold');
  if (typeof value === 'number') {
    // Legacy $inc writes use BSON doubles. Accept only rounding noise within
    // four floating-point ULPs, capped below one millionth of a stock unit.
    const absolute = Math.abs(value),
      scaled = Math.round(absolute * 1000);
    if (
      !Number.isSafeInteger(scaled) ||
      (scaled === 0 && absolute !== 0) ||
      Math.abs(scaled / 1000 - absolute) > Math.min(Number.EPSILON * absolute * 4, 0.0000001)
    )
      fail('invalid_stock_quantity');
    return negative && scaled ? -scaled : scaled;
  }

  try {
    const amount = minorUnits(negative ? raw.slice(1) : raw, 3);
    return negative && amount ? -amount : amount;
  } catch {
    fail('invalid_stock_quantity');
  }
}
/** A stored desktop quantity, not reconstructed availability or source completeness.
 * Multi-branch catalogue access does not prove separate branch stock balances. */
function stockFact(item, branch) {
  if (!id(branch?.id) || !id(branch?.license) || !item || String(item.license) !== branch.license)
    fail('invalid_stock_scope');
  const scope = new Set();
  if (item.branch_id != null) {
    if (!id(item.branch_id)) fail('invalid_stock_scope');
    scope.add(String(item.branch_id));
  }
  if (item.branch_access != null) {
    if (!Array.isArray(item.branch_access) || item.branch_access.length > 100)
      fail('invalid_stock_scope');
    for (const entry of item.branch_access) {
      if (!id(entry?.branch_id)) fail('invalid_stock_scope');
      scope.add(String(entry.branch_id));
    }
  }
  if (!scope.has(branch.id)) fail('invalid_stock_scope');
  if (
    [1, '1', true].includes(item.del_status) ||
    ['instant', 'inactive', 'draft'].includes(item.item_status) ||
    [false, 'false'].includes(item.track_inventory)
  )
    return null;
  if (![true, 'true'].includes(item.track_inventory)) fail('stock_tracking_unknown');
  if (!['active', 'regular'].includes(item.item_status)) fail('stock_status_unknown');
  if (scope.size !== 1) fail('ambiguous_branch_stock');
  if (
    !id(item._id) ||
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.trim().length > 200 ||
    typeof item.unit !== 'string' ||
    !item.unit.trim() ||
    item.unit.trim().length > 40
  )
    fail('invalid_stock_item');
  const rawThreshold = item.reorder_point ?? branch.notificationRange;
  if (rawThreshold == null || rawThreshold === '') fail('stock_threshold_unconfigured');
  const availableMilli = quantity(item.available_quantity, true),
    thresholdMilli = quantity(rawThreshold);
  return {
    itemId: String(item._id),
    name: item.name.trim(),
    unit: item.unit.trim(),
    availableMilli,
    thresholdMilli,
    thresholdSource: item.reorder_point != null ? 'item' : 'branch',
    low: availableMilli <= thresholdMilli,
  };
}
module.exports = { stockFact };
