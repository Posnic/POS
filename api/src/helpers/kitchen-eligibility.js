'use strict';
// New KOTs track fulfilment independently of payment. Legacy paid receipts are
// deliberately not resurrected on upgrade; ordinary checkout is never enrolled.
function kitchenEligibility() {
  return {
    $or: [
      { kitchen_required: true, sale_process: { $in: ['KOT', 'Add', 'Edit'] } },
      {
        sale_process: { $regex: 'KOT', $options: 'i' },
        payment_status: { $nin: ['Paid', 'Cancelled'] },
      },
    ],
    payment_status: { $ne: 'Cancelled' },
    order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
  };
}
module.exports = { kitchenEligibility };
