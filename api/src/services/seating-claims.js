'use strict';
const { ObjectId } = require('mongodb');
const { fail } = require('../utils/branch-access');
const details = require('../utils/table-details');

// All order-entry paths must use these claims before combined seating is exposed.
// One branch document makes a multi-table claim atomic on standalone MongoDB too.
// Claims do not expire silently: an interrupted submission must be reconciled or
// cancelled explicitly, otherwise a delayed sale could seat the same table twice.
const store = (db) => db.collection('table_seating');
const history = (db) => db.collection('table_seating_history');
const terminal = (claim) => ['cancelled', 'released'].includes(claim.state);
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
    (saved.dine_type || 'Dine-in') === (input.dine_type || 'Dine-in') &&
    (saved.payload_hash || null) === (input.payload_hash || null) &&
    (saved.move_from || null) === (input.move_from || null) &&
    JSON.stringify(saved.tables) === JSON.stringify(input.tables)
  );
}
async function read(db, scope) {
  const state = await store(db).findOne({ _id: scopeKey(scope) });
  return state?.claims || [];
}
async function find(db, scope, id) {
  return (
    (await read(db, scope)).find((row) => row.id === id) ||
    (await history(db).findOne({ _id: `${scopeKey(scope)}:${id}` }))?.claim ||
    null
  );
}
async function archive(db, scope, id) {
  const claim = (await read(db, scope)).find((row) => row.id === id);
  if (!claim || !terminal(claim)) return;
  // Persist the retry tombstone first. Revision guards prevent a reservation
  // which read before this archive from recreating the same request afterward.
  await history(db).updateOne(
    { _id: `${scopeKey(scope)}:${id}` },
    {
      $setOnInsert: { branch_id: scope.branchId, license: scope.license, claim },
    },
    { upsert: true }
  );
  await store(db).updateOne(
    { _id: scopeKey(scope) },
    {
      $pull: { claims: { id, state: { $in: ['cancelled', 'released'] } } },
      $inc: { revision: 1 },
    }
  );
}
async function reserve(db, scope, input) {
  return reserveClaim(db, scope, input);
}
async function reserveClaim(db, scope, input, moving = null) {
  const id = requestId(input.request_id);
  const takeaway = moving && input.dine_type === 'Take away';
  if (input.dine_type && !['Dine-in', 'Take away'].includes(input.dine_type)) fail('Choose an order type.');
  if (!Array.isArray(input.table_ids) || input.table_ids.length > 20 ||
      (takeaway ? input.table_ids.length !== 0 : !input.table_ids.length))
    fail('Choose up to 20 tables.');
  const ids = [...new Set(input.table_ids.map(identity))].sort();
  const primary = takeaway ? '' : identity(input.primary_id);
  const actor = String(input.actor || '');
  if (!actor || (!takeaway && !ids.includes(primary))) fail('Choose a primary table.');
  if (!Number.isInteger(input.guests) || (takeaway ? input.guests !== 0 : input.guests < 1 || input.guests > 1000))
    fail('Enter the number of guests.');
  const claim = {
    id,
    tables: ids,
    primary,
    actor,
    guests: input.guests,
    dine_type: takeaway ? 'Take away' : 'Dine-in',
    state: 'reserved',
    ...(moving ? { move_from: moving.id, order_id: moving.order_id } : {}),
    ...(input.payload_hash ? { payload_hash: input.payload_hash } : {}),
    at: new Date(),
  };
  const previous = await find(db, scope, id);
  if (previous) {
    if (terminal(previous) || !sameRequest(previous, claim))
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
  const reached = new Set(takeaway ? [] : [primary]);
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
  claim.capacity = capacity;
  claim.max_capacity = maximum;
  claim.labels = ids.map((id) => tables.find((row) => String(row._id) === id).tableorder_value);
  const key = scopeKey(scope);
  try {
    await store(db).updateOne(
      { _id: key },
      {
        $setOnInsert: {
          branch_id: scope.branchId,
          license: scope.license,
          claims: [],
          revision: 0,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const snapshot = await store(db).findOne({ _id: key });
  const concurrent = snapshot.claims.find((row) => row.id === id);
  if (concurrent) {
    if (terminal(concurrent) || !sameRequest(concurrent, claim))
      fail('This seating request has already been used.', 409);
    return concurrent;
  }
  if (
    moving &&
    !snapshot.claims.some(
      (row) =>
        row.id === moving.id &&
        row.order_id === moving.order_id &&
        row.state === 'submitting' &&
        !row.moving_to &&
        !row.closing
    )
  )
    fail('The seating group changed. Refresh this order.', 409);
  const overlaps = snapshot.claims.filter(
    (row) =>
      !terminal(row) && row.id !== moving?.id && row.tables.some((table) => ids.includes(table))
  );
  if (overlaps.some(row => row.moving_to || row.closing || ['applying', 'releasing'].includes(row.state) || (row.move_from && row.state === 'reserved')))
    fail('Table changed. Refresh and try again.', 409);
  if (overlaps.some((row) => ids.length > 1 || row.tables.length > 1))
    fail('Table changed. Refresh and try again.', 409);
  const open = await db
    .collection('sales')
    .find(
      {
        branch_id: scope.branchId,
        license: scope.license,
        ...require('../helpers/floor-eligibility').floorEligibility(),
        table_number: { $in: tables.map((row) => row.tableorder_value) },
        ...(moving ? { _id: { $ne: new ObjectId(moving.order_id) } } : {}),
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  if (ids.length > 1 && open.length) fail('This table has an open order.', 409);
  if (ids.length === 1) {
    const branch = await db
      .collection('branches')
      .findOne(
        { _id: scope.branchId, license: scope.license },
        { projection: { table_order_limit: 1 } }
      );
    const configured = Number(branch?.table_order_limit ?? 1);
    const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : 1;
    // A bound claim and its committed sale are one order, not two. A pending
    // claim counts too, before its sale exists, so simultaneous staff cannot
    // exceed the configured limit by submitting during that gap.
    const count = new Set([
      ...open.map((order) => `sale:${String(order._id)}`),
      ...overlaps.map((row) => (row.order_id ? `sale:${row.order_id}` : `claim:${row.id}`)),
    ]).size;
    if (limit && count >= limit) fail('This table has reached its open order limit.', 409);
  }
  if (await history(db).findOne({ _id: `${key}:${id}` }))
    fail('This seating request has already been used.', 409);
  claim.generation = (snapshot.revision || 0) + 1;
  const result = await store(db).updateOne(
    {
      _id: key,
      revision: snapshot.revision === undefined ? { $exists: false } : snapshot.revision,
      'claims.id': { $ne: id },
    },
    moving
      ? {
          $set: {
            claims: [
              ...snapshot.claims.map((row) =>
                row.id === moving.id ? { ...row, moving_to: id } : row
              ),
              claim,
            ],
          },
          $inc: { revision: 1 },
        }
      : { $push: { claims: claim }, $inc: { revision: 1 } }
  );
  if (!result.matchedCount) {
    const saved = (await read(db, scope)).find((row) => row.id === id);
    if (saved && !terminal(saved) && sameRequest(saved, claim)) return saved;
    fail('Table changed. Refresh and try again.', 409);
  }
  return claim;
}
async function prepareMove(db, scope, orderId, input, { staffHandover = false } = {}) {
  const id = requestId(input.request_id);
  const takeaway = input.dine_type === 'Take away';
  if (input.dine_type && !['Dine-in', 'Take away'].includes(input.dine_type)) fail('Choose an order type.');
  if (!Array.isArray(input.table_ids) || input.table_ids.length > 20 ||
      (takeaway ? input.table_ids.length !== 0 : !input.table_ids.length))
    fail('Choose up to 20 tables.');
  const expected = {
    actor: String(input.actor || ''),
    primary: takeaway ? '' : identity(input.primary_id),
    tables: [...new Set(input.table_ids.map(identity))].sort(),
    guests: input.guests,
    dine_type: takeaway ? 'Take away' : 'Dine-in',
    ...(input.payload_hash ? { payload_hash: input.payload_hash } : {}),
  };
  const order = await db.collection('sales').findOne({
    _id: new ObjectId(identity(orderId)),
    branch_id: scope.branchId,
    license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
  });
  if (!order?.seating_request_id) fail('Refresh this order before changing its seating.', 409);
  const previous = await find(db, scope, id);
  if (previous) {
    if (
      !previous.move_from ||
      terminal(previous) ||
      previous.order_id !== String(order._id) ||
      !sameRequest(previous, { ...expected, move_from: previous.move_from }) ||
      ![previous.id, previous.move_from].includes(order.seating_request_id) ||
      (previous.state === 'submitting' && order.seating_request_id !== previous.id)
    )
      fail('This seating request has already been used.', 409);
    return previous;
  }

  const source = await find(db, scope, order.seating_request_id);
  if (!source || source.state !== 'submitting' || source.order_id !== String(order._id))
    fail('The seating group changed. Refresh this order.', 409);
  if (!staffHandover && String(input.actor || '') !== source.actor)
    fail('Permission is required.', 403);
  return reserveClaim(db, scope, input, source);
}

async function beginClose(db, scope, orderIds, closeId) {
  requestId(closeId);
  if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 200)
    fail('Choose the orders to close.');
  const ids = [...new Set(orderIds.map(identity))].sort();
  const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
  if (!snapshot) return;
  const selected = snapshot.claims.filter((row) => !terminal(row) && ids.includes(row.order_id));
  if (
    selected.some(
      (row) =>
        row.moving_to ||
        !['submitting', 'releasing'].includes(row.state) ||
        (row.closing &&
          (row.closing.id !== closeId ||
            JSON.stringify(row.closing.orders) !== JSON.stringify(ids)))
    )
  )
    fail('The seating group changed. Refresh this order.', 409);
  if (!selected.length || selected.every((row) => row.closing?.id === closeId)) return;
  const selectedIds = new Set(selected.map((row) => row.id));
  const result = await store(db).updateOne(
    { _id: scopeKey(scope), revision: snapshot.revision },
    {
      $set: {
        claims: snapshot.claims.map((row) =>
          selectedIds.has(row.id) ? { ...row, closing: { id: closeId, orders: ids } } : row
        ),
      },
      $inc: { revision: 1 },
    }
  );
  if (!result.matchedCount) fail('The seating group changed. Refresh this order.', 409);
}

async function cancelMove(db, scope, id, actor, orderId, { staffHandover = false } = {}) {
  requestId(id);
  let saved = await find(db, scope, id);
  if (!saved && orderId) {
    const order = await db.collection('sales').findOne({
      _id: new ObjectId(identity(orderId)),
      branch_id: scope.branchId,
      license: scope.license,
    });
    const source = order?.seating_request_id && (await find(db, scope, order.seating_request_id));
    if (
      !source ||
      (!staffHandover && source.actor !== String(actor)) ||
      source.order_id !== String(order._id)
    )
      fail('Permission is required.', 403);
    const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
    saved = snapshot?.claims.find((row) => row.id === id) || (await find(db, scope, id));
    if (!saved) {
      const tombstone = {
        id,
        actor: String(actor),
        order_id: String(order._id),
        move_from: source.id,
        tables: [],
        state: 'cancelled',
        at: new Date(),
      };
      const result = await store(db).updateOne(
        { _id: scopeKey(scope), revision: snapshot.revision, 'claims.id': { $ne: id } },
        { $push: { claims: tombstone }, $inc: { revision: 1 } }
      );
      if (!result.matchedCount) fail('The seating group changed. Refresh this order.', 409);
      await archive(db, scope, id);
      return;
    }
  }
  if (!saved?.move_from || saved.actor !== String(actor)) fail('Permission is required.', 403);
  if (saved.state === 'cancelled') return;
  if (saved.state !== 'reserved') fail('Reconcile the table move before cancelling it.', 409);
  const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
  const source = snapshot?.claims.find((row) => row.id === saved.move_from);
  if (source?.moving_to !== id) fail('The seating group changed. Refresh this order.', 409);
  const result = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      revision: snapshot.revision,
      claims: { $elemMatch: { id, state: 'reserved' } },
    },
    {
      $set: {
        claims: snapshot.claims.map((row) => {
          if (row.id === id) return { ...row, state: 'cancelled' };
          if (row.id === source.id) {
            const next = { ...row };
            delete next.moving_to;
            return next;
          }
          return row;
        }),
      },
      $inc: { revision: 1 },
    }
  );
  if (!result.matchedCount) fail('The seating group changed. Refresh this order.', 409);
  await archive(db, scope, id);
}

async function completeMove(db, scope, id, actor) {
  requestId(id);
  let move = await find(db, scope, id);
  if (!move?.move_from || move.actor !== String(actor)) fail('Permission is required.', 403);
  if (move.state === 'submitting') return move;
  if (!['reserved', 'applying'].includes(move.state))
    fail('This move is no longer available.', 409);
  if (move.state === 'reserved') {
    const claimed = await store(db).updateOne(
      { _id: scopeKey(scope), claims: { $elemMatch: { id, state: 'reserved' } } },
      { $set: { 'claims.$.state': 'applying' }, $inc: { revision: 1 } }
    );
    if (!claimed.matchedCount) {
      move = await find(db, scope, id);
      if (move?.state === 'submitting') return move;
      if (move?.state !== 'applying') fail('This move is no longer available.', 409);
    }
  }
  const selector = {
    _id: new ObjectId(move.order_id),
    branch_id: scope.branchId,
    license: scope.license,
  };
  const fields = {
    seating_request_id: id,
    seating_table_ids: move.tables,
    seating_primary_id: move.primary,
    table_id: move.primary,
    table_number: move.dine_type === 'Take away' ? '' : move.labels[move.tables.indexOf(move.primary)],
    dine_type: move.dine_type || 'Dine-in',
    person_count: move.guests,
    updated_date: new Date(),
  };
  const changed = await db.collection('sales').updateOne(
    {
      ...selector,
      seating_request_id: move.move_from,
      captain_payment_plan: { $exists: false },
      ...require('../helpers/floor-eligibility').floorEligibility(),
    },
    {
      $set: fields,
      $push: {
        captain_audit: {
          action: 'move',
          request_id: id,
          at: move.at,
          actor: { id: String(actor) },
          table: fields.table_number,
        },
      },
    }
  );
  if (!changed.matchedCount) {
    const latest = await db.collection('sales').findOne(selector);
    if (latest?.seating_request_id !== id) fail('Reconcile the table move before continuing.', 409);
  }
  const source = await find(db, scope, move.move_from);
  if (!source || source.moving_to !== id)
    fail('The seating group changed. Refresh this order.', 409);
  // A table may contain multiple checks. Moving one must not put the guests
  // still seated there into cleaning. Source/target transition claims also
  // prevent new seating between this occupancy read and the projection.
  const otherClaims = (await read(db, scope)).filter(row => !terminal(row) && row.id !== source.id && row.id !== id);
  const remainingOrders = await db.collection('sales').find({
    branch_id: scope.branchId, license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
    table_number: { $in: source.labels },
  }, { projection: { table_number: 1 } }).toArray();
  const released = source.tables.filter((table, index) => !move.tables.includes(table) &&
    !otherClaims.some(row => row.tables.includes(table)) &&
    !remainingOrders.some(order => String(order.table_number) === String(source.labels[index])));
  if (released.length)
    await db.collection('tableorder').updateMany(
      {
        branch_id: scope.branchId,
        license: scope.license,
        _id: { $in: released.map((value) => new ObjectId(value)) },
        $or: [
          { last_seating_release_generation: { $exists: false } },
          { last_seating_release_generation: { $lt: move.generation } },
        ],
      },
      {
        $set: { service_state: 'cleaning', last_seating_release_generation: move.generation },
        $inc: { captain_table_version: 1 },
      }
    );
  const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
  const current = snapshot.claims.find((row) => row.id === id);
  if (current?.state === 'submitting') return current;
  const finished = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      revision: snapshot.revision,
      claims: { $elemMatch: { id, state: 'applying' } },
    },
    {
      $set: {
        claims: snapshot.claims.map((row) =>
          row.id === id
            ? { ...row, state: 'submitting' }
            : row.id === source.id
              ? { ...row, state: 'released' }
              : row
        ),
      },
      $inc: { revision: 1 },
    }
  );
  if (!finished.matchedCount) fail('Retry this table move to finish updating the floor.', 409);
  await archive(db, scope, source.id);
  return find(db, scope, id);
}

async function bind(db, scope, id, actor, orderId) {
  requestId(id);
  const sale = identity(orderId);
  const result = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: {
        $elemMatch: { id, actor: String(actor), state: 'reserved', move_from: { $exists: false } },
      },
    },
    { $set: { 'claims.$.state': 'submitting', 'claims.$.order_id': sale }, $inc: { revision: 1 } }
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
  const saved = await find(db, scope, id);
  if (!saved) return;
  if (saved.actor !== String(actor)) fail('Permission is required.', 403);
  if (saved.move_from) fail('Reconcile the table move before releasing its tables.', 409);
  if (saved.state === 'cancelled') {
    await archive(db, scope, id);
    return;
  }
  if (saved.state !== 'reserved')
    fail('Reconcile the submitted order before releasing its tables.', 409);
  // The element match is checked again at the write, so a simultaneous bind
  // cannot be erased by a cancellation based on an earlier read.
  await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: { $elemMatch: { id, actor: String(actor), state: 'reserved' } },
    },
    { $set: { 'claims.$.state': 'cancelled' }, $inc: { revision: 1 } }
  );
  const remaining = (await read(db, scope)).find((row) => row.id === id);
  if (remaining && remaining.state !== 'cancelled')
    fail('Reconcile the submitted order before releasing its tables.', 409);
  await archive(db, scope, id);
}
async function release(db, scope, id) {
  requestId(id);
  const claim = await find(db, scope, id);
  if (!claim) fail('Seating request not found.', 404);
  if (claim.state === 'released') {
    await archive(db, scope, id);
    return;
  }
  if (claim.moving_to) fail('Reconcile the table move before releasing its tables.', 409);
  if (!['submitting', 'releasing'].includes(claim.state) || !claim.order_id)
    fail('Reconcile the submitted order before releasing its tables.', 409);
  const sale = await db.collection('sales').findOne({
    _id: new ObjectId(claim.order_id),
    branch_id: scope.branchId,
    license: scope.license,
  });
  if (!sale?.floor_closed_at) fail('Close the order before releasing its tables.', 409);
  const remainingOrders = await db.collection('sales').countDocuments({
    branch_id: scope.branchId,
    license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
    table_number: { $in: claim.labels },
  });
  const cancelled = String(sale.sale_process).toLowerCase() === 'cancelled';
  if (remainingOrders && !cancelled)
    fail('Close the remaining orders before releasing this table.', 409);
  const otherClaims =
    cancelled &&
    (await read(db, scope)).some(
      (other) =>
        other.id !== claim.id &&
        !terminal(other) &&
        other.tables.some((table) => claim.tables.includes(table))
    );
  const stillOccupied = cancelled && (remainingOrders > 0 || otherClaims);
  if (claim.state !== 'releasing') {
    const locked = await store(db).updateOne(
      {
        _id: scopeKey(scope),
        claims: { $elemMatch: { id, state: 'submitting', moving_to: { $exists: false } } },
      },
      { $set: { 'claims.$.state': 'releasing' }, $inc: { revision: 1 } }
    );
    if (!locked.matchedCount) {
      const latest = await find(db, scope, id);
      if (latest?.state === 'released') return;
      if (latest?.state !== 'releasing')
        fail('Reconcile the table move before releasing its tables.', 409);
    }
  }

  // The claim keeps all member tables unavailable while this projection runs.
  // Retrying after interruption repeats only the cleaning projection, never the
  // payment, item, kitchen or stock operations.
  if (!stillOccupied)
    await db.collection('tableorder').updateMany(
      {
        branch_id: scope.branchId,
        license: scope.license,
        _id: { $in: claim.tables.map((value) => new ObjectId(value)) },
        $or: [
          { last_seating_release_generation: { $exists: false } },
          { last_seating_release_generation: { $lt: claim.generation } },
        ],
      },
      {
        $set: {
          service_state: 'cleaning',
          last_seating_release_generation: claim.generation,
          updated_date: new Date(),
        },
        $inc: { captain_table_version: 1 },
      }
    );
  await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: {
        $elemMatch: {
          id,
          state: 'releasing',
          order_id: claim.order_id,
          moving_to: { $exists: false },
        },
      },
    },
    { $set: { 'claims.$.state': 'released' }, $inc: { revision: 1 } }
  );
  await archive(db, scope, id);
}
async function forOrder(db, scope, input) {
  const id = requestId(input.request_id);
  const claim = await find(db, scope, id);
  if (!claim || terminal(claim) || claim.move_from || claim.moving_to)
    fail('This seating request is no longer available.', 409);
  if (!input.actor || claim.actor !== String(input.actor)) fail('Permission is required.', 403);
  const primaryLabel = claim.labels[claim.tables.indexOf(claim.primary)];
  if (
    String(input.table || '').trim() !== primaryLabel ||
    (input.table_id && String(input.table_id) !== claim.primary) ||
    Number(input.guests) !== claim.guests
  )
    fail('The order does not match its seating request.', 409);
  return claim;
}
async function prepareOrder(db, scope, claim, document) {
  const orderId =
    claim.order_id ||
    require('crypto')
      .createHash('sha256')
      .update(`${scopeKey(scope)}:${claim.id}`)
      .digest('hex')
      .slice(0, 24);
  await bind(db, scope, claim.id, claim.actor, orderId);
  document._id = new ObjectId(orderId);
  document.seating_request_id = claim.id;
  document.seating_table_ids = claim.tables;
  document.seating_primary_id = claim.primary;
  document.table_id = claim.primary;
  document.table_number = claim.labels[claim.tables.indexOf(claim.primary)];
  const existing = await db
    .collection('sales')
    .findOne({ _id: document._id, branch_id: scope.branchId, license: scope.license });
  if (existing && existing.seating_request_id !== claim.id)
    fail('The sale identity is already in use.', 409);
  return existing;
}
async function forEdit(db, scope, order, next) {
  const destination = String(next.table || order.table_number || '');
  const claims = await read(db, scope);
  const own = claims.find((claim) => !terminal(claim) && claim.order_id === String(order._id));
  if (own?.closing) fail('Close is in progress. Refresh this order.', 409);
  if (own?.state === 'releasing') fail('Close is in progress. Refresh this order.', 409);
  if (own?.moving_to) fail('Reconcile the table move before editing this order.', 409);
  if (order.seating_request_id && !own) fail('The seating group changed. Refresh this order.', 409);
  if (
    own &&
    (destination !== String(order.table_number || '') ||
      (next.dine_type && next.dine_type !== order.dine_type))
  )
    fail('Change the seating group before changing its table or order type.', 409);
  // The claim is the immutable reservation request, not the mutable cover count.
  // The sale owns current guests; keeping the original request allows safe replay.
  if (own && next.guests !== undefined && next.guests !== '') {
    const guests = Number(next.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > 1000)
      fail('Enter the number of guests.');
    if (!details.accommodates(own, guests)) fail('Choose a table with enough seats.', 409);
  }
  if (
    !own &&
    destination !== String(order.table_number || '') &&
    claims.some(
      (claim) =>
        !terminal(claim) &&
        claim.order_id !== String(order._id) &&
        claim.labels.includes(destination)
    )
  )
    fail('This table is reserved for another order.', 409);
  return own || null;
}
module.exports = {
  reserve,
  prepareMove,
  beginClose,
  cancelMove,
  completeMove,
  bind,
  cancel,
  read,
  find,
  archive,
  release,
  forOrder,
  prepareOrder,
  forEdit,
};
