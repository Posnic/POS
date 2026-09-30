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
module.exports = { floorEligibility };
