'use strict';

// Version 2: invoiced sales INCLUDING tax, after recorded discounts/rounding,
// less returns on their own business date. This is not cash collected or profit.
const METRIC_VERSION = 2;
class MetricError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new MetricError(code);
};
function minorUnits(value, digits) {
  if (![0, 1, 2, 3].includes(digits) || !['number', 'string'].includes(typeof value))
    fail('invalid_amount');
  const raw = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || raw.length > 30) fail('invalid_amount');
  const [whole, fraction = ''] = raw.split('.');
  // Decimal arithmetic avoids binary rounding and rejects silently lost money.
  if (fraction.slice(digits).replace(/0/g, '')) fail('unsupported_precision');
  const result =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('amount_overflow');
  return Number(result);
}
function instant(value) {
  if (
    !(value instanceof Date) &&
    !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
  )
    fail('invalid_date');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('invalid_date');
  return date;
}
const dateFormatters = new Map();
function businessDate(value, timezone) {
  try {
    if (typeof timezone !== 'string' || !timezone || timezone.length > 100)
      fail('invalid_timezone');
    if (!dateFormatters.has(timezone)) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      if (dateFormatters.size >= 64) dateFormatters.delete(dateFormatters.keys().next().value);
      dateFormatters.set(timezone, formatter);
    }
    const parts = dateFormatters.get(timezone).formatToParts(instant(value));
    const get = (key) => parts.find((p) => p.type === key).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    fail('invalid_date_or_timezone');
  }
}
function sum(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('amount_overflow');
  return result;
}
const id = (value) =>
  value && /^[a-f\d]{24}$/i.test(String(value))
    ? String(value).toLowerCase()
    : fail('invalid_scope');
function saleContribution(sale, branch) {
  const saleId = id(sale._id),
    branchId = id(branch.id),
    license = id(branch.license);
  if (id(sale.branch_id) !== branchId || id(sale.license) !== license) fail('scope_mismatch');
  if (!/^[A-Z]{3}$/.test(branch.currency) || ![0, 1, 2, 3].includes(branch.currencyDigits))
    fail('invalid_currency');
  const base = {
    metricDefinitionVersion: METRIC_VERSION,
    saleId,
    branchId,
    license,
    currency: branch.currency,
    currencyDigits: branch.currencyDigits,
    entries: [],
  };
  if (
    sale.training === true ||
    sale.training === 'true' ||
    sale.is_training === true ||
    sale.deleted === true ||
    sale.is_deleted === true
  )
    return base;
  const process = sale.sale_process;
  if (['Hold', 'Cancel', 'cancel', 'Cancelled', 'cancelled', 'Void', 'Draft'].includes(process))
    return base;
  // Table orders retain KOT after settlement. Excluding every KOT would hide
  // paid restaurant bills. An unpaid open table remains work in progress.
  if (process === 'KOT' && !['Paid', 'Partialy Paid'].includes(sale.payment_status)) return base;
  if (!['Add', 'Edit', 'Partial', 'PartialReturn', 'FullReturn', 'KOT'].includes(process))
    fail('unsupported_sale_state');
  const amount = minorUnits(sale.sales_total, branch.currencyDigits);
  const date = businessDate(sale.date, branch.timezone);
  const entries = new Map();
  const entry = (day) => {
    if (!entries.has(day))
      entries.set(day, {
        businessDate: day,
        billedSalesMinor: 0,
        refundsMinor: 0,
        completedSales: 0,
      });
    return entries.get(day);
  };
  Object.assign(entry(date), { billedSalesMinor: amount, completedSales: 1 });
  const returns = sale.items_return ?? [];
  if (!Array.isArray(returns) || returns.length > 1000) fail('unsupported_returns');
  const seen = new Set();
  let refunds = 0;
  for (const block of returns) {
    const r = block?.returnArray;
    if (!r) fail('invalid_return');
    const returnId = id(r.returnObjId);
    if (seen.has(returnId)) fail('duplicate_return');
    seen.add(returnId);
    const value = minorUnits(r.itemsTotalAmount, branch.currencyDigits);
    const row = entry(businessDate(r.returnDate, branch.timezone));
    row.refundsMinor = sum(row.refundsMinor, value);
    refunds = sum(refunds, value);
  }
  if (
    refunds > amount ||
    minorUnits(sale.items_return_total ?? 0, branch.currencyDigits) !== refunds
  )
    fail('unreconciled_returns');
  base.entries = [...entries.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  return base;
}
module.exports = { METRIC_VERSION, MetricError, minorUnits, businessDate, saleContribution };
