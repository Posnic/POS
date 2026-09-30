'use strict';
const crypto = require('crypto');
const seating = require('./seating-claims');
const fingerprint = require('../utils/order-request-fingerprint');
const { fail } = require('../utils/branch-access');
const key = (value) =>
  'desktop-' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 40);
async function lookup(db, scope, input) {
  if (!input.actor || typeof input.request_id !== 'string' || !input.request_id.trim())
    fail('An order request ID and staff identity are required.');
  const claim = await seating.find(db, scope, key(input.request_id));
  if (!claim) return null;
  if (claim.actor !== String(input.actor)) fail('Permission is required.', 403);
  if (claim.payload_hash && claim.payload_hash !== fingerprint(input.payload))
    fail(
      'This request belongs to a different order. Resolve the previous submission before sending changes.',
      409
    );
  if (!claim.order_id) return null;
  return db.collection('sales').findOne({
    _id: new (require('mongodb').ObjectId)(claim.order_id),
    branch_id: scope.branchId,
    license: scope.license,
    seating_request_id: claim.id,
  });
}
async function prepare(db, scope, input, document) {
  if (!input.actor || !input.request_id)
    fail('An order request ID and staff identity are required.');
  const table = await db.collection('tableorder').findOne({
    branch_id: scope.branchId,
    license: scope.license,
    tableorder_value: String(document.table_number || '').trim(),
  });
  if (!table) return null;
  const id =
    'desktop-' +
    crypto.createHash('sha256').update(String(input.request_id)).digest('hex').slice(0, 40);
  const claim = await seating.reserve(db, scope, {
    request_id: id,
    payload_hash: fingerprint(input.payload),
    actor: String(input.actor),
    table_ids: [String(table._id)],
    primary_id: String(table._id),
    guests: Number(document.person_count) || 1,
  });
  const existing = await seating.prepareOrder(db, scope, claim, document);
  document.floor_lifecycle = true;
  return { claim, existing };
}
async function guardEdit(db, scope, doc, next) {
  await seating.forEdit(db, scope, doc, {
    table: next.table_number,
    guests: next.person_count,
    dine_type: next.dine_type,
  });
  // Mongoose merges these conditions into the atomic save filter.
  doc.$where = {
    ...(doc.$where || {}),
    seating_request_id: doc.seating_request_id || { $exists: false },
    ...(doc.updated_date !== undefined ? { updated_date: doc.updated_date } : {}),
  };
}
module.exports = { prepare, lookup, guardEdit };
