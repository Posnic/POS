'use strict';
const inventoryEnabled = require('../utils/mobile-inventory-policy');

// Inventory uses the existing item balance and stocklogs. The effect marker is
// written atomically with the balance, so a retry cannot apply a line twice.
const { ObjectId } = require('mongodb');
const mobile = require('./mobile-pos');
const { withBranchScope } = require('./branch-scope');
const modes = ['count', 'receive', 'damage', 'loss'];
const maxLines = 200;
const milli = (v) => Math.round(Number(v) * 1000);
const oid = (v) => {
  if (typeof v !== 'string' || !/^[a-f0-9]{24}$/i.test(v))
    mobile.fail('Invalid item identity.', 400);
  return new ObjectId(v);
};
const revision = (row) =>
  mobile.hash(
    mobile.canonical({
      quantity: row.available_quantity ?? 0,
      updated: row.updated_date ?? null,
      effects: row.mobile_effects || {},
      inventory: row.inventory_effects || {},
    })
  );
const wall = (c) => ({ license: c.license, branch_id: c.branchId });
async function access(req, write = false) {
  const c = await mobile.context(req, Boolean(req.handsetDevice));
  if (req.handsetDevice && !inventoryEnabled(c.branch))
    mobile.fail('Enable mobile inventory in Core Settings → Inventory → Mobile inventory.', 403);
  if (write && req.handsetDevice) {
    const scope = req.body?.scope;
    if (
      !scope ||
      scope.shopId !== c.shopId ||
      scope.branchId !== String(c.branchId) ||
      scope.staffId !== String(c.userId)
    )
      mobile.fail('Inventory request belongs to another signed-in shop or staff member.', 409);
  }
  if (
    !mobile.allowed(req.user, 'item', 'read') ||
    (write && !mobile.allowed(req.user, 'item', 'write'))
  )
    mobile.fail('Inventory access is required.', 403);
  return c;
}
function permissions(req, c) {
  return {
    read: mobile.allowed(req.user, 'item', 'read'),
    write: mobile.allowed(req.user, 'item', 'write'),
    approvalActions: (c.branch.inventory_policy?.approvalActions || []).filter((v) =>
      modes.includes(v)
    ),
  };
}
function item(row) {
  const quantity = milli(row.available_quantity || 0);
  return {
    ...mobile.mapItem(row, { decimal: true }),
    unit: String(row.unit || ''),
    tracked: row.track_inventory === true || row.track_inventory === 'true',
    quantity: Number.isSafeInteger(quantity) ? quantity : null,
    revision: revision(row),
    categoryId: String(row.category_id || ''),
    supplierId: String(row.supplier_id || ''),
    supplierName: String(row.supplier_name || ''),
    sku: String(row.sku || row.item_code || row.itemid || ''),
    availableForSale: row.available_for_sale !== false,
    availabilityRevision: row.availability_revision || '',
    minimum: Number(row.reorder_point || 0),
    expires: row.items_expiry_date || null,
  };
}
async function catalogue(req) {
  const c = await access(req);
  const kind = req.query?.kind || 'items';
  if (!['items', 'categories', 'suppliers'].includes(kind)) mobile.fail('Invalid catalogue.', 400);
  if (kind === 'suppliers' && !mobile.allowed(req.user, 'supplier', 'read'))
    mobile.fail('Supplier access is required.', 403);
  const filter = kind === 'items' ? wall(c) : withBranchScope({ license: c.license }, c.branchId);
  filter.is_deleted = { $ne: true };
  filter.del_status = { $nin: [1, '1', true] };
  if (req.query?.after) filter._id = { $gt: oid(req.query.after) };
  const q = String(req.query?.q || '')
    .trim()
    .slice(0, 100);
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { itemid: { $regex: escaped, $options: 'i' } },
      { name: { $regex: escaped, $options: 'i' } },
      ...(kind === 'items' ? [{ stock_locations: { $regex: escaped, $options: 'i' } }] : []),
      { barcode_id: q },
      { barcodes: q },
      { plu_code: q },
      { sku: q },
    ];
  }
  if (kind === 'items' && req.query?.category) filter.category_id = oid(req.query.category);
  if (kind === 'items' && req.query?.tracked === 'true')
    filter.track_inventory = { $in: [true, 'true'] };
  const limit = req.query?.limit === '25' ? 25 : 200;
  if (kind === 'items' && req.query?.barcode) {
    const barcode = String(req.query.barcode).trim().slice(0, 512);
    filter.$or = [{ barcode_id: barcode }, { barcodes: barcode }];
  }
  const projection =
    kind === 'items'
      ? undefined
      : { name: 1, category_name: 1, supplier_name: 1, status: 1, sort_order: 1 };
  const rows = await req.db
    .collection(kind)
    .find(filter, { projection })
    .sort({ _id: 1 })
    .limit(limit + 1)
    .toArray();
  const page = rows.slice(0, limit);
  return {
    shopId: c.shopId,
    branchId: String(c.branchId),
    staffId: String(c.userId),
    permissions: permissions(req, c),
    asOf: new Date().toISOString(),
    rows:
      kind === 'items'
        ? page.map(item)
        : page.map((r) => ({
            id: String(r._id),
            name: String(r.name || r.category_name || r.supplier_name || ''),
            active: r.status !== 'inactive',
            sortOrder: Number(r.sort_order) || 0,
          })),
    next: rows.length > limit ? String(page.at(-1)._id) : null,
  };
}
async function history(req) {
  const c = await access(req);
  const itemId = oid(req.params?.id);
  const product = await req.db.collection('items').findOne({ _id: itemId, ...wall(c) });
  if (!product) mobile.fail('Item not found in this branch.', 404);
  const filter = { ...wall(c), view_item_id: itemId };
  if (req.query?.before) {
    const [date, id] = String(req.query.before).split('|');
    const at = new Date(date);
    if (!Number.isFinite(+at)) mobile.fail('Invalid history cursor.', 400);
    filter.$or = [{ created_date: { $lt: at } }, { created_date: at, _id: { $lt: oid(id) } }];
  }
  const rows = await req.db
    .collection('stocklogs')
    .find(filter)
    .sort({ created_date: -1, _id: -1 })
    .limit(51)
    .toArray();
  const page = rows.slice(0, 50);
  return {
    rows: page.map((r) => ({
      id: String(r._id),
      at: r.created_date || r.date || null,
      reason: String(r.process || ''),
      note: String(r.note || ''),
      opening: String(r.opening_balance ?? ''),
      closing: String(r.closing_balance ?? ''),
      quantity: String(r.count ?? ''),
      actor: String(r.changed_by || ''),
    })),
    next:
      rows.length > 50
        ? new Date(page.at(-1).created_date).toISOString() + '|' + String(page.at(-1)._id)
        : null,
  };
}
function validate(body) {
  if (
    !body ||
    typeof body.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{12,80}$/.test(body.id) ||
    !modes.includes(body.mode)
  )
    mobile.fail('Invalid inventory operation.', 400);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > maxLines)
    mobile.fail('Use between 1 and 200 inventory lines.', 400);
  const seen = new Set();
  for (const line of body.lines) {
    if (!line || typeof line !== 'object') mobile.fail('Invalid inventory line.', 400);
    const itemId = String(oid(line.itemId));
    if (
      seen.has(itemId) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 0 ||
      line.quantity > 999999999 ||
      (body.mode !== 'count' && line.quantity === 0) ||
      (body.mode === 'count' && !/^[a-f0-9]{64}$/.test(line.revision || ''))
    )
      mobile.fail('Invalid or duplicate inventory line.', 400);
    if (
      line.reason !== undefined &&
      (typeof line.reason !== 'string' || !line.reason.trim() || line.reason.length > 500)
    )
      mobile.fail('Enter a reason of 1 to 500 characters for each changed item.', 400);
    seen.add(itemId);
  }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500)
    mobile.fail('An inventory reason is required.', 400);
  return {
    id: body.id,
    mode: body.mode,
    reason: body.reason.trim(),
    lines: body.lines.map((l) => ({
      itemId: String(oid(l.itemId)),
      quantity: l.quantity,
      reason: l.reason?.trim() || body.reason.trim(),
      ...(body.mode === 'count' ? { revision: l.revision } : {}),
    })),
  };
}
function key(c, user, operation) {
  return mobile.hash([String(c.license), String(c.branchId), String(user), operation].join(':'));
}
function result(doc) {
  return {
    id: doc.clientId,
    operationId: doc._id,
    mode: doc.mode,
    state: doc.state,
    reason: doc.reason,
    createdAt: doc.createdAt,
    actor: doc.actor,
    conflicts: doc.conflicts || [],
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      quantity: l.quantity,
      expected: l.expected,
      reason: l.reason || doc.reason,
      ...(doc.results?.[l.itemId] || {}),
    })),
    applied: doc.applied || [],
    approvalRequired: doc.approvalRequired,
    cancellation: doc.cancellation || null,
  };
}
async function prepare(req, deps = {}) {
  const c = await access(req, true);
  const body = validate(req.body);
  const operations = req.db.collection('inventory_operations');
  const operationUser = deps.operationUserId || c.userId;
  const _id = key(c, operationUser, body.id),
    payloadHash = mobile.hash(mobile.canonical(body));
  const old = await operations.findOne({ _id, ...wall(c) });
  if (old) {
    if (old.payloadHash !== payloadHash)
      mobile.fail('This operation identity already has different contents.', 409);
    return result(old);
  }
  const lines = [];
  for (const line of body.lines) {
    const row = await req.db.collection('items').findOne({
      _id: oid(line.itemId),
      ...wall(c),
      is_deleted: { $ne: true },
      del_status: { $nin: [1, '1', true] },
    });
    if (!row || ![true, 'true'].includes(row.track_inventory))
      mobile.fail('Item is unavailable for stock operations.', 409);
    const expected = milli(row.available_quantity || 0);
    if (
      !Number.isSafeInteger(expected) ||
      Math.abs(Number(row.available_quantity || 0) * 1000 - expected) > 0.000001
    )
      mobile.fail('Item quantity needs correction on the till.', 409);
    if (body.mode === 'count' && line.revision !== revision(row))
      mobile.fail('Stock changed. Refresh and recount this item.', 409);
    if (![true, 'true', 1, '1'].includes(row.item_weight_machine_based) && line.quantity % 1000)
      mobile.fail('This item requires a whole quantity.', 400);
    lines.push({
      ...line,
      name: String(row.name || ''),
      expected,
      original: row.available_quantity ?? 0,
      originalMissing: row.available_quantity === undefined,
      updated: row.updated_date ?? null,
      stockRevision: row.inventory_revision ?? null,
    });
  }
  const doc = {
    _id,
    ...wall(c),
    clientId: body.id,
    payloadHash,
    mode: body.mode,
    reason: body.reason,
    userId: operationUser,
    actor: String(req.user.username || ''),
    createdAt: new Date(),
    lines,
    approvalRequired:
      deps.requireApproval === true || permissions(req, c).approvalActions.includes(body.mode),
    ...(deps.spoilageReference ? { spoilageReference: deps.spoilageReference } : {}),
    state: 'prepared',
    applied: [],
  };
  try {
    await operations.insertOne(doc);
  } catch (e) {
    if (e.code !== 11000) throw e;
  }
  const saved = await operations.findOne({ _id, ...wall(c) });
  if (saved.payloadHash !== payloadHash) mobile.fail('Operation identity conflict.', 409);
  return result(saved);
}
async function operation(req, write = false) {
  const c = await access(req, write);
  const identity = String(req.params?.id || '');
  if (!/^[a-f0-9]{64}$/.test(identity)) mobile.fail('Inventory operation not found.', 404);
  const doc = await req.db
    .collection('inventory_operations')
    .findOne({ _id: identity, ...wall(c) });
  if (!doc) mobile.fail('Inventory operation not found.', 404);
  return { c, doc };
}
async function get(req) {
  const { c, doc } = await operation(req);
  const manager = ['owner', 'admin', 'super_admin'].includes(
    String(req.user.usertype || req.user.role).toLowerCase()
  );
  return {
    ...result(doc),
    canRecount:
      doc.mode === 'count' &&
      doc.state === 'conflict' &&
      mobile.allowed(req.user, 'item', 'write') &&
      !doc.spoilageReference,
    canCancel:
      ['prepared', 'conflict'].includes(doc.state) &&
      mobile.allowed(req.user, 'item', 'write') &&
      !doc.spoilageReference &&
      (manager || String(doc.userId) === String(c.userId)),
  };
}
async function requestStatus(req) {
  const c = await access(req);
  const clientId = String(req.params?.id || '');
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) mobile.fail('Invalid inventory request.', 400);
  const doc = await req.db
    .collection('inventory_operations')
    .findOne({ _id: key(c, c.userId, clientId), ...wall(c) });
  return { operation: doc ? result(doc) : null };
}
async function abandonRequest(req) {
  const c = await access(req, true);
  const clientId = String(req.params?.id || '');
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) mobile.fail('Invalid inventory request.', 400);
  const _id = key(c, c.userId, clientId),
    operations = req.db.collection('inventory_operations');
  // The tombstone closes the race where a timed-out prepare has not inserted
  // its journal yet. A plain 'not found' read is not proof it cannot arrive.
  await operations.updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        ...wall(c),
        clientId,
        userId: c.userId,
        payloadHash: null,
        mode: 'count',
        reason: 'Cancelled before confirmation',
        actor: String(req.user.username || ''),
        createdAt: new Date(),
        state: 'cancelled',
        lines: [],
        applied: [],
        approvalRequired: false,
      },
    },
    { upsert: true }
  );
  await operations.updateOne(
    { _id, ...wall(c), state: 'prepared', userId: c.userId, spoilageReference: { $exists: false } },
    { $set: { state: 'cancelled' } }
  );
  return result(await operations.findOne({ _id, ...wall(c) }));
}
async function list(req) {
  const c = await access(req);
  const filter = wall(c);
  const status = req.query?.status;
  if (status && !['attention', 'complete', 'cancelled'].includes(status))
    mobile.fail('Invalid inventory status filter.', 400);
  if (status === 'attention') filter.state = { $nin: ['complete', 'cancelled'] };
  else if (status) filter.state = status;
  if (req.query?.after) filter._id = { $gt: String(req.query.after) };
  const rows = await req.db
    .collection('inventory_operations')
    .find(filter)
    .sort({ _id: 1 })
    .limit(51)
    .toArray();
  return { rows: rows.slice(0, 50).map(result), next: rows.length > 50 ? rows[49]._id : null };
}
async function cancel(req) {
  const { c, doc } = await operation(req, true);
  if (doc.spoilageReference) mobile.fail('Use the spoilage approval workflow for this entry.', 403);
  const manager = ['owner', 'admin', 'super_admin'].includes(
    String(req.user.usertype || req.user.role).toLowerCase()
  );
  if (String(doc.userId) !== String(c.userId) && !manager)
    mobile.fail('Only the author or an administrator can cancel remaining changes.', 403);
  if (doc.state === 'cancelled') return get(req);
  if (!['prepared', 'conflict'].includes(doc.state))
    mobile.fail('This operation is processing or completed. Refresh its status.', 409);
  const reason = String(req.body?.reason || '').trim();
  if (doc.state === 'conflict' && (!reason || reason.length > 500))
    mobile.fail('Enter a cancellation reason (up to 500 characters).', 400);
  const cancelled = await req.db.collection('inventory_operations').updateOne(
    { _id: doc._id, ...wall(c), state: doc.state },
    {
      $set: {
        state: 'cancelled',
        updatedAt: new Date(),
        cancellation: {
          userId: c.userId,
          actor: String(req.user.username || ''),
          at: new Date(),
          reason: reason || 'Cancelled before confirmation',
        },
      },
    }
  );
  if (!cancelled.matchedCount)
    mobile.fail('The operation changed. Refresh before cancelling.', 409);
  return get(req);
}
async function confirm(req, deps = {}) {
  const { c, doc } = await operation(req, true);
  if (doc.spoilageReference && !deps.spoilageApproval)
    mobile.fail('Use the spoilage approval workflow for this entry.', 403);
  const operations = req.db.collection('inventory_operations');
  if (['complete', 'cancelled'].includes(doc.state)) return result(doc);
  const requiresApproval =
    doc.approvalRequired || permissions(req, c).approvalActions.includes(doc.mode);
  if (
    requiresApproval &&
    !deps.spoilageApproval &&
    !['owner', 'admin', 'super_admin'].includes(
      String(req.user.usertype || req.user.role).toLowerCase()
    )
  )
    mobile.fail('A manager must approve this operation.', 403);
  const claimed = await operations.updateOne(
    { _id: doc._id, state: { $in: ['prepared', 'applying', 'conflict'] } },
    { $set: { state: 'applying', confirmedBy: c.userId } }
  );
  if (!claimed.matchedCount) return get(req);
  const conflicts = [];
  for (const line of doc.lines) {
    const marker = 'inventory_effects.' + doc._id;
    const filter = {
      _id: oid(line.itemId),
      ...wall(c),
      is_deleted: { $ne: true },
      track_inventory: { $in: [true, 'true'] },
      del_status: { $nin: [1, '1', true] },
      [marker]: { $exists: false },
    };
    if (doc.mode === 'count')
      Object.assign(filter, {
        available_quantity: line.originalMissing ? { $exists: false } : line.original,
        updated_date: line.updated,
        inventory_revision: line.stockRevision,
      });
    const opening = {
      $convert: { input: '$available_quantity', to: 'double', onError: null, onNull: 0 },
    };
    filter.$expr = {
      $and: [
        { $ne: [opening, null] },
        { $gte: [opening, -999999999999] },
        { $lte: [opening, 999999000000] },
        { $eq: [{ $round: [opening, 3] }, opening] },
        ...(['damage', 'loss'].includes(doc.mode)
          ? [{ $gte: [opening, line.quantity / 1000] }]
          : []),
      ],
    };
    const closing =
      doc.mode === 'count'
        ? line.quantity / 1000
        : {
            $round: [
              { $add: [opening, ((doc.mode === 'receive' ? 1 : -1) * line.quantity) / 1000] },
              3,
            ],
          };
    await req.db.collection('items').updateOne(filter, [
      {
        $set: {
          available_quantity: closing,
          updated_date: '$$NOW',
          inventory_revision: { $add: [{ $ifNull: ['$inventory_revision', 0] }, 1] },
          [marker]: { opening, closing, at: '$$NOW' },
        },
      },
    ]);
    if (deps.afterEffect) await deps.afterEffect();
    const row = await req.db.collection('items').findOne({ _id: oid(line.itemId), ...wall(c) });
    const effect = row?.inventory_effects?.[doc._id];
    if (!effect) {
      conflicts.push(line.itemId);
      continue;
    }
    // Explicit tenant ownership, independent of process-global model context.
    const logId = new ObjectId(mobile.hash(doc._id + ':' + line.itemId).slice(0, 24));
    await req.db.collection('stocklogs').updateOne(
      { _id: logId },
      {
        $setOnInsert: {
          ...wall(c),
          view_item_id: row._id,
          item_name: row.name,
          item_barcode_id: row.barcode_id || '',
          process: 'Mobile inventory ' + doc.mode,
          reference: doc._id,
          ...(doc.spoilageReference ? { spoilage_reference: doc.spoilageReference } : {}),
          note: line.reason || doc.reason,
          opening_balance: effect.opening,
          closing_balance: effect.closing,
          count: String(effect.closing - effect.opening),
          action: doc.mode,
          stocklog: true,
          date: effect.at,
          created_date: effect.at,
          updated_date: effect.at,
          changed_by: doc.actor,
          changed_by_userid: doc.userId,
          confirmed_by_userid: c.userId,
        },
      },
      { upsert: true }
    );
    await operations.updateOne(
      { _id: doc._id },
      {
        $addToSet: { applied: line.itemId },
        $set: {
          ['results.' + line.itemId]: {
            actualOpening: milli(effect.opening),
            actualClosing: milli(effect.closing),
          },
        },
      }
    );
    require('../sync/outbox').enqueue({
      collection: 'items',
      documentId: row._id,
      reason: 'inventory',
    });
    require('../sync/outbox').enqueue({
      collection: 'stocklogs',
      documentId: logId,
      reason: 'inventory',
    });
  }
  await operations.updateOne(
    { _id: doc._id },
    {
      $set: { state: conflicts.length ? 'conflict' : 'complete', conflicts, updatedAt: new Date() },
    }
  );
  return get(req);
}
async function policy(req) {
  const c = await mobile.context(req, false);
  if (!mobile.allowed(req.user, 'item', 'read')) mobile.fail('Inventory access is required.', 403);
  const canManage = ['owner', 'admin', 'super_admin'].includes(
    String(req.user.usertype || req.user.role).toLowerCase()
  );
  if (req.method === 'POST') {
    if (!canManage) mobile.fail('An administrator must change inventory policy.', 403);
    const actions = req.body?.approvalActions;
    const enabled = req.body?.enabled ?? inventoryEnabled(c.branch);
    if (
      typeof enabled !== 'boolean' ||
      !Array.isArray(actions) ||
      actions.length > modes.length ||
      actions.some((v) => !modes.includes(v))
    )
      mobile.fail('Invalid inventory policy.', 400);
    await req.db.collection('branches').updateOne(
      { _id: c.branchId, license: c.license },
      {
        $set: {
          'inventory_policy.enabled': enabled,
          'inventory_policy.approvalActions': [...new Set(actions)],
          updated_date: new Date(),
        },
      }
    );
    c.branch.inventory_policy = { enabled, approvalActions: actions };
  }
  return {
    canManage,
    enabled: inventoryEnabled(c.branch),
    approvalActions: permissions(req, c).approvalActions,
  };
}
module.exports = {
  access,
  item,
  catalogue,
  history,
  prepare,
  get,
  requestStatus,
  abandonRequest,
  list,
  cancel,
  confirm,
  policy,
  revision,
  validate,
};
