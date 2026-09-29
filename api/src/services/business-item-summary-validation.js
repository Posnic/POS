'use strict';
const fail = () => {
  throw Object.assign(new Error('invalid_item_summary'), {
    code: 'invalid_item_summary',
    status: 400,
  });
};
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const keys = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const text = (value, max) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
function validateItemSummary(value, summary) {
  if (
    !keys(value, [
      'schemaVersion',
      'state',
      'reason',
      'sourceSales',
      'unavailableSales',
      'totalItems',
      'truncated',
      'items',
    ]) ||
    value.schemaVersion !== 1 ||
    !integer(value.sourceSales, summary.completedSales, summary.sourceDocuments) ||
    !integer(value.unavailableSales, 0, value.sourceSales) ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  )
    fail();
  if (value.state === 'incomplete') {
    if (
      !['original_items_unavailable', 'item_facts_invalid', 'item_budget_exceeded'].includes(
        value.reason
      ) ||
      value.unavailableSales < 1 ||
      value.totalItems !== null ||
      value.truncated !== false ||
      value.items.length
    )
      fail();
    return structuredClone(value);
  }
  if (
    value.state !== 'available' ||
    value.reason !== null ||
    value.unavailableSales !== 0 ||
    !integer(value.totalItems, 0, 10000) ||
    value.truncated !== value.totalItems > 20 ||
    value.items.length !== Math.min(20, value.totalItems) ||
    (value.totalItems > 0 && value.sourceSales === 0)
  )
    fail();
  let billed = 0n,
    refunds = 0n,
    previous = null;
  const seen = new Set();
  for (const item of value.items) {
    if (
      !keys(item, [
        'itemId',
        'name',
        'billedSalesMinor',
        'refundsMinor',
        'salesAfterReturnsMinor',
        'quantities',
      ]) ||
      typeof item.itemId !== 'string' ||
      !/^[a-f\d]{24}$/.test(item.itemId) ||
      seen.has(item.itemId) ||
      !text(item.name, 300) ||
      !integer(item.billedSalesMinor) ||
      !integer(item.refundsMinor) ||
      !integer(item.salesAfterReturnsMinor, -Number.MAX_SAFE_INTEGER) ||
      item.salesAfterReturnsMinor !== item.billedSalesMinor - item.refundsMinor ||
      !Array.isArray(item.quantities) ||
      !item.quantities.length ||
      item.quantities.length > 16
    )
      fail();
    if (
      previous &&
      (previous.salesAfterReturnsMinor < item.salesAfterReturnsMinor ||
        (previous.salesAfterReturnsMinor === item.salesAfterReturnsMinor &&
          previous.itemId >= item.itemId))
    )
      fail();
    previous = item;
    seen.add(item.itemId);
    let priorUnit = null;
    for (const unit of item.quantities) {
      if (
        !keys(unit, ['unit', 'soldMilli', 'returnedMilli']) ||
        !text(unit.unit, 32) ||
        (priorUnit !== null && priorUnit >= unit.unit) ||
        !integer(unit.soldMilli) ||
        !integer(unit.returnedMilli) ||
        (unit.soldMilli === 0 && unit.returnedMilli === 0)
      )
        fail();
      priorUnit = unit.unit;
    }
    billed += BigInt(item.billedSalesMinor);
    refunds += BigInt(item.refundsMinor);
  }
  // A top list is a subset of each nonnegative total, even when net revenue is
  // negative. A complete list must reconcile exactly; truncation stays explicit.
  if (
    billed > BigInt(summary.billedSalesMinor) ||
    refunds > BigInt(summary.refundsMinor) ||
    (!value.truncated &&
      (billed !== BigInt(summary.billedSalesMinor) || refunds !== BigInt(summary.refundsMinor)))
  )
    fail();
  return structuredClone(value);
}
module.exports = { validateItemSummary };
