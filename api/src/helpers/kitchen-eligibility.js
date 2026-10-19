'use strict';
// New KOTs track fulfilment independently of payment. Legacy paid receipts are
// deliberately not resurrected on upgrade; ordinary checkout is never enrolled.
function kitchenEligibility({ excludeClosed = false } = {}) {
  return {
    ...(excludeClosed
      ? {
          floor_closed_at: { $exists: false },
          kitchen_closed: { $ne: true },
          // Old edited counter receipts can retain kitchen_required and KOT
          // history after losing their service assignment. That flag alone
          // must not resurrect them. Keep actual KOTs and enrolled service work.
          $nor: [
            {
              sale_process: { $in: ['Add', 'Edit'] },
              floor_lifecycle: { $ne: true },
              table_number: { $in: ['', null] },
              dine_type: { $in: ['', null] },
              fulfilment: { $in: ['', null] },
            },
          ],
        }
      : {}),
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
