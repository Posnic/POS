'use strict';

const { GRAPH_ALLOWED_SALE_PROCESSES } = require('../constants/sales.constants');

/**
 * Posted retail/credit sales keep their existing report semantics. A kitchen
 * order becomes reportable only after payment, even though its process remains
 * KOT. Do not infer settlement from a tender method or kitchen/floor status.
 * The nested $and composes safely with report-specific $or filters.
 */
function reportableSales(processes = GRAPH_ALLOWED_SALE_PROCESSES) {
  return {
    $and: [
      {
        $or: [
          { sale_process: { $in: [...processes] } },
          { sale_process: 'KOT', payment_status: 'Paid' },
        ],
      },
      { payment_status: { $ne: 'Cancelled' } },
    ],
  };
}

// The saved payable total is authoritative. Older item-total snapshots can
// be absent or stale after editing a KOT. Preserve zero and use legacy aliases
// only when the canonical bill total is absent.
function reportSaleTotal() {
  const original = {
    $ifNull: ['$sales_total', { $ifNull: ['$total', { $ifNull: ['$items_total', 0] }] }],
  };
  return {
    $toDouble: {
      $cond: [
        { $in: ['$sale_process', ['PartialReturn', 'FullReturn']] },
        { $ifNull: ['$items_total', original] },
        original,
      ],
    },
  };
}

// Returns retain the original invoice for the audit ledger. Remaining-item
// views and net sales reports must use the separately persisted balance.
function remainingSaleTotal(sale) {
  if (['PartialReturn', 'FullReturn'].includes(sale.sale_process) && sale.items_total != null)
    return sale.items_total;
  return sale.sales_total ?? sale.total ?? sale.items_total ?? 0;
}

// Item allocations are used by the day-end tax report. Older sales may have
// no item tax fields, in which case retain their bill-level total.
function reportSaleTax() {
  return {
    $let: {
      vars: {
        taxedItems: {
          $filter: {
            input: { $cond: [{ $isArray: '$items' }, '$items', []] },
            as: 'item',
            cond: { $ne: [{ $ifNull: ['$$item.tax_amount', null] }, null] },
          },
        },
      },
      in: {
        $cond: [
          { $gt: [{ $size: '$$taxedItems' }, 0] },
          {
            $sum: {
              $map: {
                input: '$$taxedItems',
                as: 'item',
                in: {
                  $convert: { input: '$$item.tax_amount', to: 'double', onError: 0, onNull: 0 },
                },
              },
            },
          },
          { $convert: { input: '$tax_amount', to: 'double', onError: 0, onNull: 0 } },
        ],
      },
    },
  };
}

module.exports = { reportableSales, reportSaleTotal, reportSaleTax, remainingSaleTotal };
