'use strict';
// Existing unpaid KOTs remain active on upgrade. Paid legacy receipts are not
// reopened; explicit floor lifecycle enrollment starts with new service work.
function floorEligibility() {
  return {
    floor_closed_at: { $exists: false },
    order_state: { $nin: ['rejected', 'cancelled'] },
    $or: [
      { sale_process: 'KOT', payment_status: { $nin: ['Paid', 'Cancelled'] } },
      {
        floor_lifecycle: true,
        sale_process: { $in: ['KOT', 'Add', 'Edit'] },
        payment_status: { $ne: 'Cancelled' },
      },
    ],
  };
}
// Payment completion releases dine-in occupancy. Keep takeaway preparation and
// inconsistent/partial payment records active rather than hiding money still due.
function settledDineIn() {
  return {
    payment_status: 'Paid',
    dine_type: { $not: /^take[\s_-]*away$/i },
    $expr: {
      $and: ['payment_pending', 'balance'].map((field) => ({
        $lte: [{ $convert: { input: { $ifNull: ['$' + field, 0] }, to: 'double', onError: 1 } }, 0],
      })),
    },
  };
}
function tableOccupancy() {
  return { ...floorEligibility(), $nor: [settledDineIn()] };
}
module.exports = { floorEligibility, tableOccupancy, settledDineIn };
