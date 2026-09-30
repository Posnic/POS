'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const details = require('../utils/table-details');
const seating = require('./seating-claims');
const activeClaims = async (db, scope) =>
  (await seating.read(db, scope)).filter((claim) =>
    ['reserved', 'submitting', 'applying', 'releasing'].includes(claim.state)
  );
async function assertUnclaimed(db, scope, id) {
  if ((await activeClaims(db, scope)).some((claim) => claim.tables.includes(String(id))))
    fail('This table is part of an active seating group.', 409);
}
const active = (c) => ({
  branch_id: c.branchId,
  license: c.license,
  ...require('../helpers/floor-eligibility').floorEligibility(),
});
async function scope(req, manage = false) {
  if (!req.user || !allowed(req.user, manage ? 'settings' : 'sales'))
    fail('Permission is required.', 403);
  return context(req);
}
function view(row, orders = [], claim = null) {
  return {
    id: String(row._id),
    tableorder_value: row.tableorder_value,
    ...details.view(row),
    version: row.captain_table_version || 0,
    closing:
      row.floor_close &&
      (!row.floor_close.completed ||
        (claim?.order_id && row.floor_close.orders.includes(claim.order_id)))
        ? { request_id: row.floor_close.id, orderIds: row.floor_close.orders }
        : claim?.closing
          ? { request_id: claim.closing.id, orderIds: claim.closing.orders }
          : null,
    status: orders.length ? 'occupied' : claim ? 'held' : row.service_state || 'available',
    ...(claim
      ? {
          seating: {
            id: claim.id,
            primary_id: claim.primary,
            table_ids: claim.tables,
            labels: claim.labels,
            guests: orders.length ? orders.reduce((sum, order) => sum + (Number(order.person_count) || 0), 0) : claim.guests,
          },
        }
      : {}),
    orders: orders.map((o) => ({
      id: String(o._id),
      guests: Number(o.person_count) || 0,
      paid: o.payment_status === 'Paid',
    })),
  };
}
async function list(req) {
  const c = await scope(req);
  const [tables, orders, claims] = await Promise.all([
    req.db
      .collection('tableorder')
      .find({ branch_id: c.branchId, license: c.license })
      .sort({ tableorder_value: 1 })
      .toArray(),
    req.db
      .collection('sales')
      .find(active(c), { projection: { table_number: 1, person_count: 1, payment_status: 1 } })
      .toArray(),
    activeClaims(req.db, c),
  ]);
  return {
    canManage: allowed(req.user, 'settings'),
    canMerge: allowed(req.user, 'sales', 'merge'),
    tables: tables.map((row) => {
      const claim = claims.find((entry) => entry.tables.includes(String(row._id)));
      const primary = claim && tables.find((entry) => String(entry._id) === claim.primary);
      return view(
        primary?.floor_close ? { ...row, floor_close: primary.floor_close } : row,
        orders.filter(
          (order) =>
            String(order.table_number) === String(row.tableorder_value) ||
            (claim?.order_id && String(order._id) === claim.order_id)
        ),
        claim
      );
    }),
  };
}
async function update(req) {
  const c = await scope(req, true),
    body = req.body || {};
  const label = typeof body.tableorder_value === 'string' ? body.tableorder_value.trim() : '';
  if (!/^[A-Za-z0-9]{1,6}$/.test(label)) fail('Use up to 6 letters or numbers for the table.');
  const tables = req.db.collection('tableorder');
  await details.ensureIdentity(tables);
  if (body.id && !ObjectId.isValid(body.id)) fail('Choose a table.');
  const filter = {
    branch_id: c.branchId,
    license: c.license,
    ...(body.id ? { _id: new ObjectId(body.id) } : {}),
  };
  const previous = body.id ? await tables.findOne(filter) : null;
  if (body.id && !previous) fail('Table not found.', 404);
  if (previous) await assertUnclaimed(req.db, c, previous._id);
  if (
    previous &&
    (!Number.isSafeInteger(body.version) || body.version !== (previous.captain_table_version || 0))
  )
    fail('Table changed. Refresh and try again.', 409);
  const duplicate = await tables.findOne({
    branch_id: c.branchId,
    license: c.license,
    tableorder_value: { $regex: '^' + label + '$', $options: 'i' },
    ...(previous ? { _id: { $ne: previous._id } } : {}),
  });
  if (duplicate) fail('This table already exists.', 409);
  const openOrders = previous
    ? await req.db
        .collection('sales')
        .find(
          { ...active(c), table_number: previous.tableorder_value },
          { projection: { person_count: 1 } }
        )
        .toArray()
    : [];
  const occupied = openOrders.length;
  if (occupied && label !== previous.tableorder_value)
    fail('Close the table before renaming it.', 409);
  let metadata;
  try {
    metadata = {
      ...details.update(body, previous || {}),
      ...(await details.adjacentTables(
        tables,
        body,
        { branch_id: c.branchId, license: c.license },
        previous?._id
      )),
    };
  } catch (error) {
    fail(error.message);
  }
  const fields = {
    ...metadata,
    tableorder_value: label,
    tableorder_key: details.key(label),
    updated_date: new Date(),
    updated_by_id: req.user._id,
    updated_by: req.user.name || req.user.username || '',
  };
  if (
    occupied &&
    !details.accommodates(
      fields,
      Math.max(...openOrders.map((order) => Number(order.person_count) || 1))
    )
  )
    fail('Choose a table with enough seats.', 409);
  try {
    if (!previous) {
      fields._id = new ObjectId();
      fields.branch_id = c.branchId;
      fields.license = c.license;
      fields.created_date = new Date();
      fields.captain_table_version = 0;
      await tables.insertOne(fields);
      return view(fields);
    }
    const result = await tables.updateOne(
      {
        ...filter,
        captain_table_version:
          previous.captain_table_version === undefined
            ? { $exists: false }
            : previous.captain_table_version,
      },
      { $set: fields, $inc: { captain_table_version: 1 } }
    );
    if (!result.matchedCount) fail('Table changed. Refresh and try again.', 409);
    return view({ ...previous, ...fields, captain_table_version: body.version + 1 });
  } catch (error) {
    if (error.code === 11000) fail('This table already exists.', 409);
    throw error;
  }
}
async function state(req) {
  const c = await scope(req),
    body = req.body || {};
  if (
    !ObjectId.isValid(String(body.id)) ||
    !['available', 'cleaning', 'held'].includes(body.status)
  )
    fail('Choose a table status.');
  const filter = { _id: new ObjectId(body.id), branch_id: c.branchId, license: c.license };
  const row = await req.db.collection('tableorder').findOne(filter);
  if (!row) fail('Table not found.', 404);
  await assertUnclaimed(req.db, c, row._id);
  if (row.floor_close && !row.floor_close.completed)
    fail('Table changed. Refresh and try again.', 409);
  if (!Number.isSafeInteger(body.version) || body.version !== (row.captain_table_version || 0))
    fail('Table changed. Refresh and try again.', 409);
  if (
    await req.db
      .collection('sales')
      .countDocuments({ ...active(c), table_number: row.tableorder_value })
  )
    fail('This table has an open order.', 409);
  const changed = await req.db.collection('tableorder').updateOne(
    {
      ...filter,
      captain_table_version:
        row.captain_table_version === undefined ? { $exists: false } : row.captain_table_version,
    },
    {
      $set: { service_state: body.status, updated_date: new Date() },
      $inc: { captain_table_version: 1 },
    }
  );
  if (!changed.matchedCount) fail('Table changed. Refresh and try again.', 409);
  return view({ ...row, service_state: body.status, captain_table_version: body.version + 1 });
}
async function close(req) {
  const c = await scope(req),
    body = req.body || {};
  if (
    !ObjectId.isValid(String(body.id)) ||
    typeof body.request_id !== 'string' ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id) ||
    !Array.isArray(body.orderIds) ||
    !body.orderIds.length ||
    body.orderIds.length > 200 ||
    body.orderIds.some((id) => !ObjectId.isValid(String(id)))
  )
    fail('Choose the orders to close.');
  const ids = [...new Set(body.orderIds.map(String))].sort();
  const tables = req.db.collection('tableorder'),
    sales = req.db.collection('sales');
  const filter = { _id: new ObjectId(body.id), branch_id: c.branchId, license: c.license };
  let table = await tables.findOne(filter);
  if (!table) fail('Table not found.', 404);
  let operation = table.floor_close;
  if (operation?.id === body.request_id) {
    if (operation.failed) fail('Table changed. Refresh and try again.', 409);
    if (JSON.stringify(operation.orders) !== JSON.stringify(ids))
      fail('Table changed. Refresh and try again.', 409);
  } else {
    if (operation && !operation.completed) fail('Table changed. Refresh and try again.', 409);
    if (!Number.isSafeInteger(body.version) || body.version !== (table.captain_table_version || 0))
      fail('Table changed. Refresh and try again.', 409);
    const orders = await sales
      .find({ ...active(c), table_number: table.tableorder_value })
      .toArray();
    if (JSON.stringify(orders.map((order) => String(order._id)).sort()) !== JSON.stringify(ids))
      fail('Table changed. Refresh and try again.', 409);
    if (
      orders.some(
        (order) =>
          order.payment_status !== 'Paid' ||
          Number(order.payment_pending || 0) > 0 ||
          Number(order.balance || 0) > 0
      )
    )
      fail('Record the remaining payment first.', 409);
    await seating.beginClose(req.db, c, ids, body.request_id);
    operation = {
      id: body.request_id,
      orders: ids,
      at: new Date(),
      actor: String(req.user._id),
      completed: false,
    };
    const claimed = await tables.updateOne(
      {
        ...filter,
        captain_table_version:
          table.captain_table_version === undefined
            ? { $exists: false }
            : table.captain_table_version,
      },
      {
        $set: { floor_close: operation, service_state: 'cleaning', updated_date: new Date() },
        $inc: { captain_table_version: 1 },
      }
    );
    if (!claimed.matchedCount) fail('Table changed. Refresh and try again.', 409);
  }
  if (!operation.completed) {
    await seating.beginClose(req.db, c, ids, body.request_id);
    // The saved intent survives a lost reply or an interrupted projection.
    // Payment and stock records are never changed by floor closure.
    await sales.updateMany(
      {
        branch_id: c.branchId,
        license: c.license,
        _id: { $in: ids.map((id) => new ObjectId(id)) },
        table_number: table.tableorder_value,
        payment_status: 'Paid',
        $expr: {
          $and: ['payment_pending', 'balance'].map((field) => ({
            $lte: [
              { $convert: { input: { $ifNull: ['$' + field, 0] }, to: 'double', onError: 1 } },
              0,
            ],
          })),
        },
        floor_closed_at: { $exists: false },
      },
      {
        $set: {
          floor_closed_at: operation.at,
          floor_closed_by: operation.actor,
          kitchen_closed: true,
          updated_date: new Date(),
        },
      }
    );
    const remaining = await sales.countDocuments({
      branch_id: c.branchId,
      license: c.license,
      _id: { $in: ids.map((id) => new ObjectId(id)) },
      floor_closed_at: { $exists: false },
    });
    if (remaining) {
      // Keep the durable intent and reservation. A changed payment may leave
      // some orders open; retry must finish those rather than free the table.
      fail('Table changed. Refresh and try again.', 409);
    }
    await tables.updateOne(
      { ...filter, 'floor_close.id': body.request_id },
      { $set: { 'floor_close.completed': true, updated_date: new Date() } }
    );
    for (const id of ids) {
      try {
        require('../sync/outbox').enqueue({
          collection: 'sales',
          documentId: new ObjectId(id),
          reason: 'sale',
        });
      } catch {
        /* Periodic sync also discovers updated rows. */
      }
    }
  }
  const claims = await activeClaims(req.db, c);
  for (const claim of claims) {
    if (claim.primary === String(table._id) && ids.includes(claim.order_id))
      await seating.release(req.db, c, claim.id);
  }
  table = await tables.findOne(filter);
  const open = await sales.find({ ...active(c), table_number: table.tableorder_value }).toArray();
  return view(table, open);
}
module.exports = { list, update, state, close };
