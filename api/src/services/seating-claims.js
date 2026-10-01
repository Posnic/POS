'use strict';
const { ObjectId } = require('mongodb');
const { fail } = require('../utils/branch-access');
const details = require('../utils/table-details');
const restructure = require('./captain-restructure-lock');

// All order-entry paths must use these claims before combined seating is exposed.
// One branch document makes a multi-table claim atomic on standalone MongoDB too.
// Claims do not expire silently: an interrupted submission must be reconciled or
// cancelled explicitly, otherwise a delayed sale could seat the same table twice.
const store = (db) => db.collection('table_seating');
const history = (db) => db.collection('table_seating_history');
const terminal = (claim) => ['cancelled', 'released'].includes(claim.state);
function occupiedGuests(claims, sales) {
  const counts = new Map();
  for (const claim of claims)
    counts.set(claim.order_id || `claim:${claim.id}`, Math.max(1, Number(claim.guests) || 1));
  for (const sale of sales) {
    const key = String(sale._id),
      guests = Number(sale.person_count);
    // Legacy sales may omit covers. Keep their reservation's count in that
    // case, and count an unclaimed legacy check as at least one guest.
    counts.set(key, Number.isFinite(guests) && guests >= 1 ? guests : counts.get(key) || 1);
  }
  return [...counts.values()].reduce((sum, value) => sum + value, 0);
}
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
    (saved.adopt_order || null) === (input.adopt_order || null) &&
    (saved.merge_target || null) === (input.merge_target || null) &&
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
const enrollmentId = (parentId, orderId) =>
  'enroll-' +
  require('crypto')
    .createHash('sha256')
    .update(JSON.stringify([parentId, String(orderId)]))
    .digest('hex')
    .slice(0, 40);
async function reconcileEnrollment(db, scope, parentId, order, actor, start = false, parentIntent) {
  const childId = enrollmentId(parentId, order._id);
  const child = await restructure.read(db, scope, childId, actor, { optional: true });
  if (child?.stage === 'cancelled') {
    if (start) fail('This seating request has already been used.', 409);
    return order;
  }
  if (child || (start && !order.seating_request_id)) {
    await enrollExisting(db, scope, String(order._id), {
      request_id: childId,
      actor,
      parent_request_id: parentId,
      ...(parentIntent ? { parent_intent: parentIntent } : {}),
    });
    return db
      .collection('sales')
      .findOne({ _id: order._id, branch_id: scope.branchId, license: scope.license });
  }
  return order;
}
async function reconcileMergeTarget(db, scope, parentId, sourceId, actor, target = null) {
  // One fixed child per parent pins the destination even before the parent
  // reservation exists, and lets cancellation discover interrupted enrollment.
  const childId = enrollmentId(parentId, 'merge-target');
  const child = await restructure.read(db, scope, childId, actor, { optional: true });
  const parentIntent = { kind: 'merge-target', sourceId: String(sourceId) };
  if (
    child &&
    (JSON.stringify(child.intent.parentIntent) !== JSON.stringify(parentIntent) ||
      (target && child.intent.orderId !== String(target._id)))
  )
    fail('This seating request has already been used.', 409);
  if (child?.stage === 'cancelled') {
    if (target) fail('This seating request has already been used.', 409);
    return null;
  }
  if (child || (target && !target.seating_request_id)) {
    const targetId = child?.intent.orderId || String(target._id);
    await enrollExisting(db, scope, targetId, {
      request_id: childId,
      actor,
      parent_request_id: parentId,
      parent_intent: parentIntent,
    });
    return db
      .collection('sales')
      .findOne({ _id: new ObjectId(targetId), branch_id: scope.branchId, license: scope.license });
  }
  return target;
}
async function reserveClaim(
  db,
  scope,
  input,
  moving = null,
  operationLock = null,
  mergeTarget = null,
  adopting = null
) {
  await reconcileExpiredEditCapacity(db, scope);
  const id = requestId(input.request_id);
  const takeaway = moving && input.dine_type === 'Take away';
  if (input.dine_type && !['Dine-in', 'Take away'].includes(input.dine_type))
    fail('Choose an order type.');
  if (
    !Array.isArray(input.table_ids) ||
    input.table_ids.length > 20 ||
    (takeaway ? input.table_ids.length !== 0 : !input.table_ids.length)
  )
    fail('Choose up to 20 tables.');
  const ids = [...new Set(input.table_ids.map(identity))].sort();
  const primary = takeaway ? '' : identity(input.primary_id);
  const actor = String(input.actor || '');
  if (!actor || (!takeaway && !ids.includes(primary))) fail('Choose a primary table.');
  if (
    !Number.isInteger(input.guests) ||
    (takeaway ? input.guests !== 0 : input.guests < 1 || input.guests > 1000)
  )
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
    ...(adopting ? { adopt_order: String(adopting._id), order_id: String(adopting._id) } : {}),
    ...(operationLock ? { operation_lock: operationLock } : {}),
    ...(mergeTarget ? { merge_target: String(mergeTarget._id) } : {}),
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
  const party = input.guests + (mergeTarget ? Number(mergeTarget.person_count) : 0);
  if (mergeTarget && (!Number.isInteger(party) || party < 2 || !maximum))
    fail('Set the seating capacity before combining tables.');
  if (!adopting && maximum && party > maximum) fail('Choose a table with enough seats.');
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
  if (
    overlaps.some(
      (row) =>
        row.guest_update ||
        row.moving_to ||
        row.closing ||
        ['applying', 'releasing'].includes(row.state) ||
        ((row.move_from || row.adopt_order) && row.state === 'reserved')
    )
  )
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
        ...(adopting ? { _id: { $ne: adopting._id } } : {}),
      },
      { projection: { _id: 1, person_count: 1 } }
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
      ...overlaps
        .filter((row) => row.kind !== 'legacy-edit')
        .map((row) => (row.order_id ? `sale:${row.order_id}` : `claim:${row.id}`)),
    ]).size;
    if (mergeTarget) {
      if (
        open.length !== 1 ||
        String(open[0]._id) !== String(mergeTarget._id) ||
        overlaps.some((row) => row.order_id !== String(mergeTarget._id)) ||
        tables[0].tableorder_value !== mergeTarget.table_number
      )
        fail('The seating group changed. Refresh this order.', 409);
    } else if (!adopting && limit && count >= limit)
      fail('This table has reached its open order limit.', 409);
    if (!adopting && maximum && input.guests + occupiedGuests(overlaps, open) > maximum)
      fail('Choose a table with enough seats.', 409);
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
async function prepareMove(
  db,
  scope,
  orderId,
  input,
  { staffHandover = false, mergeTargetId = null } = {}
) {
  const id = requestId(input.request_id);
  const takeaway = input.dine_type === 'Take away';
  if (input.dine_type && !['Dine-in', 'Take away'].includes(input.dine_type))
    fail('Choose an order type.');
  if (
    !Array.isArray(input.table_ids) ||
    input.table_ids.length > 20 ||
    (takeaway ? input.table_ids.length !== 0 : !input.table_ids.length)
  )
    fail('Choose up to 20 tables.');
  if (
    !Number.isInteger(input.guests) ||
    (takeaway ? input.guests !== 0 : input.guests < 1 || input.guests > 1000)
  )
    fail('Enter the number of guests.');
  const expected = {
    actor: String(input.actor || ''),
    ...(mergeTargetId ? { merge_target: identity(mergeTargetId) } : {}),
    primary: takeaway ? '' : identity(input.primary_id),
    tables: [...new Set(input.table_ids.map(identity))].sort(),
    guests: input.guests,
    dine_type: takeaway ? 'Take away' : 'Dine-in',
    ...(input.payload_hash ? { payload_hash: input.payload_hash } : {}),
  };
  let order = await db.collection('sales').findOne({
    _id: new ObjectId(identity(orderId)),
    branch_id: scope.branchId,
    license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
  });
  const previous = await find(db, scope, id);
  if (previous && terminal(previous)) fail('This seating request has already been used.', 409);
  if (order && staffHandover)
    order = await reconcileEnrollment(db, scope, id, order, expected.actor, true);
  if (!order?.seating_request_id) fail('Refresh this order before changing its seating.', 409);
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
    if (previous.operation_lock) {
      const journal = await restructure.read(db, scope, id, expected.actor);
      if (journal.stage === 'cancelled') {
        await cancelMove(db, scope, id, expected.actor, String(order._id), { staffHandover });
        fail('This seating request has already been used.', 409);
      }
    }
    return previous;
  }

  const source = await find(db, scope, order.seating_request_id);
  if (
    !source ||
    source.guest_update ||
    source.state !== 'submitting' ||
    source.order_id !== String(order._id)
  )
    fail('The seating group changed. Refresh this order.', 409);
  if (!staffHandover && String(input.actor || '') !== source.actor)
    fail('Permission is required.', 403);
  let mergeTarget = null;
  if (mergeTargetId) {
    if (
      takeaway ||
      expected.tables.length !== 1 ||
      mergeTargetId === String(order._id) ||
      order.payment_status !== 'Unpaid' ||
      Number(order.person_count) !== input.guests
    )
      fail('The seating group changed. Refresh this order.', 409);
    mergeTarget = await db.collection('sales').findOne({
      _id: new ObjectId(identity(mergeTargetId)),
      branch_id: scope.branchId,
      license: scope.license,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
      floor_closed_at: { $exists: false },
      order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
    });
    if (mergeTarget && staffHandover)
      mergeTarget = await reconcileMergeTarget(
        db,
        scope,
        id,
        order._id,
        expected.actor,
        mergeTarget
      );
    const targetClaim =
      mergeTarget?.seating_request_id && (await find(db, scope, mergeTarget.seating_request_id));
    if (
      !targetClaim ||
      targetClaim.state !== 'submitting' ||
      targetClaim.moving_to ||
      targetClaim.closing ||
      targetClaim.tables.length !== 1 ||
      targetClaim.primary !== expected.primary ||
      targetClaim.order_id !== String(mergeTarget._id) ||
      targetClaim.id === source.id
    )
      fail('The seating group changed. Refresh this order.', 409);
  }
  const lock = await restructure.reserve(db, scope, {
    requestId: id,
    actor: expected.actor,
    intent: { kind: 'move', source: source.id, ...expected },
    sales: mergeTarget ? [order, mergeTarget] : [order],
  });
  try {
    const claim = await reserveClaim(db, scope, input, source, lock._id, mergeTarget);
    const journal = await restructure.read(db, scope, id, expected.actor);
    if (journal.stage === 'cancelled') {
      await cancelMove(db, scope, id, expected.actor, String(order._id), { staffHandover });
      fail('This seating request has already been used.', 409);
    }
    return claim;
  } catch (error) {
    // A competing retry may already have published this exact reservation.
    const saved = await find(db, scope, id);
    if (
      saved &&
      !terminal(saved) &&
      saved.operation_lock === lock._id &&
      sameRequest(saved, { ...expected, move_from: source.id })
    )
      return saved;
    await restructure.cancel(db, scope, id, expected.actor);
    throw error;
  }
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
        row.guest_update ||
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
  if (saved && saved.actor !== String(actor)) fail('Permission is required.', 403);
  const lock = await restructure.read(db, scope, id, actor, { optional: true });
  if (
    lock &&
    (lock.intent.kind !== 'move' || (orderId && !lock.orderIds.includes(String(orderId))))
  )
    fail('This seating request has already been used.', 409);
  if (orderId && staffHandover) {
    const original = await db.collection('sales').findOne({
      _id: new ObjectId(identity(orderId)),
      branch_id: scope.branchId,
      license: scope.license,
    });
    if (original) await reconcileEnrollment(db, scope, id, original, String(actor));
  }
  if (staffHandover && (orderId || saved?.order_id))
    await reconcileMergeTarget(db, scope, id, orderId || saved.order_id, String(actor));
  if (!saved && orderId) {
    const order = await db.collection('sales').findOne({
      _id: new ObjectId(identity(orderId)),
      branch_id: scope.branchId,
      license: scope.license,
    });
    const source = order?.seating_request_id && (await find(db, scope, order.seating_request_id));
    if (
      !order ||
      (!source && (!staffHandover || order.seating_request_id)) ||
      (source &&
        ((!staffHandover && source.actor !== String(actor)) ||
          source.order_id !== String(order._id)))
    )
      fail('Permission is required.', 403);
    if (!source) {
      try {
        await store(db).updateOne(
          { _id: scopeKey(scope) },
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
    }
    const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
    saved = snapshot?.claims.find((row) => row.id === id) || (await find(db, scope, id));
    if (!saved) {
      if (lock) await restructure.cancel(db, scope, id, actor);
      const tombstone = {
        id,
        actor: String(actor),
        order_id: String(order._id),
        move_from: source?.id || `legacy-${String(order._id)}`,
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
  if (saved.state === 'cancelled') {
    if (lock) await restructure.cancel(db, scope, id, actor);
    return;
  }
  if (saved.state !== 'reserved') fail('Reconcile the table move before cancelling it.', 409);
  const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
  const source = snapshot?.claims.find((row) => row.id === saved.move_from);
  if (source?.moving_to !== id) fail('The seating group changed. Refresh this order.', 409);
  // Decide cancellation versus completion at the sale fence before touching seats.
  if (lock) await restructure.cancel(db, scope, id, actor);
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
  const finish = async (claim) => {
    if (claim.operation_lock) await restructure.complete(db, scope, id, actor);
    return claim;
  };
  if (move.state === 'submitting') return finish(move);
  if (!['reserved', 'applying'].includes(move.state))
    fail('This move is no longer available.', 409);
  if (move.operation_lock) await restructure.applying(db, scope, id, actor);
  if (move.state === 'reserved') {
    const claimed = await store(db).updateOne(
      { _id: scopeKey(scope), claims: { $elemMatch: { id, state: 'reserved' } } },
      { $set: { 'claims.$.state': 'applying' }, $inc: { revision: 1 } }
    );
    if (!claimed.matchedCount) {
      move = await find(db, scope, id);
      if (move?.state === 'submitting') return finish(move);
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
    table_number:
      move.dine_type === 'Take away' ? '' : move.labels[move.tables.indexOf(move.primary)],
    dine_type: move.dine_type || 'Dine-in',
    person_count: move.guests,
    updated_date: new Date(),
  };
  const changed = await db.collection('sales').updateOne(
    {
      ...selector,
      seating_request_id: move.move_from,
      captain_payment_plan: move.operation_lock || { $exists: false },
      ...require('../helpers/floor-eligibility').floorEligibility(),
    },
    {
      $set: fields,
      $push: {
        captain_audit: {
          action: move.merge_target ? 'merge' : 'move',
          ...(move.merge_target ? { target_order_id: move.merge_target } : {}),
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
  const otherClaims = (await read(db, scope)).filter(
    (row) => !terminal(row) && row.id !== source.id && row.id !== id
  );
  const remainingOrders = await db
    .collection('sales')
    .find(
      {
        branch_id: scope.branchId,
        license: scope.license,
        ...require('../helpers/floor-eligibility').floorEligibility(),
        table_number: { $in: source.labels },
      },
      { projection: { table_number: 1 } }
    )
    .toArray();
  const released = source.tables.filter(
    (table, index) =>
      !move.tables.includes(table) &&
      !otherClaims.some((row) => row.tables.includes(table)) &&
      !remainingOrders.some((order) => String(order.table_number) === String(source.labels[index]))
  );
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
  if (current?.state === 'submitting') return finish(current);
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
  return finish(await find(db, scope, id));
}

async function bind(db, scope, id, actor, orderId) {
  requestId(id);
  const sale = identity(orderId);
  const result = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: {
        $elemMatch: {
          id,
          actor: String(actor),
          state: 'reserved',
          move_from: { $exists: false },
          adopt_order: { $exists: false },
        },
      },
    },
    { $set: { 'claims.$.state': 'submitting', 'claims.$.order_id': sale }, $inc: { revision: 1 } }
  );
  if (result.matchedCount) return;
  const existing = (await read(db, scope)).find((row) => row.id === id);
  if (
    existing?.actor === String(actor) &&
    !existing.adopt_order &&
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
  if (saved.adopt_order) fail('Reconcile the submitted order before releasing its tables.', 409);
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
async function release(db, scope, id, { transferId } = {}) {
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
  let transferred = false;
  if (transferId) {
    const journal = await db.collection('captain_payment_plans').findOne({
      _id: transferId,
      branch_id: scope.branchId,
      license: scope.license,
      purpose: 'order-restructure',
      'intent.kind': 'transfer',
      'intent.orderId': String(sale._id),
      orderIds: String(sale._id),
      stage: 'applying',
    });
    transferred =
      !!journal &&
      sale.captain_payment_plan === transferId &&
      Number(sale.sales_total) === 0 &&
      sale.captain_transfer_allocation?.totalMinor === 0 &&
      sale.captain_transfer_allocation?.lines?.length === 0 &&
      Array.isArray(sale.items) &&
      !sale.items.some(
        (line) =>
          line &&
          !line.return &&
          !line.cancelled &&
          !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
          Number(line.quantity ?? line.item_quantity ?? line.qty) > 0
      ) &&
      sale.captain_transfer_operations?.some(
        (row) => row.id === transferId && row.side === 'source'
      );
    if (!transferred) fail('Reconcile this transfer before releasing its tables.', 409);
  }
  const remainingOrders = await db.collection('sales').countDocuments({
    branch_id: scope.branchId,
    license: scope.license,
    ...require('../helpers/floor-eligibility').floorEligibility(),
    table_number: { $in: claim.labels },
  });
  const cancelled = String(sale.sale_process).toLowerCase() === 'cancelled';
  const detached = cancelled || transferred;
  if (remainingOrders && !detached)
    fail('Close the remaining orders before releasing this table.', 409);
  const otherClaims =
    detached &&
    (await read(db, scope)).some(
      (other) =>
        other.id !== claim.id &&
        !terminal(other) &&
        other.tables.some((table) => claim.tables.includes(table))
    );
  let stillOccupied = detached && (remainingOrders > 0 || otherClaims);
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

  if (detached) {
    // Read occupancy again AFTER acquiring the releasing claim. A shared check
    // may have arrived after the first read. New reservations now see the fence,
    // and any reservation using an older branch revision fails its own CAS.
    const remaining = await db.collection('sales').countDocuments({
      branch_id: scope.branchId,
      license: scope.license,
      ...require('../helpers/floor-eligibility').floorEligibility(),
      table_number: { $in: claim.labels },
    });
    const neighbours = (await read(db, scope)).some(
      (other) =>
        other.id !== claim.id &&
        !terminal(other) &&
        other.tables.some((table) => claim.tables.includes(table))
    );
    stillOccupied = remaining > 0 || neighbours;
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
// A legacy source has no seating claim. Create a deterministic, temporary
// release claim so the existing branch revision fence also protects cleanup.
// No sale metadata or kitchen events are rewritten by this operation.
async function releaseTransferredLegacy(db, scope, orderId, transferId) {
  const sale = await db.collection('sales').findOne({
    _id: new ObjectId(identity(String(orderId))),
    branch_id: scope.branchId,
    license: scope.license,
    captain_payment_plan: transferId,
    floor_closed_transfer_id: transferId,
    floor_closed_at: { $exists: true },
  });
  const journal = await db.collection('captain_payment_plans').findOne({
    _id: transferId,
    branch_id: scope.branchId,
    license: scope.license,
    purpose: 'order-restructure',
    'intent.kind': 'transfer',
    'intent.orderId': String(orderId),
    stage: 'applying',
  });
  if (
    !sale ||
    !journal ||
    sale.seating_request_id ||
    Number(sale.sales_total) !== 0 ||
    sale.captain_transfer_allocation?.totalMinor !== 0 ||
    sale.captain_transfer_allocation?.lines?.length !== 0 ||
    !Array.isArray(sale.items) ||
    sale.items.some(
      (line) =>
        line &&
        !line.return &&
        !line.cancelled &&
        !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
        Number(line.quantity ?? line.item_quantity ?? line.qty) > 0
    )
  )
    fail('Reconcile this transfer before releasing its tables.', 409);
  if (!String(sale.table_number || '').trim()) return;
  const id =
    'release-' +
    require('crypto').createHash('sha256').update(transferId).digest('hex').slice(0, 40);
  let claim = await find(db, scope, id);
  if (!claim) {
    const table = await db.collection('tableorder').findOne({
      branch_id: scope.branchId,
      license: scope.license,
      tableorder_value: String(sale.table_number || ''),
      ...(/^[a-f0-9]{24}$/i.test(String(sale.table_id || ''))
        ? { _id: new ObjectId(sale.table_id) }
        : {}),
    });
    // Manually named tables have no physical table to clean. Preserve a
    // manager's existing hold or cleaning state rather than overwriting it.
    if (
      !table ||
      ['held', 'cleaning'].includes(table.service_state) ||
      (table.floor_close && !table.floor_close.completed)
    )
      return;
    const tableId = String(table._id);
    claim = await reserveClaim(
      db,
      scope,
      {
        request_id: id,
        actor: journal.actor,
        table_ids: [tableId],
        primary_id: tableId,
        guests: 1,
      },
      null,
      transferId,
      null,
      sale
    );
  }
  if (claim.operation_lock !== transferId || claim.order_id !== String(sale._id))
    fail('Reconcile this transfer before releasing its tables.', 409);
  if (claim.state === 'reserved')
    await store(db).updateOne(
      {
        _id: scopeKey(scope),
        claims: { $elemMatch: { id, state: 'reserved', operation_lock: transferId } },
      },
      { $set: { 'claims.$.state': 'submitting' }, $inc: { revision: 1 } }
    );
  await release(db, scope, id, { transferId });
}
async function forOrder(db, scope, input) {
  const id = requestId(input.request_id);
  const claim = await find(db, scope, id);
  if (!claim || terminal(claim) || claim.move_from || claim.moving_to || claim.adopt_order)
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
  await reconcileExpiredEditCapacity(db, scope);
  const destination = String(next.table || order.table_number || '');
  const claims = await read(db, scope);
  const own = claims.find((claim) => !terminal(claim) && claim.order_id === String(order._id));
  if (own?.guest_update) fail('This order is being updated. Please retry.', 409);
  if (own?.adopt_order && own.state === 'reserved')
    fail('This order is being updated. Please retry.', 409);
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
  if (own && next.guests !== undefined && next.guests !== null && next.guests !== '') {
    const guests = Number(next.guests);
    const takeaway = own.tables.length === 0 && own.dine_type === 'Take away';
    if (!Number.isInteger(guests) || (takeaway ? guests !== 0 : guests < 1 || guests > 1000))
      fail('Enter the number of guests.');
    // Existing over-capacity data must not block adding/correcting dishes or
    // reducing covers. Only an increase can consume additional seats. Keep
    // the ownership, close and move checks above in effect for every edit.
    const currentGuests = Number(order.person_count);
    if (Number.isInteger(currentGuests) && currentGuests >= 0 && guests <= currentGuests)
      return own;
    let otherGuests = 0;
    if (!takeaway) {
      const overlaps = claims.filter(
        (claim) =>
          !terminal(claim) &&
          claim.id !== own.id &&
          claim.order_id !== String(order._id) &&
          claim.tables.some((table) => own.tables.includes(table))
      );
      if (overlaps.some(capacityChanging)) fail('This order is being updated. Please retry.', 409);
      const others = await db
        .collection('sales')
        .find(
          {
            branch_id: scope.branchId,
            license: scope.license,
            ...require('../helpers/floor-eligibility').floorEligibility(),
            _id: { $ne: order._id },
            table_number: { $in: own.labels },
          },
          { projection: { _id: 1, person_count: 1 } }
        )
        .toArray();
      // A committed sale replaces its reservation's original cover count.
      // Count unclaimed legacy checks and pending reservations as well.
      otherGuests = occupiedGuests(overlaps, others);
    }
    const total = guests + otherGuests;
    if (!details.accommodates(own, total)) fail('Choose a table with enough seats.', 409);
  }
  // Older checks also share capacity with submitted checks and reservations.
  // This is a preflight; legacy writers still need the durable commit protocol.
  if (
    !own &&
    destination === String(order.table_number || '') &&
    next.guests !== undefined &&
    next.guests !== null &&
    next.guests !== '' &&
    (next.dine_type || order.dine_type || 'Dine-in') === 'Dine-in'
  ) {
    const guests = Number(next.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > 1000)
      fail('Enter the number of guests.');
    if (guests > (Number(order.person_count) || 0)) {
      const table = await db.collection('tableorder').findOne({
        branch_id: scope.branchId,
        license: scope.license,
        tableorder_value: destination,
      });
      if (table) {
        const overlaps = claims.filter(
          (claim) =>
            !terminal(claim) &&
            claim.order_id !== String(order._id) &&
            claim.tables.includes(String(table._id))
        );
        if (overlaps.some(capacityChanging))
          fail('This order is being updated. Please retry.', 409);
        const others = await db
          .collection('sales')
          .find(
            {
              branch_id: scope.branchId,
              license: scope.license,
              ...require('../helpers/floor-eligibility').floorEligibility(),
              _id: { $ne: order._id },
              table_number: destination,
            },
            { projection: { _id: 1, person_count: 1 } }
          )
          .toArray();
        if (!details.accommodates(table, guests + occupiedGuests(overlaps, others)))
          fail('Choose a table with enough seats.', 409);
      }
    }
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
// An in-progress move/enrollment can have a reservation and a sale on different
// tables. Do not approve extra covers against that intermediate occupancy.
// Ordinary pending reservations remain countable through occupiedGuests.
function capacityChanging(claim) {
  return (
    claim.guest_update ||
    claim.moving_to ||
    claim.closing ||
    ['applying', 'releasing'].includes(claim.state) ||
    ((claim.move_from || claim.adopt_order) && claim.state === 'reserved')
  );
}
// Enroll an existing sale in the seating protocol without recreating its items
// or financial/kitchen history. Kept separate from new-order reservation: the
// party is already seated and must not be rejected for historical overcapacity.
async function enrollExisting(db, scope, orderId, input) {
  const id = requestId(input.request_id),
    actor = String(input.actor || ''),
    orderKey = identity(orderId);
  if (!actor) fail('Permission is required.', 403);
  let journal = await restructure.read(db, scope, id, actor, { optional: true });
  if (
    journal &&
    (journal.intent.kind !== 'enroll' ||
      journal.intent.orderId !== orderKey ||
      journal.stage === 'cancelled' ||
      JSON.stringify(journal.intent.parentIntent) !== JSON.stringify(input.parent_intent))
  )
    fail('This seating request has already been used.', 409);
  if (!journal) {
    const sale = await db
      .collection('sales')
      .findOne({ _id: new ObjectId(orderKey), branch_id: scope.branchId, license: scope.license });
    if (!sale || sale.seating_request_id || !String(sale.table_number || '').trim())
      fail('The seating group changed. Refresh this order.', 409);
    const tables = await db
      .collection('tableorder')
      .find({
        branch_id: scope.branchId,
        license: scope.license,
        tableorder_value: String(sale.table_number),
        ...(/^[a-f0-9]{24}$/i.test(String(sale.table_id || ''))
          ? { _id: new ObjectId(sale.table_id) }
          : {}),
      })
      .limit(2)
      .toArray();
    if (tables.length !== 1) fail('Choose tables from this branch.', 409);
    const intent = {
      kind: 'enroll',
      orderId: orderKey,
      tableId: String(tables[0]._id),
      ...(input.parent_intent ? { parentIntent: input.parent_intent } : {}),
    };
    journal = await restructure.reserve(db, scope, { requestId: id, actor, intent, sales: [sale] });
  }
  if (journal.stage === 'reserving')
    journal = await restructure.reserve(db, scope, {
      requestId: id,
      actor,
      intent: journal.intent,
      sales: journal.sales,
    });
  if (journal.stage === 'completed') {
    await restructure.complete(db, scope, id, actor);
    return find(db, scope, id);
  }
  const original = journal.sales[0],
    tableId = journal.intent.tableId;
  if (journal.stage === 'reserved') {
    try {
      // The child journal exists before this check. Cancellation either sees
      // and recovers it, or has already published the parent tombstone.
      if (input.parent_request_id && !(await find(db, scope, id))) {
        const parent = await find(db, scope, input.parent_request_id);
        if (parent && terminal(parent)) fail('This seating request has already been used.', 409);
      }
      await reserveClaim(
        db,
        scope,
        {
          request_id: id,
          actor,
          table_ids: [tableId],
          primary_id: tableId,
          guests: Number(original.person_count) || 1,
        },
        null,
        journal._id,
        null,
        original
      );
    } catch (error) {
      const published = await find(db, scope, id);
      if (published?.adopt_order !== orderKey) await restructure.cancel(db, scope, id, actor);
      throw error;
    }
    await restructure.applying(db, scope, id, actor);
  }
  const selector = {
    _id: original._id,
    branch_id: scope.branchId,
    license: scope.license,
    captain_payment_plan: journal._id,
  };
  const updated = await db.collection('sales').updateOne(
    {
      ...selector,
      seating_request_id:
        original.seating_request_id === undefined
          ? { $exists: false }
          : original.seating_request_id,
    },
    {
      $set: {
        seating_request_id: id,
        seating_table_ids: [tableId],
        seating_primary_id: tableId,
        table_id: tableId,
        seating_capacity_revision: id,
        updated_date: new Date(),
      },
    }
  );
  if (
    !updated.matchedCount &&
    !(await db.collection('sales').findOne({ ...selector, seating_request_id: id }))
  )
    fail('The seating group changed. Refresh this order.', 409);
  const activated = await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: {
        $elemMatch: { id, adopt_order: orderKey, state: { $in: ['reserved', 'submitting'] } },
      },
    },
    { $set: { 'claims.$.state': 'submitting' }, $inc: { revision: 1 } }
  );
  if (!activated.matchedCount) fail('The seating group changed. Refresh this order.', 409);
  await restructure.complete(db, scope, id, actor);
  return find(db, scope, id);
}

// Durable cover-only update. Callers must keep the request ID until a retry
// confirms completion. No item, pricing, stock or kitchen projection is made.
async function changeGuests(db, scope, orderId, input) {
  await reconcileExpiredEditCapacity(db, scope);
  const id = requestId(input.request_id),
    actor = String(input.actor || '');
  const orderKey = identity(orderId),
    guests = input.guests;
  if (!actor || !Number.isInteger(guests) || guests < 1 || guests > 1000)
    fail('Enter the number of guests.');
  const intent = { kind: 'covers', orderId: orderKey, guests };
  let journal = await restructure.read(db, scope, id, actor, { optional: true });
  if (
    journal &&
    (JSON.stringify(journal.intent) !== JSON.stringify(intent) || journal.stage === 'cancelled')
  )
    fail('This seating request has already been used.', 409);
  if (!journal) {
    let sale = await db.collection('sales').findOne({
      _id: new ObjectId(orderKey),
      branch_id: scope.branchId,
      license: scope.license,
    });
    if (!sale) fail('Refresh this order before changing its seating.', 409);
    if (
      !sale.seating_request_id &&
      (sale.sale_process !== 'KOT' ||
        ![undefined, null, '', 'Unpaid'].includes(sale.payment_status))
    ) {
      await restructure.rejectIntent(db, scope, { requestId: id, actor, intent });
      fail('The seating group changed. Refresh this order.', 409);
    }
    try {
      sale = await reconcileEnrollment(db, scope, id, sale, actor, true, intent);
    } catch (error) {
      if (error.status === 409) {
        const child = await restructure.read(db, scope, enrollmentId(id, orderKey), actor, {
          optional: true,
        });
        // An applying child must stay recoverable. Only a rejection with no
        // pending enrollment is safe for Captain to discard and edit again.
        if (!child || child.stage === 'cancelled')
          await restructure.rejectIntent(db, scope, { requestId: id, actor, intent });
      }
      throw error;
    }
    const claim = await find(db, scope, sale.seating_request_id);
    // Capacity is shared across checks. Fence all existing occupants, so a
    // desktop save that passed its preflight cannot change a neighbour's covers
    // while this operation validates and commits the group's capacity.
    const others = claim?.labels?.length
      ? await db
          .collection('sales')
          .find({
            branch_id: scope.branchId,
            license: scope.license,
            ...require('../helpers/floor-eligibility').floorEligibility(),
            table_number: { $in: claim.labels },
            _id: { $ne: sale._id },
          })
          .limit(200)
          .toArray()
      : [];
    journal = await restructure.reserve(db, scope, {
      requestId: id,
      actor,
      intent,
      sales: [sale, ...others],
    });
  }
  if (journal.stage === 'reserving')
    journal = await restructure.reserve(db, scope, {
      requestId: id,
      actor,
      intent,
      sales: journal.sales,
    });
  const answer = { request_id: id, orderId: orderKey, guests, state: 'completed' };
  if (journal.stage === 'completed') {
    await restructure.complete(db, scope, id, actor);
    return answer;
  }
  const original = journal.sales[0];
  if (journal.stage === 'reserved') {
    try {
      const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
      const own = snapshot?.claims.find((row) => row.id === original.seating_request_id);
      if (
        !own ||
        own.order_id !== orderKey ||
        own.state !== 'submitting' ||
        own.moving_to ||
        own.closing ||
        !own.tables.length
      )
        fail('The seating group changed. Refresh this order.', 409);
      if (own.guest_update && own.guest_update !== id)
        fail('This order is being updated. Please retry.', 409);
      if (!own.guest_update) {
        const overlaps = snapshot.claims.filter(
          (row) =>
            !terminal(row) &&
            row.id !== own.id &&
            row.tables.some((table) => own.tables.includes(table))
        );
        if (
          overlaps.some(
            (row) => row.guest_update || row.moving_to || row.closing || row.state !== 'submitting'
          )
        )
          fail('This order is being updated. Please retry.', 409);
        const others = await db
          .collection('sales')
          .find(
            {
              branch_id: scope.branchId,
              license: scope.license,
              ...require('../helpers/floor-eligibility').floorEligibility(),
              table_number: { $in: own.labels },
              _id: { $ne: original._id },
            },
            { projection: { _id: 1, person_count: 1, captain_payment_plan: 1 } }
          )
          .toArray();
        if (
          others.some(
            (other) =>
              other.captain_payment_plan !== journal._id ||
              !journal.orderIds.includes(String(other._id))
          )
        )
          fail('Table changed. Refresh and try again.', 409);
        if (
          guests > Number(original.person_count || 0) &&
          !details.accommodates(own, guests + occupiedGuests(overlaps, others))
        )
          fail('Choose a table with enough seats.', 409);
        const reserved = await store(db).updateOne(
          {
            _id: scopeKey(scope),
            revision: snapshot.revision,
            claims: { $elemMatch: { id: own.id, guest_update: { $exists: false } } },
          },
          { $set: { 'claims.$.guest_update': id }, $inc: { revision: 1 } }
        );
        if (!reserved.matchedCount) fail('Table changed. Refresh and try again.', 409);
      }
    } catch (error) {
      // Keep a published reservation durable after an uncertain acknowledgement.
      const own = await find(db, scope, original.seating_request_id);
      if (own?.guest_update !== id) await restructure.cancel(db, scope, id, actor);
      throw error;
    }
    await restructure.applying(db, scope, id, actor);
  }
  const updated = await db.collection('sales').updateOne(
    {
      _id: original._id,
      branch_id: scope.branchId,
      license: scope.license,
      captain_payment_plan: journal._id,
      seating_request_id: original.seating_request_id,
      'captain_audit.request_id': { $ne: id },
    },
    {
      $set: { person_count: guests, updated_date: new Date() },
      $push: {
        captain_audit: {
          action: 'guests',
          request_id: id,
          actor: { id: actor },
          at: journal.createdAt,
          previous_guests: original.person_count,
          guests,
        },
      },
    }
  );
  if (
    !updated.matchedCount &&
    !(await db.collection('sales').findOne({
      _id: original._id,
      branch_id: scope.branchId,
      license: scope.license,
      captain_payment_plan: journal._id,
      person_count: guests,
      'captain_audit.request_id': id,
    }))
  )
    fail('This order is being updated. Please retry.', 409);
  // Invalidate preflight reads on every occupant before releasing their fences.
  // A delayed desktop/order write must not pass simply because the temporary
  // fence has been removed again. This revision is stable across retries.
  await db
    .collection('sales')
    .updateMany(
      { branch_id: scope.branchId, license: scope.license, captain_payment_plan: journal._id },
      { $set: { seating_capacity_revision: id } }
    );
  await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: { $elemMatch: { id: original.seating_request_id, guest_update: id } },
    },
    { $unset: { 'claims.$.guest_update': '' }, $inc: { revision: 1 } }
  );
  await restructure.complete(db, scope, id, actor);
  return answer;
}
// Legacy full-order writers need to reserve their additional seats before
// committing the order. The reservation deliberately has no order_id: it is
// counted in addition to the current sale until that write is reconciled.
async function reserveEditCapacity(db, scope, order, next, { now = new Date() } = {}) {
  const suppliedGuests = next.guests !== undefined && next.guests !== null && next.guests !== '';
  const guests = suppliedGuests
    ? Number(next.guests)
    : Math.max(1, Number(order.person_count) || 1);
  const destination = String(next.table ?? order.table_number ?? '');
  const type = next.dine_type || order.dine_type || 'Dine-in';
  if (type !== 'Dine-in' || !destination) return null;
  if (!Number.isInteger(guests) || guests < 1 || guests > 1000) fail('Enter the number of guests.');
  const sameTable =
    destination === String(order.table_number || '') &&
    (order.dine_type || 'Dine-in') === 'Dine-in';
  // A parked sale has not occupied these seats yet. Sending it to the
  // kitchen must reserve the whole party even when its table/count is unchanged.
  const activatingHold = order.sale_process === 'Hold' && next.sale_process === 'KOT';
  const extra =
    sameTable && !activatingHold ? guests - Math.max(1, Number(order.person_count) || 1) : guests;
  if (extra <= 0) return null;
  await store(db).updateOne(
    { _id: scopeKey(scope) },
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
  const snapshot = await store(db).findOne({ _id: scopeKey(scope) });
  const own = snapshot.claims.find((row) => !terminal(row) && row.order_id === String(order._id));
  if (own && (!sameTable || own.state !== 'submitting' || capacityChanging(own)))
    fail('The seating group changed. Refresh this order.', 409);
  if (order.seating_request_id && !own) fail('The seating group changed. Refresh this order.', 409);
  const table =
    own ||
    (await db.collection('tableorder').findOne({
      branch_id: scope.branchId,
      license: scope.license,
      tableorder_value: destination,
    }));
  if (!table) return null;
  const tables = own ? own.tables : [String(table._id)];
  const labels = own ? own.labels : [destination];
  const overlaps = snapshot.claims.filter(
    (row) => !terminal(row) && row.tables.some((id) => tables.includes(id))
  );
  if (overlaps.some(capacityChanging)) fail('This order is being updated. Please retry.', 409);
  const occupants = await db
    .collection('sales')
    .find(
      {
        branch_id: scope.branchId,
        license: scope.license,
        ...require('../helpers/floor-eligibility').floorEligibility(),
        table_number: { $in: labels },
      },
      { projection: { _id: 1, person_count: 1 } }
    )
    .toArray();
  if (!details.accommodates(table, extra + occupiedGuests(overlaps, occupants)))
    fail('Choose a table with enough seats.', 409);
  const id = 'cover-edit-' + require('node:crypto').randomUUID();
  const claim = {
    id,
    actor: 'legacy-edit',
    kind: 'legacy-edit',
    state: 'reserved',
    tables,
    labels,
    primary: own ? own.primary : String(table._id),
    guests: extra,
    edit_order: String(order._id),
    edit_revision: order.seating_capacity_revision ?? null,
    edit_revision_missing: order.seating_capacity_revision === undefined,
    expires_at: new Date(now.getTime() + 5 * 60000),
  };
  const saved = await store(db).updateOne(
    { _id: scopeKey(scope), revision: snapshot.revision },
    {
      $push: { claims: claim },
      $inc: { revision: 1 },
    }
  );
  if (!saved.matchedCount) fail('Table changed. Refresh and try again.', 409);
  return claim;
}

async function reconcileEditCapacity(db, scope, id, { deferBusy = false } = {}) {
  const claim = (await read(db, scope)).find((row) => row.id === id && row.kind === 'legacy-edit');
  if (!claim || terminal(claim)) return;
  // Never free seats just because time elapsed. First make the old writer's
  // atomic revision condition impossible. If it already committed, its new
  // revision wins; its actual covers are then counted instead of this claim.
  await db.collection('sales').updateOne(
    {
      _id: new ObjectId(claim.edit_order),
      branch_id: scope.branchId,
      license: scope.license,
      captain_payment_plan: { $exists: false },
      seating_capacity_revision: claim.edit_revision_missing
        ? { $exists: false }
        : claim.edit_revision,
    },
    { $set: { seating_capacity_revision: 'cancelled-' + claim.id } }
  );
  const current = await db.collection('sales').findOne(
    {
      _id: new ObjectId(claim.edit_order),
      branch_id: scope.branchId,
      license: scope.license,
    },
    { projection: { seating_capacity_revision: 1 } }
  );
  if (
    current &&
    (claim.edit_revision_missing
      ? current.seating_capacity_revision === undefined
      : current.seating_capacity_revision === claim.edit_revision)
  ) {
    // A recovery sweep must not block the durable operation holding this sale
    // from resuming. Keep its seats reserved until that operation releases it.
    if (deferBusy) return;
    fail('This order is being updated. Please retry.', 409);
  }
  await store(db).updateOne(
    {
      _id: scopeKey(scope),
      claims: { $elemMatch: { id, kind: 'legacy-edit', state: 'reserved' } },
    },
    { $pull: { claims: { id, kind: 'legacy-edit' } }, $inc: { revision: 1 } }
  );
}

async function reconcileExpiredEditCapacity(db, scope, now = new Date()) {
  for (const claim of await read(db, scope)) {
    if (claim.kind === 'legacy-edit' && !terminal(claim) && new Date(claim.expires_at) <= now)
      await reconcileEditCapacity(db, scope, claim.id, { deferBusy: true });
  }
}

module.exports = {
  reserveEditCapacity,
  reconcileEditCapacity,
  reconcileExpiredEditCapacity,
  releaseTransferredLegacy,
  enrollExisting,
  changeGuests,
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
