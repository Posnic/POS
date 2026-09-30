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
  dineType: claim.dine_type || 'Dine-in',
  ...(claim.merge_target ? { mergeTargetId: claim.merge_target } : {}),
});
async function prepare(req, mergeTargetId = null) {
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
        dine_type: body.dineType,
        actor: String(req.user._id),
      },
      { staffHandover: true, mergeTargetId }
    )
  );
}
async function merge(req) {
  if (!req.user || !allowed(req.user, 'sales', 'merge')) fail('Permission is required.', 403);
  if (!/^[a-f0-9]{24}$/i.test(req.body?.targetOrderId || '')) fail('Choose an order.');
  return prepare(req, req.body.targetOrderId);
}
async function complete(req) {
  const c = await scope(req);
  const pending = await seating.find(req.db, c, req.body?.request_id);
  if (pending?.merge_target && !allowed(req.user, 'sales', 'merge')) fail('Permission is required.', 403);
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
module.exports = { prepare, merge, complete, cancel };
