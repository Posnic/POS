'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { plan } = require('./captain-transfer-plan');
const { project } = require('./captain-transfer-projection');
const restructure = require('./captain-restructure-lock');
const Money = require('../utils/currency');
const seating = require('./seating-claims');
const { createHash } = require('node:crypto');
const { BSON } = require('mongodb');
const { isDeepStrictEqual } = require('node:util');
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
// Irreversible preparation for the eventual two-sale writer. Once applying,
// cancellation is forbidden: a lost bind acknowledgement must recover the same
// destination, not free seats which a delayed sale could still occupy.
async function beginCommit(req) {
  let prepared = await reserve(req);
  const c = await scope(req);
  let { journal } = prepared;
  if (journal.stage === 'reserved') {
    prepared = await prepareDestination(req);
    journal = await restructure.applying(req.db, c, journal.requestId, journal.actor);
  }
  if (journal.stage !== 'applying') fail('Reconcile this transfer before continuing.', 409);
  const claim = await seating.find(req.db, c, destinationId(journal._id));
  const target = journal.intent.destination;
  if (!claim || claim.actor !== journal.actor || claim.payload_hash !== journal.signature ||
      !['reserved', 'submitting'].includes(claim.state) || claim.primary !== target.primaryId ||
      claim.guests !== target.guests || JSON.stringify(claim.tables) !== JSON.stringify(target.tableIds))
    fail('The destination seating changed. Reconcile this transfer.', 409);
  if (!journal.destination_number) {
    const number = await require('../repositories/sale.repository').generateSalesIdForBranch(c.branchId,
      { numberingContext: { db: req.db, license: c.license } });
    await req.db.collection('captain_payment_plans').updateOne({ _id: journal._id,
      branch_id: c.branchId, license: c.license, stage: 'applying', destination_number: { $exists: false },
    }, { $set: { destination_number: number } });
    // A concurrent retry may have won the CAS. Always return the durable winner.
    journal = await restructure.read(req.db, c, journal.requestId, journal.actor);
  }
  if (!journal.destination_number || journal.stage !== 'applying')
    fail('Reconcile this transfer before continuing.', 409);
  const identity = { sales_id: journal.destination_number, invoice_number: journal.destination_number,
    sale_no: journal.destination_number, captain_payment_plan: journal._id };
  const existing = await seating.prepareOrder(req.db, c, claim, identity);
  if (existing && (existing.captain_payment_plan !== journal._id || existing.sales_id !== journal.destination_number))
    fail('The destination sale changed. Reconcile this transfer.', 409);
  // No sale is inserted here. The commit must write and verify both projections
  // before releasing these fences, including full-source seating closure.
  return { ...prepared, journal, claim, identity, existing };
}
// Both records remain fenced until the later seating/finalization stage. Raw
// writes intentionally avoid ordinary order-entry stock, print and voice effects.
async function applySales(req) {
  const prepared = await beginCommit(req), c = await scope(req);
  const { journal, projection, identity } = prepared, original = journal.sales[0];
  const metadata = {};
  for (const key of ['branch_name', 'customer_id', 'customer_name', 'customer_phone', 'customer_email'])
    if (original[key] !== undefined) metadata[key] = original[key];
  const event = side => ({ id: journal._id, side, at: journal.createdAt, actor: journal.actor,
    other_order_id: String(side === 'source' ? identity._id : original._id) });
  const document = { ...metadata, ...projection.destination, ...identity,
    branch: c.branchId, branch_id: c.branchId, license: c.license,
    ...require('../utils/sales-channels').describeSale({ channel: 'tableside', fulfilment: 'dine_in' }),
    sale_process: 'KOT', payment_status: 'Unpaid', payment_mode: '', dine_type: 'Dine-in',
    person_count: journal.intent.destination.guests, kitchen_required: true, floor_lifecycle: true,
    date: journal.createdAt, created_date: journal.createdAt, updated_date: journal.createdAt,
    captain_transfer_operations: [event('destination')] };
  const collection = req.db.collection('sales');
  // Deterministic _id is the insertion fence. Never replace an existing record.
  await collection.updateOne({ _id: identity._id }, { $setOnInsert: document }, { upsert: true });
  const same = (left, right) => isDeepStrictEqual(
    BSON.deserialize(BSON.serialize({ value: left }, { ignoreUndefined: false })),
    BSON.deserialize(BSON.serialize({ value: right }, { ignoreUndefined: false })));
  async function verify(id, expected, side) {
    const saved = await collection.findOne({ _id: id, branch_id: c.branchId, license: c.license,
      captain_payment_plan: journal._id, captain_transfer_operations: { $elemMatch: event(side) } });
    if (!saved || Object.entries(expected).some(([key, value]) => !same(saved[key], value)))
      fail('The transfer records changed. Reconcile this transfer.', 409);
    return saved;
  }
  const destination = await verify(identity._id, document, 'destination');
  const originalFields = Object.fromEntries(Object.keys(projection.source).map(key =>
    [key, original[key] === undefined ? { $exists: false } : original[key]]));
  await collection.updateOne({ _id: original._id, branch_id: c.branchId, license: c.license,
    ...originalFields,
    captain_payment_plan: journal._id, 'captain_transfer_operations.id': { $ne: journal._id },
  }, { $set: { ...projection.source, updated_date: journal.createdAt },
    $push: { captain_transfer_operations: event('source') } });
  const source = await verify(original._id, projection.source, 'source');
  return { ...prepared, source, destination };
}
async function complete(req) {
  const prepared = await reserve(req), c = await scope(req), { journal } = prepared;
  if (journal.stage === 'completed') {
    if (!journal.result) fail('Reconcile this transfer before continuing.', 409);
    await restructure.complete(req.db, c, journal.requestId, journal.actor);
    return journal.result;
  }
  const applied = await applySales(req);
  const sourceClosed = applied.projection.source.items.every(line => !line || line.return || line.cancelled ||
    ['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) ||
    !(Number(line.quantity ?? line.item_quantity ?? line.qty) > 0));
  if (sourceClosed) {
    const collection = req.db.collection('sales');
    await collection.updateOne({ _id: applied.source._id, branch_id: c.branchId, license: c.license,
      captain_payment_plan: journal._id,
      $or: [{ floor_closed_at: { $exists: false } }, { floor_closed_transfer_id: journal._id }],
    }, { $set: { floor_closed_at: journal.createdAt, floor_closed_by: journal.actor,
      floor_closed_transfer_id: journal._id } });
    if (!await collection.findOne({ _id: applied.source._id, branch_id: c.branchId, license: c.license,
      captain_payment_plan: journal._id, floor_closed_transfer_id: journal._id, floor_closed_at: journal.createdAt }))
      fail('Reconcile the transferred source before continuing.', 409);
    // Older checks have no seating claim to release. Closing just that check
    // removes it from floor occupancy without changing another guest's table.
    if (applied.source.seating_request_id)
      await seating.release(req.db, c, applied.source.seating_request_id, { transferId: journal._id });
  }
  const result = { requestId: journal.requestId, sourceId: String(applied.source._id),
    destinationId: String(applied.destination._id), sourceClosed, state: 'completed' };
  await req.db.collection('captain_payment_plans').updateOne({ _id: journal._id,
    branch_id: c.branchId, license: c.license, stage: 'applying',
  }, { $set: { result } });
  const recorded = await restructure.read(req.db, c, journal.requestId, journal.actor);
  if (!isDeepStrictEqual(recorded.result, result)) fail('Reconcile this transfer before continuing.', 409);
  await restructure.complete(req.db, c, journal.requestId, journal.actor);
  return result;
}
module.exports = { preview, reserve, prepareDestination, cancel, beginCommit, applySales, complete };
