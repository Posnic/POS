'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const details = require('../utils/table-details');
const active = (c) => ({
  branch_id: c.branchId,
  license: c.license,
  sale_process: 'KOT',
  payment_status: { $nin: ['Cancelled'] },
  order_state: { $nin: ['rejected', 'cancelled'] },
});
async function scope(req, manage = false) {
  if (!req.user || !allowed(req.user, manage ? 'settings' : 'sales'))
    fail('Permission is required.', 403);
  return context(req);
}
function view(row, orders = []) {
  return {
    id: String(row._id),
    tableorder_value: row.tableorder_value,
    ...details.view(row),
    version: row.captain_table_version || 0,
    status: orders.length ? 'occupied' : row.service_state || 'available',
    orders: orders.map((o) => ({
      id: String(o._id),
      guests: Number(o.person_count) || 0,
      paid: o.payment_status === 'Paid',
    })),
  };
}
async function list(req) {
  const c = await scope(req);
  const [tables, orders] = await Promise.all([
    req.db
      .collection('tableorder')
      .find({ branch_id: c.branchId, license: c.license })
      .sort({ tableorder_value: 1 })
      .toArray(),
    req.db
      .collection('sales')
      .find(active(c), { projection: { table_number: 1, person_count: 1, payment_status: 1 } })
      .toArray(),
  ]);
  return {
    canManage: allowed(req.user, 'settings'),
    tables: tables.map((row) =>
      view(
        row,
        orders.filter((o) => String(o.table_number) === String(row.tableorder_value))
      )
    ),
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
    metadata = details.update(body, previous || {});
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
module.exports = { list, update, state };
