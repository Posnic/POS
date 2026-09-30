'use strict';
const { ObjectId } = require('mongodb');
const { fail } = require('../utils/branch-access');
const details = require('../utils/table-details');

// All order-entry paths must use these claims before combined seating is exposed.
// One branch document makes a multi-table claim atomic on standalone MongoDB too.
// Claims do not expire silently: an interrupted submission must be reconciled or
// cancelled explicitly, otherwise a delayed sale could seat the same table twice.
const store = (db) => db.collection('table_seating');
function scopeKey(scope) {
  return `${String(scope.license)}:${String(scope.branchId)}`;
}
function identity(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail('Choose a table.');
  return value.toLowerCase();
}
function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value))
    fail('A seating request ID is required.');
  return value;
}
function sameRequest(saved, input) {
  return (
    saved.actor === input.actor &&
    saved.primary === input.primary &&
    saved.guests === input.guests &&
    JSON.stringify(saved.tables) === JSON.stringify(input.tables)
  );
}
async function read(db, scope) {
  const state = await store(db).findOne({ _id: scopeKey(scope) });
  return state?.claims || [];
}
async function reserve(db, scope, input) {
  const id = requestId(input.request_id);
  if (!Array.isArray(input.table_ids) || !input.table_ids.length || input.table_ids.length > 20)
    fail('Choose up to 20 tables.');
  const ids = [...new Set(input.table_ids.map(identity))].sort();
  const primary = identity(input.primary_id);
  const actor = String(input.actor || '');
  if (!actor || !ids.includes(primary)) fail('Choose a primary table.');
  if (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > 1000)
    fail('Enter the number of guests.');
  const claim = {
    id,
    tables: ids,
    primary,
    actor,
    guests: input.guests,
    state: 'reserved',
    at: new Date(),
  };
  const previous = (await read(db, scope)).find((row) => row.id === id);
  if (previous) {
    if (previous.state === 'cancelled' || !sameRequest(previous, claim))
      fail('This seating request has already been used.', 409);
    return previous;
  }
  const tables = await db
    .collection('tableorder')
    .find({
      branch_id: scope.branchId,
      license: scope.license,
      _id: { $in: ids.map((value) => new ObjectId(value)) },
    })
    .toArray();
  if (tables.length !== ids.length) fail('Choose tables from this branch.');
  if (
    tables.some(
      (row) =>
        ['held', 'cleaning'].includes(row.service_state) ||
        (row.floor_close && !row.floor_close.completed)
    )
  )
    fail('This table is not available.', 409);
  // A connected chain is sufficient; tables need not all touch each other.
  // An edge configured from either end represents the same physical adjacency.
  const reached = new Set([primary]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of tables) {
      const own = String(row._id);
      for (const neighbour of row.adjacent_table_ids || []) {
        const other = String(neighbour);
        if (ids.includes(other) && (reached.has(own) || reached.has(other))) {
          if (!reached.has(own) || !reached.has(other)) changed = true;
          reached.add(own);
          reached.add(other);
        }
      }
    }
  }
  if (reached.size !== ids.length) fail('Only neighbouring tables can be combined.');
  const metadata = tables.map(details.view);
  // A combined party needs known capacity; unknown capacity must not be treated
  // as unlimited when summing seats from several tables.
  if (ids.length > 1 && metadata.some((row) => !row.capacity || !row.max_capacity))
    fail('Set the seating capacity before combining tables.');
  const capacity = metadata.reduce((sum, row) => sum + row.capacity, 0);
  const maximum = metadata.reduce((sum, row) => sum + row.max_capacity, 0);
  if (maximum && input.guests > maximum) fail('Choose a table with enough seats.');
  const open = await db.collection('sales').countDocuments({
    branch_id: scope.branchId,
    license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
    table_number: { $in: tables.map((row) => row.tableorder_value) },
  });
  if (open) fail('This table has an open order.', 409);
  claim.capacity = capacity;
  claim.max_capacity = maximum;
  claim.labels = ids.map((id) => tables.find((row) => String(row._id) === id).tableorder_value);
  const key = scopeKey(scope);
  try {
    await store(db).updateOne(
      { _id: key },
      { $setOnInsert: { branch_id: scope.branchId, license: scope.license, claims: [] } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const result = await store(db).updateOne(
    {
      _id: key,
      'claims.id': { $ne: id },
      claims: { $not: { $elemMatch: { tables: { $in: ids }, state: { $ne: 'cancelled' } } } },
    },
    { $push: { claims: claim } }
  );
  if (!result.matchedCount) {
    const saved = (await read(db, scope)).find((row) => row.id === id);
    if (saved && saved.state !== 'cancelled' && sameRequest(saved, claim)) return saved;
    fail('Table changed. Refresh and try again.', 409);
  }
  return claim;
}
async function bind(db, scope, id, actor, orderId) {
  requestId(id);
  const sale = identity(orderId);
  const result = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: { $elemMatch: { id, actor: String(actor), state: 'reserved' } },
    },
    { $set: { 'claims.$.state': 'submitting', 'claims.$.order_id': sale } }
  );
  if (result.matchedCount) return;
  const existing = (await read(db, scope)).find((row) => row.id === id);
  if (
    existing?.actor === String(actor) &&
    existing.order_id === sale &&
    existing.state === 'submitting'
  )
    return;
  fail('Table changed. Refresh and try again.', 409);
}
async function cancel(db, scope, id, actor) {
  requestId(id);
  const claims = await read(db, scope),
    saved = claims.find((row) => row.id === id);
  if (!saved) return;
  if (saved.actor !== String(actor)) fail('Permission is required.', 403);
  if (saved.state === 'cancelled') return;
  if (saved.state !== 'reserved')
    fail('Reconcile the submitted order before releasing its tables.', 409);
  // The element match is checked again at the write, so a simultaneous bind
  // cannot be erased by a cancellation based on an earlier read.
  await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: { $elemMatch: { id, actor: String(actor), state: 'reserved' } },
    },
    { $set: { 'claims.$.state': 'cancelled' } }
  );
  const remaining = (await read(db, scope)).find((row) => row.id === id);
  if (remaining && remaining.state !== 'cancelled')
    fail('Reconcile the submitted order before releasing its tables.', 409);
}
module.exports = { reserve, bind, cancel, read };
