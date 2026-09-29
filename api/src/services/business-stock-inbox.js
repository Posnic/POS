'use strict';
const {
  validateStockCoverage,
  validateStockFact,
  MAX_DURATION_MS,
} = require('./business-stock-contract');
const { digestOf } = require('./business-stock-snapshot-contract');
const { recipientState } = require('./business-stock-recipient');
const { businessDate } = require('./business-metrics');
const instant = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const invalid = () => {
  throw Object.assign(new Error('invalid_stock_alert'), { code: 'invalid_stock_alert' });
};
function validateStockAlert(stock, { now = Date.now } = {}) {
  if (
    !stock ||
    Object.keys(stock).sort().join(',') !==
      'coverage,items,listTruncated,newLowItemCount,observedFrom,preparedAt,schemaVersion,snapshotId,sourceComplete,totalLowItemCount' ||
    stock.schemaVersion !== 1 ||
    typeof stock.snapshotId !== 'string' ||
    !/^[a-f\d]{64}$/.test(stock.snapshotId) ||
    stock.sourceComplete !== false ||
    !instant(stock.observedFrom) ||
    !instant(stock.preparedAt)
  )
    invalid();
  const start = Date.parse(stock.observedFrom),
    end = Date.parse(stock.preparedAt),
    at = now();
  if (!Number.isFinite(at) || start > end || end > at || end - start > MAX_DURATION_MS) invalid();
  const coverage = validateStockCoverage(stock.coverage);
  if (
    !Number.isSafeInteger(stock.totalLowItemCount) ||
    !Number.isSafeInteger(stock.newLowItemCount) ||
    stock.newLowItemCount < 1 ||
    stock.newLowItemCount > stock.totalLowItemCount ||
    stock.totalLowItemCount > coverage.verifiedItems ||
    !Array.isArray(stock.items) ||
    stock.items.length !== Math.min(stock.newLowItemCount, 20) ||
    stock.listTruncated !== stock.newLowItemCount > 20
  )
    invalid();
  let previous = '';
  for (const item of stock.items) {
    validateStockFact(item);
    if (!item.low || item.itemId <= previous) invalid();
    previous = item.itemId;
  }
  return stock;
}
/** Historical observations remain readable during quiet hours and after stock
 * changes. Reading never authorizes a push or claims the items are still low. */
async function visibleStockEvents(db, context, rows, now = Date.now) {
  const visible = new Map();
  if (
    process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1' ||
    !context.capabilities.includes('stock.read')
  )
    return visible;
  for (const row of rows) {
    if (
      row.kind !== 'stock_low' ||
      row.materializationPending !== false ||
      row.accountId !== context.accountId ||
      String(row.license) !== context.businessId ||
      !context.branches.some((branch) => branch.id === row.branchId) ||
      !(row.createdAt instanceof Date) ||
      !Number.isFinite(row.createdAt.getTime()) ||
      row.createdAt.getTime() > now() ||
      !(row.expiresAt instanceof Date) ||
      !(row.expiresAt.getTime() > now())
    )
      continue;
    try {
      validateStockAlert(row.stock, { now });
      if (
        row.stockDigest !== digestOf(row.stock) ||
        Date.parse(row.stock.preparedAt) > row.createdAt.getTime()
      )
        continue;
    } catch {
      continue;
    }
    const state = await recipientState(
      db,
      {
        accountId: context.accountId,
        businessId: context.businessId,
        branchId: row.branchId,
      },
      now,
      { observeOnly: true }
    );
    if (
      state.status !== 'eligible' ||
      state.preference.activationId !== row.activationId ||
      Date.parse(row.stock.observedFrom) < state.preference.enabledAt.getTime()
    )
      continue;
    visible.set(String(row._id), {
      stock: row.stock,
      businessDate: businessDate(row.createdAt, state.branch.timezone),
    });
  }
  return visible;
}
module.exports = { validateStockAlert, visibleStockEvents };
