'use strict';
const { MetricError, minorUnits, businessDate, saleContribution } = require('./business-metrics');
const { originalItemFacts } = require('./business-item-origin');
const { allocateItemRevenue, MAX_LINES } = require('./business-item-allocation');
const MAX_RETURN_LINES = 10000;
const fail = (code) => {
  throw new MetricError(code);
};
function add(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('item_amount_overflow');
  return result;
}
function readOrigin(sale) {
  if (!Object.hasOwn(sale, 'business_item_origin')) {
    const value = originalItemFacts(sale, sale.date);
    if (!value) fail('unavailable_original_items');
    return value;
  }
  const stored = sale.business_item_origin;
  if (
    !stored ||
    stored.schemaVersion !== 1 ||
    !Array.isArray(stored.lines) ||
    stored.lines.length > MAX_LINES
  )
    fail('invalid_original_items');
  // Reuse the writer's bounded decimal/name/unit validation, then bind the
  // snapshot to the current invoice. Never reconstruct from remaining items.
  const invoice = { ...sale };
  delete invoice.business_item_origin;
  const value = originalItemFacts(
    {
      ...invoice,
      sale_process: 'Add',
      items_return: [],
      return_refund_transactions: [],
      items_return_total: 0,
      items: stored.lines.map((line) => ({
        item_id: line?.itemId,
        item_name: line?.name,
        item_unit: line?.unit,
        item_quantity: line?.quantity,
        total_amount: line?.grossAmount,
      })),
    },
    stored.capturedAt
  );
  if (
    !value ||
    ['saleId', 'branchId', 'businessId', 'invoiceDate', 'salesTotal', 'capturedAt'].some(
      (key) => stored[key] !== value[key]
    )
  )
    fail('invalid_original_items');
  for (let i = 0; i < value.lines.length; i++) {
    if (Object.keys(value.lines[i]).some((key) => stored.lines[i][key] !== value.lines[i][key]))
      fail('invalid_original_items');
  }
  return value;
}

/** Desktop-only item facts. Throws on incomplete history so a publisher cannot
 * mistake omitted invoices for zero sales. Money reconciles to canonical v2;
 * quantities retain their own units and use integer thousandths. */
function itemSaleContribution(sale, branch) {
  const canonical = saleContribution(sale, branch);
  const result = { ...canonical, itemMetricVersion: 1, entries: [] };
  if (!canonical.entries.length) return result;
  const origin = readOrigin(sale);
  const quantities = new Map(),
    names = new Map(),
    rows = new Map();
  const key = (itemId, unit) => JSON.stringify([itemId, unit]);
  const row = (day, itemId) => {
    const identity = `${day}/${itemId}`;
    if (!rows.has(identity))
      rows.set(identity, {
        businessDate: day,
        itemId,
        name: names.get(itemId),
        billedSalesMinor: 0,
        refundsMinor: 0,
        quantities: new Map(),
      });
    return rows.get(identity);
  };
  function apply(lines, amount, day, returning) {
    const allocations = allocateItemRevenue(
      amount,
      lines.map((line) => ({
        itemId: line.itemId,
        grossMinor: minorUnits(line.grossAmount, branch.currencyDigits),
      }))
    );
    for (const allocation of allocations) {
      const target = row(day, allocation.itemId);
      const field = returning ? 'refundsMinor' : 'billedSalesMinor';
      target[field] = add(target[field], allocation.amountMinor);
    }
    for (const line of lines) {
      const identity = key(line.itemId, line.unit),
        quantity = minorUnits(line.quantity, 3);
      if (returning) {
        const remaining = quantities.get(identity);
        if (remaining === undefined || remaining < quantity) fail('unreconciled_item_quantities');
        quantities.set(identity, remaining - quantity);
      } else quantities.set(identity, add(quantities.get(identity) || 0, quantity));
      const target = row(day, line.itemId);
      if (!target.quantities.has(line.unit))
        target.quantities.set(line.unit, {
          unit: line.unit,
          soldMilli: 0,
          returnedMilli: 0,
        });
      const unit = target.quantities.get(line.unit);
      const field = returning ? 'returnedMilli' : 'soldMilli';
      unit[field] = add(unit[field], quantity);
    }
  }
  // A repeated item can carry several units. Revenue is grouped by item;
  // quantity totals are never added across units. Stable name selection makes
  // line order immaterial when an invoice contains differing historical names.
  for (const line of origin.lines) {
    if (!names.has(line.itemId) || line.name < names.get(line.itemId))
      names.set(line.itemId, line.name);
  }
  apply(
    origin.lines,
    minorUnits(sale.sales_total, branch.currencyDigits),
    businessDate(sale.date, branch.timezone),
    false
  );
  let returnLines = 0;
  for (const block of sale.items_return || []) {
    const refund = block.returnArray;
    if (
      !Array.isArray(refund.returnValue) ||
      (returnLines += refund.returnValue.length) > MAX_RETURN_LINES
    )
      fail('unsupported_item_returns');
    const facts = originalItemFacts(
      {
        _id: sale._id,
        branch_id: sale.branch_id,
        license: sale.license,
        sale_process: 'Add',
        date: refund.returnDate,
        sales_total: refund.itemsTotalAmount,
        items: refund.returnValue,
      },
      refund.returnDate
    );
    if (!facts) fail('invalid_return_items');
    apply(
      facts.lines,
      minorUnits(refund.itemsTotalAmount, branch.currencyDigits),
      businessDate(refund.returnDate, branch.timezone),
      true
    );
  }
  result.entries = [...rows.values()]
    .map((value) => ({
      ...value,
      quantities: [...value.quantities.values()].sort((a, b) =>
        a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0
      ),
    }))
    .sort(
      (a, b) => a.businessDate.localeCompare(b.businessDate) || a.itemId.localeCompare(b.itemId)
    );
  for (const day of canonical.entries) {
    const totals = result.entries
      .filter((entry) => entry.businessDate === day.businessDate)
      .reduce(
        (sum, entry) => ({
          billed: add(sum.billed, entry.billedSalesMinor),
          refunds: add(sum.refunds, entry.refundsMinor),
        }),
        { billed: 0, refunds: 0 }
      );
    if (totals.billed !== day.billedSalesMinor || totals.refunds !== day.refundsMinor)
      fail('unreconciled_item_revenue');
  }
  return result;
}
module.exports = { itemSaleContribution, MAX_RETURN_LINES };
