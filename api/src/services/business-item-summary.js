'use strict';
const { MetricError } = require('./business-metrics');
const { itemSaleContribution } = require('./business-item-metrics');
const MAX_ITEMS = 10000,
  MAX_UNITS = 16,
  TOP_ITEMS = 20;
function sum(a, b) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new MetricError('item_amount_overflow');
  return value;
}
/** A single-branch, single-day ranking. Never merge truncated branch rankings
 * to claim a global top list. An unproven invoice suppresses the entire list. */
function createItemSummary(branch, day) {
  const items = new Map();
  let sourceSales = 0,
    unavailableSales = 0,
    reason = null;
  return {
    add(sale) {
      sourceSales++;
      try {
        const contribution = itemSaleContribution(sale, branch);
        // Continue validating later invoices for an accurate unavailable count,
        // but retain no partial ranking once a source invoice failed.
        if (reason) return;
        for (const row of contribution.entries) {
          if (row.businessDate !== day) continue;
          if (!items.has(row.itemId)) {
            if (items.size >= MAX_ITEMS) throw new MetricError('item_budget_exceeded');
            items.set(row.itemId, {
              itemId: row.itemId,
              name: row.name,
              billedSalesMinor: 0,
              refundsMinor: 0,
              quantities: new Map(),
            });
          }
          const item = items.get(row.itemId);
          if (row.name < item.name) item.name = row.name;
          item.billedSalesMinor = sum(item.billedSalesMinor, row.billedSalesMinor);
          item.refundsMinor = sum(item.refundsMinor, row.refundsMinor);
          for (const unit of row.quantities) {
            if (!item.quantities.has(unit.unit)) {
              if (item.quantities.size >= MAX_UNITS) throw new MetricError('item_budget_exceeded');
              item.quantities.set(unit.unit, { unit: unit.unit, soldMilli: 0, returnedMilli: 0 });
            }
            const target = item.quantities.get(unit.unit);
            target.soldMilli = sum(target.soldMilli, unit.soldMilli);
            target.returnedMilli = sum(target.returnedMilli, unit.returnedMilli);
          }
        }
      } catch (error) {
        if (!(error instanceof MetricError)) throw error;
        unavailableSales++;
        reason ||=
          error.code === 'unavailable_original_items'
            ? 'original_items_unavailable'
            : error.code === 'item_budget_exceeded'
              ? 'item_budget_exceeded'
              : 'item_facts_invalid';
        items.clear();
      }
    },
    finish(totals) {
      let billed = 0,
        refunds = 0;
      if (!reason) {
        for (const item of items.values()) {
          billed = sum(billed, item.billedSalesMinor);
          refunds = sum(refunds, item.refundsMinor);
        }
        if (billed !== totals.billedSalesMinor || refunds !== totals.refundsMinor)
          throw new MetricError('unreconciled_item_revenue');
      }
      const ranked = [...items.values()]
        .map((item) => ({
          ...item,
          salesAfterReturnsMinor: sum(item.billedSalesMinor, -item.refundsMinor),
          quantities: [...item.quantities.values()].sort((a, b) =>
            a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0
          ),
        }))
        .sort(
          (a, b) =>
            b.salesAfterReturnsMinor - a.salesAfterReturnsMinor || a.itemId.localeCompare(b.itemId)
        );
      return {
        schemaVersion: 1,
        state: reason ? 'incomplete' : 'available',
        reason,
        sourceSales,
        unavailableSales,
        totalItems: reason ? null : items.size,
        truncated: !reason && items.size > TOP_ITEMS,
        items: ranked.slice(0, TOP_ITEMS),
      };
    },
  };
}
module.exports = { createItemSummary, MAX_ITEMS, MAX_UNITS, TOP_ITEMS };
