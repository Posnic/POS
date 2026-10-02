'use strict';

// The cancelled sale is the durable outcome. Floor cleanup is retryable and
// must never turn a committed cancellation into a failed response.
async function finish(db, order) {
  if (!order.seating_request_id) return true;
  try {
    await require('./seating-claims').release(
      db,
      { branchId: order.branch_id, license: order.license },
      order.seating_request_id
    );
    return true;
  } catch (error) {
    console.warn('Cancelled order seating cleanup pending:', String(order._id), error.message);
    return false;
  }
}
module.exports = { finish };
