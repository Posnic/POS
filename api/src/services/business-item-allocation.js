'use strict';
const { MetricError } = require('./business-metrics');
const MAX_LINES = 1000;
const fail = () => {
  throw new MetricError('invalid_item_allocation');
};

/** Allocate a recorded invoice/refund total, never recalculate its price.
 * Aggregate equal item IDs before rounding, so splitting one item into multiple
 * bill lines cannot change its revenue. Exact remainders and ID tie-breaking
 * make allocation independent of input order and floating-point products.
 * The caller must supply original sale lines or that return's immutable lines;
 * the remaining item list on a returned sale is not an invoice snapshot. */
function allocateItemRevenue(totalMinor, lines) {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor < 0 ||
    !Array.isArray(lines) ||
    !lines.length ||
    lines.length > MAX_LINES
  )
    fail();
  const grouped = new Map();
  for (const line of lines) {
    if (
      !line ||
      typeof line.itemId !== 'string' ||
      !/^[a-f\d]{24}$/i.test(line.itemId) ||
      !Number.isSafeInteger(line.grossMinor) ||
      line.grossMinor < 0
    )
      fail();
    const itemId = line.itemId.toLowerCase();
    grouped.set(itemId, (grouped.get(itemId) || 0n) + BigInt(line.grossMinor));
  }
  const totalWeight = [...grouped.values()].reduce((sum, value) => sum + value, 0n);
  const total = BigInt(totalMinor);
  if (!totalWeight && total) fail();
  const rows = [...grouped].map(([itemId, weight]) => {
    const product = total * weight;
    return {
      itemId,
      allocated: totalWeight ? product / totalWeight : 0n,
      remainder: totalWeight ? product % totalWeight : 0n,
    };
  });
  rows.sort((a, b) =>
    a.remainder === b.remainder
      ? a.itemId < b.itemId
        ? -1
        : a.itemId > b.itemId
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  const assigned = rows.reduce((sum, row) => sum + row.allocated, 0n);
  const remaining = Number(total - assigned);
  for (let i = 0; i < remaining; i++) rows[i].allocated++;
  return rows
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    .map(({ itemId, allocated }) => ({ itemId, amountMinor: Number(allocated) }));
}
module.exports = { allocateItemRevenue, MAX_LINES };
