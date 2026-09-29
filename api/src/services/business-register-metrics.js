'use strict';
const { saleContribution, minorUnits, MetricError } = require('./business-metrics');
const fail = (code) => {
  throw new MetricError(code);
};
const instant = (value) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('invalid_session_date');
  return value.getTime();
};
const add = (a, b) => {
  const value = a + b;
  if (!Number.isSafeInteger(value)) fail('amount_overflow');
  return value;
};

/** Contributions to an explicitly identified register session, across midnight.
 * The caller scans the branch, not just this session's invoices: refunds can
 * belong to an older invoice sold on another register. Missing return-session
 * attribution inside the period makes the result unavailable, never zero. */
function registerSaleContribution(sale, branch, close) {
  if (!close || close.branchId !== branch.id || !/^[a-f\d]{24}$/.test(close.sessionId || ''))
    fail('invalid_scope');
  const opened = Date.parse(close.openedAt),
    closed = Date.parse(close.closedAt);
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || opened > closed)
    fail('invalid_session_date');
  const canonical = saleContribution(sale, branch);
  const result = { billedSalesMinor: 0, refundsMinor: 0, completedSales: 0 };
  if (!canonical.entries.length) return result;
  const soldAt = instant(sale.date),
    belongs = String(sale.cashregister_id || '') === close.sessionId;
  if (
    soldAt >= opened &&
    soldAt <= closed &&
    !/^[a-f\d]{24}$/.test(String(sale.cashregister_id || ''))
  )
    fail('invoice_register_unavailable');
  if (belongs) {
    // Current invoices can be edited after a till closes. Without a financial
    // snapshot at close, those newer totals cannot be presented as historical.
    if (instant(sale.updated_date) > closed) fail('session_history_unavailable');
    // A table opened outside this session needs its settlement attribution,
    // which the current sale date alone cannot prove.
    if (soldAt < opened || soldAt > closed) fail('invoice_session_time_unavailable');
    result.billedSalesMinor = minorUnits(sale.sales_total, branch.currencyDigits);
    result.completedSales = 1;
  }
  for (const block of sale.items_return || []) {
    const refund = block.returnArray,
      at = instant(refund.returnDate);
    if (at < opened || at > closed) continue;
    if (!/^[a-f\d]{24}$/.test(refund.cashregister_id || '')) fail('return_register_unavailable');
    if (refund.cashregister_id === close.sessionId)
      result.refundsMinor = add(
        result.refundsMinor,
        minorUnits(refund.itemsTotalAmount, branch.currencyDigits)
      );
  }
  return result;
}
module.exports = { registerSaleContribution };
