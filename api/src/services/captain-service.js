'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { rounds } = require('../helpers/kitchen-rounds');
const serviceLine = require('../utils/service-line');
const orderLine = require('../utils/order-line');
async function scope(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req);
  if (String(req.body.branchId) !== String(c.branchId)) fail('Choose the authorized branch.', 403);
  if (!ObjectId.isValid(String(req.body.saleId))) fail('Choose an order.');
  return {
    ...c,
    filter: {
      _id: new ObjectId(String(req.body.saleId)),
      branch_id: c.branchId,
      license: c.license,
      sale_process: 'KOT',
      payment_status: { $nin: ['Paid', 'Cancelled'] },
      order_state: { $nin: ['pending', 'rejected', 'cancelled'] },
    },
  };
}
async function fire(req) {
  const c = await scope(req),
    body = req.body;
  if (
    typeof body.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId) ||
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 200 ||
    body.items.some((id) => typeof id !== 'string')
  )
    fail('Choose the held items to send.');
  const collection = req.db.collection('sales');
  const sale = await collection.findOne(c.filter);
  if (!sale) fail('Open order not found.', 404);
  if ((sale.changes || []).some((change) => change.request_id === body.requestId))
    return rounds(sale);
  const current = rounds(sale).flatMap((round) => round.items);
  const selected = [...new Set(body.items)].map((id) => current.find((line) => line.id === id));
  if (selected.some((line) => !line))
    fail('Order changed. Refresh before sending this course.', 409);
  const held = selected.filter((line) => line.held && line.remaining > 0);
  if (!held.length) return rounds(sale);
  const now = new Date();
  const change = {
    timestamp: now,
    request_id: body.requestId,
    actor: String(req.user.id || req.user._id),
    action: 'fire',
    items: held.map((line) => ({
      ...serviceLine.metadata(line),
      held: false,
      item_id: line.product,
      item_name: line.name,
      item_quantity: line.remaining,
      item_description: line.note,
      spice_level: line.spice_level,
      process: 'fire',
      source_round_line: line.id,
    })),
  };
  const firedKeys = new Set(held.map((line) => line.line_key));
  const items = sale.items.map((line) =>
    firedKeys.has(orderLine.key(line)) ? { ...line, held: false } : line
  );
  const changes = [...(sale.changes || []), change];
  const updated = await collection.updateOne(
    {
      ...c.filter,
      items: sale.items,
      changes: sale.changes === undefined ? { $exists: false } : sale.changes,
      captain_payment_plan: { $exists: false },
    },
    { $set: { items, changes, updated_date: now } }
  );
  if (!updated.matchedCount) fail('Order changed. Refresh before sending this course.', 409);
  require('../helpers/kot-notify').notifyKotReady({
    branchId: String(c.branchId),
    saleId: String(sale._id),
    reason: 'updated',
    table: sale.table_number,
    items: change.items,
    revision: changes.length,
  });
  return rounds({ ...sale, items, changes });
}
async function staff(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req);
  const users = await req.db
    .collection('users')
    .find(
      {
        license: c.license,
        activate: true,
        $or: [{ branch_id: c.branchId }, { 'branch_access.branch_id': c.branchId }],
      },
      { projection: { _id: 1, name: 1, username: 1, usertype: 1, role: 1, access: 1 } }
    )
    .limit(500)
    .toArray();
  return users
    .filter((user) => allowed(user, 'sales'))
    .map((user) => ({ id: String(user._id), name: String(user.name || user.username || '') }));
}
async function handover(req) {
  const c = await scope(req),
    body = req.body;
  if (
    !ObjectId.isValid(String(body.staffId)) ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId || '')
  )
    fail('Choose a staff member.');
  const selected = (await staff(req)).find((user) => user.id === String(body.staffId));
  if (!selected) fail('Choose an active staff member in this branch.', 403);
  const collection = req.db.collection('sales'),
    sale = await collection.findOne(c.filter);
  if (!sale) fail('Open order not found.', 404);
  if ((sale.captain_audit || []).some((entry) => entry.request_id === body.requestId))
    return { staff: sale.assigned_staff };
  const actor = String(req.user._id || req.user.id),
    current = String(sale.assigned_staff?.id || sale.client?.staff_id || '');
  const manager = [
    'owner',
    'admin',
    'super_admin',
    'superadmin',
    'manager',
    'store_manager',
  ].includes(String(req.user.usertype || req.user.role).toLowerCase());
  if (!manager && current !== actor && !(current === '' && selected.id === actor))
    fail('Ask the assigned staff member or manager to hand over this order.', 403);
  const assigned_staff = { ...selected, at: new Date(), by: actor };
  const result = await collection.updateOne(
    {
      ...c.filter,
      assigned_staff: sale.assigned_staff === undefined ? { $exists: false } : sale.assigned_staff,
    },
    {
      $set: { assigned_staff },
      $push: {
        captain_audit: {
          action: 'handover',
          request_id: body.requestId,
          at: new Date(),
          actor: { id: actor, name: String(req.user.name || req.user.username || '') },
          from: current,
          to: selected,
        },
      },
    }
  );
  if (!result.matchedCount) fail('Order changed. Please refresh.', 409);
  return { staff: assigned_staff };
}
module.exports = { fire, scope, staff, handover };
