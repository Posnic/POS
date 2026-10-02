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

// Captain bills may store sales_total/total without the legacy items_total.
// Preserve a recorded zero; only fall back when the legacy field is missing.
function reportSaleTotal() {
  return {
    $toDouble: {
      $ifNull: ['$items_total', { $ifNull: ['$sales_total', { $ifNull: ['$total', 0] }] }],
    },
  };
}

module.exports = { reportableSales, reportSaleTotal };
