'use strict';
const { context, allowed, fail } = require('../utils/branch-access');
const seating = require('./seating-claims');
const { ObjectId } = require('mongodb');
async function scope(req) {
  if (!req.user?._id || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  return context(req);
}
const view = (claim) => ({
  request_id: claim.id,
  state: claim.state,
  orderId: claim.order_id,
  tableIds: claim.tables,
  primaryId: claim.primary,
  guests: claim.guests,
});
async function prepare(req) {
  const c = await scope(req),
    body = req.body || {};
  return view(
    await seating.prepareMove(
      req.db,
      c,
      body.orderId,
      {
        request_id: body.request_id,
        table_ids: body.tableIds,
        primary_id: body.primaryId,
        guests: body.guests,
        actor: String(req.user._id),
      },
      { staffHandover: true }
    )
  );
}
async function complete(req) {
  const c = await scope(req);
  const claim = await seating.completeMove(req.db, c, req.body?.request_id, String(req.user._id));
  try {
    require('../sync/outbox').enqueue({
      collection: 'sales',
      documentId: new ObjectId(claim.order_id),
      reason: 'sale',
    });
  } catch {
    /* Periodic sync discovers the updated order. */
  }
  return view(claim);
}
async function cancel(req) {
  const c = await scope(req);
  await seating.cancelMove(
    req.db,
    c,
    req.body?.request_id,
    String(req.user._id),
    req.body?.orderId,
    { staffHandover: true }
  );
  return { request_id: req.body.request_id, state: 'cancelled' };
}
module.exports = { prepare, complete, cancel };
