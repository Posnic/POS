'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const inventory = require('./mobile-inventory');
const mobile = require('./mobile-pos');
const reasons = [
  'Transit damage',
  'Handling damage',
  'Storage issue',
  'Expired',
  'Spoilage',
  'Other',
];
const admin = (user) =>
  ['owner', 'admin', 'super_admin'].includes(String(user.usertype || user.role).toLowerCase());
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const oid = (value) => {
  if (!/^[a-f0-9]{24}$/i.test(String(value))) fail('Invalid spoilage reference.');
  return new ObjectId(String(value));
};
const wall = (c) => ({ license: c.license, branch_id: c.branchId });
const dateAt = (date, zone = 'UTC') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
function date(value) {
  const d = new Date(value + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
    !Number.isFinite(+d) ||
    d.toISOString().slice(0, 10) !== value
  )
    fail('Enter a valid date.');
  return value;
}
const canApprove = (req, c) =>
  admin(req.user) ||
  (c.branch.spoilage_approver_ids || []).some((v) => String(v) === String(c.userId));
const event = (c, req, action, note = '') => ({
  action,
  at: new Date(),
  userId: c.userId,
  user: String(req.user.username || ''),
  note,
});
async function publish(req, doc) {
  const snapshot = { ...doc };
  delete snapshot.payloadHash;
  await req.db
    .collection('spoilage_entries')
    .replaceOne({ _id: doc._id }, snapshot, { upsert: true });
  await require('../sync/outbox').enqueue({
    collection: 'spoilage_entries',
    documentId: doc._id,
    reason: 'spoilage',
  });
  return snapshot;
}
async function owned(req, write = false) {
  const c = await inventory.access(req, write),
    id = oid(req.params?.id);
  const doc = await req.db.collection('spoilage_commands').findOne({ _id: id, ...wall(c) });
  if (!doc) {
    const shared = await req.db.collection('spoilage_entries').findOne({ _id: id, ...wall(c) });
    if (shared)
      fail(
        'This entry belongs to another installation. Review it on the cloud or till where it was entered.',
        409
      );
    fail('Spoilage entry not found in this branch.', 404);
  }
  return { c, doc };
}
function view(doc, req, c, local) {
  return {
    ...doc,
    id: String(doc._id),
    canEdit: local && doc.state === 'draft' && String(doc.createdBy) === String(c.userId),
    canApprove: local && canApprove(req, c),
    canWrite: local && mobile.allowed(req.user, 'item', 'write'),
    local,
  };
}
async function get(req) {
  const c = await inventory.access(req),
    id = oid(req.params?.id);
  if (req.query?.view === 'audit') {
    const filter = { _id: id, ...wall(c) };
    const options = { projection: { audit: 1 } };
    const record =
      (await req.db.collection('spoilage_commands').findOne(filter, options)) ||
      (await req.db.collection('spoilage_entries').findOne(filter, options));
    if (!record) fail('Spoilage entry not found.', 404);
    return { id: String(record._id), audit: record.audit || [] };
  }
  const local = await req.db.collection('spoilage_commands').findOne({ _id: id, ...wall(c) });
  // Repair a crash between completing a reversal and publishing its parent.
  if (local?.kind === 'reversal' && local.state === 'accepted') {
    const commands = req.db.collection('spoilage_commands');
    await commands.updateOne(
      { _id: local.reversalOf, ...wall(c), state: 'reversal_pending' },
      {
        $set: { state: 'reversed', reversedBy: local._id, updated_date: new Date() },
        $push: {
          audit: {
            action: 'Reversal completed',
            at: local.decisionAt,
            userId: local.decisionBy,
            user: local.decisionByName,
            note: local.reference,
          },
        },
      }
    );
    const parent = await commands.findOne({ _id: local.reversalOf, ...wall(c) });
    if (parent) await publish(req, parent);
  }
  const doc = local
    ? await publish(req, local)
    : await req.db.collection('spoilage_entries').findOne({ _id: id, ...wall(c) });
  if (!doc) fail('Spoilage entry not found.', 404);
  const result = view(doc, req, c, !!local);
  if (req.query?.view === 'details') delete result.audit;
  return result;
}
async function lines(req, c, input) {
  if (!Array.isArray(input) || !input.length || input.length > 200) fail('Add 1 to 200 products.');
  const seen = new Set(),
    result = [];
  for (const l of input) {
    const id = oid(l.itemId),
      key = String(id);
    if (seen.has(key)) fail('Each product may appear only once.');
    seen.add(key);
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0 || l.quantity > 999999999)
      fail('Enter a positive quantity with up to three decimals.');
    if (!reasons.includes(l.reason)) fail('Choose a spoilage reason.');
    if (l.remarks != null && (typeof l.remarks !== 'string' || l.remarks.length > 500))
      fail('Remarks must be at most 500 characters.');
    const remarks = (l.remarks || '').trim();
    const item = await req.db.collection('items').findOne({
      _id: id,
      ...wall(c),
      is_deleted: { $ne: true },
      del_status: { $nin: [1, '1', true] },
      track_inventory: { $in: [true, 'true'] },
    });
    if (!item) fail('Product is unavailable in this branch.', 409);
    const available = Math.round(Number(item.available_quantity || 0) * 1000);
    if (!Number.isSafeInteger(available) || l.quantity > available)
      fail('Spoiled quantity exceeds available stock for ' + item.name + '.', 409);
    if (![true, 'true', 1, '1'].includes(item.item_weight_machine_based) && l.quantity % 1000)
      fail(item.name + ' requires a whole quantity.');
    const raw = item.company_price ?? item.cost_price ?? item.purchase_price;
    const cost =
      raw !== undefined &&
      raw !== null &&
      raw !== '' &&
      Number.isFinite(Number(raw)) &&
      Number(raw) >= 0 &&
      Number(raw) <= 999999999
        ? Number(raw)
        : null;
    result.push({
      itemId: key,
      name: String(item.name || ''),
      sku: String(item.itemid || item.sku || ''),
      unit: String(item.unit || ''),
      quantity: l.quantity,
      available,
      reason: l.reason,
      remarks: remarks,
      unitCost: cost,
      estimatedValue: cost === null ? null : Math.round(((cost * l.quantity) / 1000) * 100) / 100,
    });
  }
  return result;
}
async function save(req) {
  const c = await inventory.access(req, true),
    b = req.body || {};
  if (!/^[\w-]{12,80}$/.test(b.clientId || '')) fail('Invalid request identity.');
  const id = new ObjectId(
    crypto
      .createHash('sha256')
      .update([c.license, c.branchId, c.userId, b.clientId].join(':'))
      .digest('hex')
      .slice(0, 24)
  );
  const occurredOn = date(b.occurredOn),
    today = dateAt(new Date(), c.branch.time_zone || 'UTC');
  if (occurredOn > today) fail('Spoilage date cannot be in the future.');
  const payloadHash = mobile.hash(mobile.canonical({ occurredOn, lines: b.lines }));
  const coll = req.db.collection('spoilage_commands'),
    old = await coll.findOne({ _id: id, ...wall(c) });
  if (old && old.payloadHash === payloadHash) {
    await publish(req, old);
    return get({ ...req, params: { id: String(id) } });
  }
  if (old && (old.state !== 'draft' || old.revision !== b.revision))
    fail('This entry changed or was submitted. Refresh before editing.', 409);
  const items = await lines(req, c, b.lines),
    now = new Date();
  let doc;
  if (old) {
    const changed = await coll.updateOne(
      { _id: id, state: 'draft', revision: b.revision },
      {
        $set: { lines: items, occurredOn, payloadHash, updated_date: now },
        $inc: { revision: 1 },
        $push: { audit: event(c, req, 'Edited') },
      }
    );
    if (!changed.matchedCount) fail('Entry changed. Refresh and retry.', 409);
    doc = await coll.findOne({ _id: id });
  } else {
    doc = {
      _id: id,
      ...wall(c),
      clientId: b.clientId,
      reference: 'SP-' + occurredOn.replaceAll('-', '') + '-' + String(id).slice(-10).toUpperCase(),
      kind: 'spoilage',
      state: 'draft',
      revision: 1,
      occurredOn,
      createdBy: c.userId,
      createdByName: String(req.user.username || ''),
      created_date: now,
      updated_date: now,
      payloadHash,
      lines: items,
      audit: [event(c, req, 'Created')],
      origin: process.env.POSNIC_DESKTOP === '1' ? 'Desktop' : 'Cloud',
    };
    try {
      await coll.insertOne(doc);
    } catch (e) {
      if (e.code !== 11000) throw e;
      fail('Entry already exists. Refresh and retry.', 409);
    }
  }
  await publish(req, doc);
  return get({ ...req, params: { id: String(id) } });
}
async function submit(req) {
  const { c, doc } = await owned(req, true);
  if (String(doc.createdBy) !== String(c.userId))
    fail('Only the author can submit this entry.', 403);
  if (doc.state === 'pending') return get(req);
  if (doc.state !== 'draft' || req.body?.revision !== doc.revision)
    fail('Refresh the draft before submitting.', 409);
  if (doc.kind !== 'reversal') await lines(req, c, doc.lines);
  await req.db.collection('spoilage_commands').updateOne(
    { _id: doc._id, state: 'draft', revision: doc.revision },
    {
      $set: { state: 'pending', updated_date: new Date() },
      $inc: { revision: 1 },
      $push: { audit: event(c, req, 'Submitted') },
    }
  );
  return get(req);
}
async function decide(req, immediate = false) {
  const { c, doc } = await owned(req, true),
    decision = req.body?.decision;
  if (!immediate && !canApprove(req, c))
    fail('An authorised spoilage approver must review this entry.', 403);
  if (!['accept', 'reject'].includes(decision)) fail('Choose Accept or Reject.');
  if (['accepted', 'rejected', 'reversed'].includes(doc.state)) return get(req);
  const note = String(req.body?.note || '').trim();
  if (note.length > 500) fail('Decision remarks must be at most 500 characters.');
  const coll = req.db.collection('spoilage_commands');
  if (decision === 'reject') {
    if (!note) fail('Enter a reason for rejection.');
    const changed = await coll.updateOne(
      { _id: doc._id, state: 'pending' },
      {
        $set: {
          state: 'rejected',
          decisionBy: c.userId,
          decisionByName: String(req.user.username || ''),
          decisionAt: new Date(),
          updated_date: new Date(),
        },
        $inc: { revision: 1 },
        $push: { audit: event(c, req, 'Rejected', note) },
      }
    );
    if (!changed.matchedCount)
      fail(
        'Only a pending entry can be rejected. Applied stock requires an approved reversal.',
        409
      );
    if (doc.kind === 'reversal') {
      await coll.updateOne(
        { _id: doc.reversalOf, ...wall(c), state: 'reversal_pending' },
        {
          $set: { state: doc.priorState || 'accepted', updated_date: new Date() },
          $push: { audit: event(c, req, 'Reversal rejected', note) },
        }
      );
      const parent = await coll.findOne({ _id: doc.reversalOf, ...wall(c) });
      if (parent) await publish(req, parent);
    }
    return get(req);
  }
  if (!['pending', 'approving', 'conflict'].includes(doc.state))
    fail('Submit this draft for approval first.', 409);
  const claimed = await coll.updateOne(
    { _id: doc._id, state: { $in: ['pending', 'approving', 'conflict'] } },
    { $set: { state: 'approving', updated_date: new Date() } }
  );
  if (!claimed.matchedCount) return get(req);
  try {
    const operation = await inventory.prepare(
      {
        ...req,
        body: {
          id: 'spoilage-' + doc._id,
          mode: doc.kind === 'reversal' ? 'receive' : 'damage',
          reason: doc.reference,
          lines: doc.lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            reason: (l.reason + (l.remarks ? ': ' + l.remarks : '')).slice(0, 500),
          })),
        },
      },
      { operationUserId: doc.createdBy, requireApproval: true, spoilageReference: String(doc._id) }
    );
    const applied = await inventory.confirm(
      { ...req, params: { id: operation.operationId } },
      { spoilageApproval: true }
    );
    const state = applied.state === 'complete' ? 'accepted' : 'conflict';
    const update = await coll.updateOne(
      { _id: doc._id, state: { $in: ['approving', 'conflict'] } },
      {
        $set: {
          state,
          operationId: operation.operationId,
          results: applied.lines,
          applied: applied.applied,
          conflicts: applied.conflicts,
          decisionBy: c.userId,
          decisionByName: String(req.user.username || ''),
          decisionAt: new Date(),
          updated_date: new Date(),
        },
        $inc: { revision: 1 },
        $push: {
          audit: event(
            c,
            req,
            state === 'accepted' ? (immediate ? 'Saved' : 'Accepted') : 'Stock conflict',
            note
          ),
        },
      }
    );
    if (state === 'accepted' && doc.kind === 'reversal') {
      await coll.updateOne(
        { _id: doc.reversalOf, ...wall(c), state: 'reversal_pending' },
        {
          $set: { state: 'reversed', reversedBy: doc._id, updated_date: new Date() },
          $push: { audit: event(c, req, 'Reversed', doc.reference) },
        }
      );
      const original = await coll.findOne({ _id: doc.reversalOf, ...wall(c) });
      if (original) await publish(req, original);
    }
    return get(req);
  } catch (e) {
    await coll.updateOne(
      { _id: doc._id, state: 'approving' },
      { $set: { state: 'conflict', lastError: e.message, updated_date: new Date() } }
    );
    await get(req);
    throw e;
  }
}
async function reverse(req, immediate = false) {
  const { c, doc } = await owned(req, true);
  if (!immediate && !canApprove(req, c))
    fail('Only an authorised approver can request a reversal.', 403);
  if (
    doc.kind === 'reversal' ||
    !['accepted', 'conflict', 'reversed', 'reversal_pending'].includes(doc.state) ||
    !doc.applied?.length
  )
    fail('Only applied spoilage can be reversed.', 409);
  const note = String(req.body?.note || '').trim();
  if (!note || note.length > 500) fail('Enter the reason for this reversal.');
  const id = new ObjectId(
    crypto
      .createHash('sha256')
      .update('spoilage-reversal:' + doc._id)
      .digest('hex')
      .slice(0, 24)
  );
  const now = new Date(),
    coll = req.db.collection('spoilage_commands');
  const existing = await coll.findOne({ _id: id, ...wall(c) });
  if (existing && existing.state !== 'rejected') return get({ ...req, params: { id: String(id) } });
  const priorState =
    doc.state === 'reversal_pending' ? doc.reversalPriorState || 'accepted' : doc.state;
  const locked = await coll.updateOne(
    { _id: doc._id, state: { $in: ['accepted', 'conflict', 'reversal_pending'] } },
    { $set: { state: 'reversal_pending', reversalPriorState: priorState, updated_date: now } }
  );
  if (!locked.matchedCount) fail('The original entry changed. Refresh before reversing.', 409);
  const reversal = {
    _id: id,
    ...wall(c),
    reference: 'RV-' + doc.reference,
    kind: 'reversal',
    state: 'pending',
    revision: 1,
    reversalOf: doc._id,
    priorState,
    occurredOn: dateAt(now, c.branch.time_zone || 'UTC'),
    createdBy: c.userId,
    createdByName: String(req.user.username || ''),
    created_date: now,
    updated_date: now,
    origin: doc.origin,
    lines: doc.lines
      .filter((l) => doc.applied.includes(l.itemId))
      .map((l) => ({ ...l, reason: 'Reversal', remarks: note })),
    audit: [event(c, req, 'Reversal requested', note)],
  };
  await coll.updateOne({ _id: id }, { $setOnInsert: reversal }, { upsert: true });
  if (existing?.state === 'rejected')
    await coll.updateOne(
      { _id: id, state: 'rejected' },
      {
        $set: { state: 'pending', updated_date: now },
        $push: { audit: event(c, req, 'Reversal requested again', note) },
      }
    );
  await publish(req, await coll.findOne({ _id: doc._id, ...wall(c) }));
  return get({ ...req, params: { id: String(id) } });
}
// Immediate stock recording uses the same idempotent journal, with normal item-write
// permission checked by owned/access. This flag is internal, never read from input.
async function applyNow(req) {
  const current = await get(req);
  if (current.state === 'draft') await submit({ ...req, body: { revision: current.revision } });
  return decide({ ...req, body: { decision: 'accept' } }, true);
}
async function record(req) {
  const saved = await save(req);
  return applyNow({ ...req, params: { id: saved.id } });
}
async function undo(req) {
  const reversal = await reverse(req, true);
  return decide(
    { ...req, params: { id: reversal.id }, body: { decision: 'accept', note: req.body?.note } },
    true
  );
}
function filters(query, c) {
  const filter = wall(c);
  if (query.from || query.to) {
    filter.occurredOn = {};
    if (query.from) filter.occurredOn.$gte = date(query.from);
    if (query.to) filter.occurredOn.$lte = date(query.to);
    if (query.from && query.to && query.from > query.to) fail('End date must follow start date.');
  }
  if (query.status) {
    if (
      ![
        'draft',
        'pending',
        'approving',
        'accepted',
        'rejected',
        'conflict',
        'reversed',
        'reversal_pending',
      ].includes(query.status)
    )
      fail('Invalid status.');
    filter.state = query.status;
  }
  if (query.item) filter['lines.itemId'] = String(oid(query.item));
  const q = String(query.q || '')
    .trim()
    .slice(0, 100);
  if (q) {
    const re = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { 'lines.name': { $regex: re, $options: 'i' } },
      { 'lines.sku': q },
      { reference: q },
    ];
  }
  return filter;
}
async function list(req) {
  const c = await inventory.access(req),
    filter = filters(req.query || {}, c);
  if (req.query?.after) {
    const anchor = await req.db.collection('spoilage_entries').findOne(
      { _id: oid(req.query.after), ...wall(c) }, { projection: { created_date: 1 } }
    );
    if (!anchor) fail('History changed. Refresh the list and try again.');
    filter.$and = [{ $or: [
      { created_date: { $lt: anchor.created_date } },
      { created_date: anchor.created_date, _id: { $lt: anchor._id } },
    ] }];
  }
  const limit = [25, 50, 100].includes(Number(req.query?.limit)) ? Number(req.query.limit) : 100;
  const rows = await req.db
    .collection('spoilage_entries')
    .find(filter)
    .sort({ created_date: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  return {
    rows: rows.slice(0, limit),
    next: rows.length > limit ? String(rows[limit - 1]._id) : null,
    canApprove: canApprove(req, c),
    canManage: admin(req.user),
    canWrite: mobile.allowed(req.user, 'item', 'write'),
    today: dateAt(new Date(), c.branch.time_zone || 'UTC'),
    reasons,
  };
}
async function report(req) {
  const c = await inventory.access(req),
    rows = await req.db
      .collection('spoilage_entries')
      .find(filters(req.query || {}, c))
      .sort({ occurredOn: 1, _id: 1 })
      .limit(10001)
      .toArray();
  if (rows.length > 10000) fail('Narrow the date range before exporting.');
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Spoilage');
  sheet.addRow([
    'Reference',
    'Date',
    'Branch',
    'Type',
    'Status',
    'SKU',
    'Product',
    'Unit',
    'Recorded quantity',
    'Applied quantity',
    'Reason',
    'Remarks',
    'Unit cost at entry',
    'Estimated value',
    'Entered by',
    'Entered at',
    'Reviewed by',
    'Reviewed at',
  ]);
  for (const d of rows)
    for (const l of d.lines)
      sheet.addRow([
        d.reference,
        d.occurredOn,
        String(d.branch_id),
        d.kind,
        d.state,
        l.sku,
        l.name,
        l.unit,
        l.quantity / 1000,
        d.applied?.includes(l.itemId) ? ((d.kind === 'reversal' ? -1 : 1) * l.quantity) / 1000 : 0,
        l.reason,
        l.remarks,
        l.unitCost ?? 'Unknown',
        l.estimatedValue ?? 'Unknown',
        d.createdByName,
        new Date(d.created_date).toISOString(),
        d.decisionByName || '',
        d.decisionAt ? new Date(d.decisionAt).toISOString() : '',
      ]);
  sheet.columns.forEach((v) => (v.width = 22));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return {
    filename: 'spoilage-report.xlsx',
    base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}
async function daily(db, { branch, license, from, to }) {
  const rows = await db
    .collection('spoilage_entries')
    .find({
      branch_id: oid(branch),
      license: oid(license),
      occurredOn: { $gte: from, $lte: to },
      state: { $ne: 'draft' },
    })
    .sort({ occurredOn: 1, _id: 1 })
    .limit(10001)
    .toArray();
  if (rows.length > 10000) fail('Narrow the date range for the spoilage report.');
  return rows;
}
async function policy(req) {
  const c = await inventory.access(req);
  if (!admin(req.user)) fail('Only an administrator can configure spoilage approvers.', 403);
  const candidates = await req.db
    .collection('users')
    .find({
      license: c.license,
      is_deleted: { $ne: true },
      del_status: { $nin: [1, '1', true] },
      $or: [{ branch_id: c.branchId }, { 'branch_access.branch_id': c.branchId }],
    })
    .project({ _id: 1, username: 1 })
    .limit(500)
    .toArray();
  if (req.method === 'POST') {
    const ids = req.body?.approvers;
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => !candidates.some((u) => String(u._id) === String(id)))
    )
      fail('Choose staff assigned to this branch.');
    await req.db
      .collection('branches')
      .updateOne(
        { _id: c.branchId, license: c.license },
        { $set: { spoilage_approver_ids: ids.map(oid), updated_date: new Date() } }
      );
    await require('../sync/outbox').enqueue({
      collection: 'branches',
      documentId: c.branchId,
      reason: 'spoilage-policy',
    });
    return { approvers: ids, candidates };
  }
  return { approvers: (c.branch.spoilage_approver_ids || []).map(String), candidates };
}
async function previewLines(req, input) {
  return lines(req, await inventory.access(req, true), input);
}
module.exports = {
  record,
  applyNow,
  undo,
  save,
  get,
  list,
  submit,
  decide,
  reverse,
  report,
  policy,
  daily,
  dateAt,
  reasons,
  previewLines,
};
