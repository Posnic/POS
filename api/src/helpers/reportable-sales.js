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
  return {
    $toDouble: {
      $ifNull: ['$sales_total', { $ifNull: ['$total', { $ifNull: ['$items_total', 0] }] }],
    },
  };
}

module.exports = { reportableSales, reportSaleTotal };
