'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { plan } = require('./captain-transfer-plan');
const { project } = require('./captain-transfer-projection');
const restructure = require('./captain-restructure-lock');
const Money = require('../utils/currency');
const seating = require('./seating-claims');
const { createHash } = require('node:crypto');
const destinationId = id => 'transfer-' + createHash('sha256').update(id).digest('hex').slice(0, 40);
function destination(value) {
  if (!value || !Array.isArray(value.tableIds) || !value.tableIds.length || value.tableIds.length > 20 ||
      value.tableIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) ||
      typeof value.primaryId !== 'string' || !Number.isInteger(value.guests) || value.guests < 1 || value.guests > 1000)
    fail('Choose destination tables and the number of guests.');
  const tableIds = value.tableIds.map(id => id.toLowerCase()).sort(), primaryId = value.primaryId.toLowerCase();
  if (new Set(tableIds).size !== tableIds.length || !tableIds.includes(primaryId))
    fail('Choose a primary destination table.');
  return { tableIds, primaryId, guests: value.guests };
}

async function scope(req) {
  if (!req.user?._id || !allowed(req.user, 'sales') || !allowed(req.user, 'sales', 'merge'))
    fail('Permission is required.', 403);
  const body = req.body || {};
  if (typeof body.orderId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.orderId))
    fail('Choose an order.');
  return context(req);
}
async function available(req, c) {
  const sale = await req.db.collection('sales').findOne({
    _id: new ObjectId(req.body.orderId), branch_id: c.branchId, license: c.license,
    sale_process: 'KOT', payment_status: 'Unpaid',
    floor_closed_at: { $exists: false }, captain_payment_plan: { $exists: false },
    order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
    $or: [{ captain_edit_until: { $exists: false } }, { captain_edit_until: { $lt: new Date() } }],
  });
  if (!sale) fail('Order changed. Refresh before transferring items.', 409);
  return sale;
}
// A preview never reserves a table, updates stock, prints a ticket or writes a
// sale. Commit must re-read/fence the order and compare this revision.
async function preview(req) {
  const c = await scope(req), sale = await available(req, c), body = req.body;
  return plan(sale, c.branch, body.items);
}

// Internal preparation for the durable writer; deliberately has no HTTP route
// until destination seating, commit/recovery and edit reconciliation are ready.
// Retry reads the original fenced sale and currency, never today's live bill.
async function reserve(req) {
  const c = await scope(req), body = req.body, actor = String(req.user._id);
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId) ||
      typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision) ||
      !Array.isArray(body.items) || !body.items.length || body.items.length > 200)
    fail('Refresh the transfer preview before continuing.', 409);
  const items = body.items.map(row => {
    if (!row || typeof row.id !== 'string' || typeof row.quantity !== 'number' ||
        !Number.isFinite(row.quantity) ||
        (row.servedQuantity !== undefined && (typeof row.servedQuantity !== 'number' || !Number.isFinite(row.servedQuantity))))
      fail('Choose items to transfer.');
    return { id: row.id, quantity: row.quantity,
      ...(row.servedQuantity !== undefined ? { servedQuantity: row.servedQuantity } : {}) };
  });
  const intent = { kind: 'transfer', orderId: body.orderId.toLowerCase(), revision: body.revision, items,
    destination: destination(body.destination) };
  let journal = await restructure.read(req.db, c, body.requestId, actor, { optional: true });
  if (journal) {
    if (JSON.stringify(journal.intent) !== JSON.stringify({ ...intent, currency: journal.intent.currency }) || journal.stage === 'cancelled')
      fail('This transfer request has already been used.', 409);
  } else {
    const sale = await available(req, c);
    const currency = Money.policy(c.branch);
    // Validate the complete projection before acquiring any durable fence.
    const projection = project(sale, currency, items, new Date());
    if (projection.preview.revision !== body.revision)
      fail('Order changed. Refresh before transferring items.', 409);
    journal = await restructure.reserve(req.db, c, { requestId: body.requestId, actor,
      intent: { ...intent, currency }, sales: [sale] });
  }
  if (journal.stage === 'reserving')
    journal = await restructure.reserve(req.db, c, { requestId: body.requestId, actor,
      intent: journal.intent, sales: journal.sales });
  return { journal, projection: project(journal.sales[0], journal.intent.currency, journal.intent.items, journal.createdAt) };
}
async function prepareDestination(req) {
  const prepared = await reserve(req), c = await scope(req), { journal } = prepared;
  if (journal.stage !== 'reserved') fail('Reconcile this transfer before continuing.', 409);
  const target = journal.intent.destination;
  const claim = await seating.reserve(req.db, c, { request_id: destinationId(journal._id),
    actor: journal.actor, table_ids: target.tableIds, primary_id: target.primaryId, guests: target.guests,
    payload_hash: journal.signature });
  // Cancellation may win while the seating CAS is in flight. Its journal is a
  // durable tombstone; a late claim is cleaned here or by another cancel retry.
  const current = await restructure.read(req.db, c, journal.requestId, journal.actor);
  if (current.stage === 'cancelled') {
    await seating.cancel(req.db, c, claim.id, journal.actor);
    fail('This transfer was cancelled.', 409);
  }
  if (current.stage !== 'reserved') fail('Reconcile this transfer before continuing.', 409);
  return { ...prepared, claim };
}
async function cancel(req) {
  const c = await scope(req), body = req.body, actor = String(req.user._id);
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId))
    fail('A transfer request ID is required.');
  const journal = await restructure.read(req.db, c, body.requestId, actor);
  if (journal.intent.kind !== 'transfer' || journal.intent.orderId !== body.orderId.toLowerCase())
    fail('This transfer request has already been used.', 409);
  const result = await restructure.cancel(req.db, c, body.requestId, actor);
  await seating.cancel(req.db, c, destinationId(journal._id), actor);
  return result;
}
module.exports = { preview, reserve, prepareDestination, cancel };
