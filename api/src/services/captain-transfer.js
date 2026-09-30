'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { plan } = require('./captain-transfer-plan');

// A preview never reserves a table, updates stock, prints a ticket or writes a
// sale. Commit must re-read/fence the order and compare this revision.
async function preview(req) {
  if (!req.user?._id || !allowed(req.user, 'sales') || !allowed(req.user, 'sales', 'merge'))
    fail('Permission is required.', 403);
  const body = req.body || {};
  if (typeof body.orderId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.orderId))
    fail('Choose an order.');
  const c = await context(req);
  const sale = await req.db.collection('sales').findOne({
    _id: new ObjectId(body.orderId), branch_id: c.branchId, license: c.license,
    sale_process: 'KOT', payment_status: 'Unpaid',
    floor_closed_at: { $exists: false }, captain_payment_plan: { $exists: false },
    order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
    $or: [{ captain_edit_until: { $exists: false } }, { captain_edit_until: { $lt: new Date() } }],
  });
  if (!sale) fail('Order changed. Refresh before transferring items.', 409);
  return plan(sale, c.branch, body.items);
}
module.exports = { preview };
