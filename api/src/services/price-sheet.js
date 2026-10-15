'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { Readable } = require('stream');
const { inflateRawSync } = require('zlib');
const ExcelJS = require('exceljs');
const BaseModel = require('../models/base.model');
const branchScope = require('./price-scope');
const moment = require('moment-timezone');
const { searchPattern } = require('../utils/safe-search');
const FIELDS = { selling_price: 'Selling price', company_price: 'Cost price', mrp_price: 'MRP' };
const LIMIT = 100000;
const indexed = new WeakMap();
// Bound XLSX expansion before ExcelJS materializes cells/shared strings. ZIP64 and
// encrypted archives are unnecessary for a price sheet and are deliberately rejected.
function checkWorkbookArchive(buffer) {
  const max = 128 * 1024 * 1024;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Invalid XLSX archive');
  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    total = 0;
  if (entries > 2000 || offset === 0xffffffff) throw new Error('XLSX is too complex; use CSV');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid XLSX directory');
    const flags = buffer.readUInt16LE(offset + 8),
      method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20),
      size = buffer.readUInt32LE(offset + 24),
      local = buffer.readUInt32LE(offset + 42);
    total += size;
    if (flags & 1 || ![0, 8].includes(method) || total > max || local + 30 > buffer.length)
      throw new Error('XLSX exceeds supported size or format; use a smaller sheet');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw new Error('Truncated XLSX archive');
    const part = buffer.subarray(start, start + compressed);
    const expanded =
      method === 8 ? inflateRawSync(part, { maxOutputLength: Math.max(1, size) }) : part;
    if (expanded.length !== size) throw new Error('Invalid XLSX entry size');
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}
const oid = (value) => {
  if (!ObjectId.isValid(value)) throw new Error('Invalid identifier');
  return new ObjectId(String(value));
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function scope(c) {
  return { branch_id: oid(c.branchId), license: oid(c.licenseId) };
}
function money(v) {
  if (typeof v !== 'number' && typeof v !== 'string') throw new Error('Price must be a number');
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(v).trim()) || Number(v) > 1000000000)
    throw new Error('Use a non-negative price with at most two decimals');
  return Math.round(Number(v) * 100) / 100;
}
function normalize(row, allowZero) {
  const itemId = oid(row.id).toHexString();
  const changes = {};
  for (const [field, change] of Object.entries(row.changes || {})) {
    if (!Object.hasOwn(FIELDS, field)) throw new Error('Unsupported price column');
    if (change.value === '' || change.value == null) continue;
    const value = money(change.value);
    if (
      !['string', 'number'].includes(typeof change.old) ||
      !/^\d+(?:\.\d+)?$/.test(String(change.old)) ||
      !Number.isFinite(Number(change.old))
    )
      throw new Error('Invalid current price');
    const old = Number(change.old);
    if (value === 0 && !allowZero) continue;
    if (value !== old) changes[field] = { old, value };
  }
  return { id: itemId, changes };
}
async function collections(c) {
  const db = await BaseModel.getDb();
  if (!indexed.has(db))
    indexed.set(
      db,
      Promise.all([
        db
          .collection('price_sheet_jobs')
          .createIndex({ branch_id: 1, license: 1, created_date: -1 }),
        db.collection('price_sheet_rows').createIndex({ job_id: 1, status: 1, number: 1 }),
        db.collection('price_sheet_rows').createIndex({ job_id: 1, number: 1 }),
        db.collection('price_sheet_jobs').createIndex({ scheduled: 1, status: 1, effectiveAt: 1 }),
      ]).catch((e) => {
        indexed.delete(db);
        throw e;
      })
    );
  await indexed.get(db);
  return {
    db,
    jobs: db.collection('price_sheet_jobs'),
    rows: db.collection('price_sheet_rows'),
    items: db.collection('items'),
    s: scope(c),
    c,
  };
}
async function getJob(x, id) {
  const job = await x.jobs.findOne({ _id: oid(id), license: x.s.license });
  if (!job) throw new Error('Price job not found in this branch');
  branchScope.assertJob(x.c, job);
  return job;
}
async function create(c, input) {
  const x = await collections(c),
    id = oid(input.jobId);
  const branchIds = branchScope.selected(c, input.branches);
  const existing = await x.jobs.findOne({ _id: id });
  if (existing) {
    await getJob(x, id);
    if (
      JSON.stringify(existing.branchIds || [String(existing.branch_id)]) !==
      JSON.stringify(branchIds)
    )
      throw new Error('This request ID already belongs to another branch selection');
    return existing;
  }
  await x.jobs.updateOne(
    { _id: id, ...x.s },
    {
      $setOnInsert: {
        ...x.s,
        status: 'draft',
        branchIds,
        name: String(input.name || 'Price grid').slice(0, 150),
        allowZero: input.allowZero === true,
        created_date: new Date(),
        user: String(c.userName || ''),
        userId: String(c.userId || ''),
        apiToken: c.apiToken === true,
      },
    },
    { upsert: true }
  );
  return getJob(x, id);
}
async function append(c, id, input) {
  const x = await collections(c),
    job = await getJob(x, id);
  if (job.status !== 'draft') throw new Error('This job is already submitted');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 500)
    throw new Error('Send 1 to 500 rows at a time');
  const start = Number(input.start);
  if (!Number.isInteger(start) || start < 0 || start + input.rows.length > LIMIT)
    throw new Error('Maximum 100,000 rows');
  const docs = input.rows.map((raw, i) => {
    let normalized, error;
    try {
      const branchId = branchScope.selected(c, [raw.branchId || c.branchId])[0];
      if (!(job.branchIds || [String(job.branch_id)]).includes(branchId))
        throw new Error('Row branch is outside the selected branches');
      normalized = normalize(raw, job.allowZero);
      normalized.branchId = branchId;
    } catch (e) {
      error = e.message;
    }
    return {
      _id: `${job._id}:${start + i}`,
      job_id: job._id,
      ...x.s,
      branch_id: oid(normalized?.branchId || c.branchId),
      number: start + i + 1,
      itemId: normalized?.id || String(raw.id || '').slice(0, 100),
      changes: normalized?.changes || {},
      submitted: Object.fromEntries(
        Object.entries(raw.changes || {})
          .filter(([f]) => Object.hasOwn(FIELDS, f))
          .map(([f, v]) => [
            f,
            {
              old: String(v?.old ?? '').slice(0, 100),
              value: String(v?.value ?? '').slice(0, 100),
            },
          ])
      ),
      name: String(raw.name || '').slice(0, 150),
      status: raw.skipReason
        ? 'skipped'
        : raw.invalidReason || error
          ? 'invalid'
          : Object.keys(normalized.changes).length
            ? 'pending'
            : 'unchanged',
      reason: String(raw.skipReason || raw.invalidReason || error || '').slice(0, 250),
      fingerprint: hash(JSON.stringify(raw)),
    };
  });
  for (const doc of docs) {
    const existing = await x.rows.findOne({ _id: doc._id });
    if (existing && existing.fingerprint !== doc.fingerprint)
      throw new Error('A different sheet is already staged in this job');
  }
  await x.rows.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
    }))
  );
  return { staged: await x.rows.countDocuments({ job_id: job._id }) };
}
async function finish(c, id, expected) {
  const x = await collections(c),
    job = await getJob(x, id);
  if (job.status !== 'draft') return status(c, id);
  const count = await x.rows.countDocuments({ job_id: job._id });
  if (!Number.isInteger(expected) || expected !== count || !count)
    throw new Error('Upload is incomplete; resume uploading before review');
  const duplicates = await x.rows
    .aggregate([
      { $match: { job_id: job._id } },
      { $group: { _id: { item: '$itemId', branch: '$branch_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const d of duplicates)
    await x.rows.updateMany(
      { job_id: job._id, itemId: d._id.item, branch_id: d._id.branch },
      { $set: { status: 'invalid', reason: 'Duplicate item ID in sheet; keep one row per item' } }
    );
  const cursor = x.rows.find({ job_id: job._id, status: 'pending' });
  for await (const row of cursor) {
    const item = await x.items.findOne({
      _id: oid(row.itemId),
      ...x.s,
      branch_id: row.branch_id,
      del_status: { $nin: [1, '1', true] },
    });
    const reason = !item
      ? 'Item not found in this branch'
      : Object.entries(row.changes).some(([f, v]) => Number(item[f] || 0) !== v.old)
        ? 'Price changed since export; download current prices'
        : '';
    if (reason)
      await x.rows.updateOne(
        { _id: row._id },
        { $set: { status: item ? 'conflict' : 'skipped', reason } }
      );
    else if (row.changes.selling_price && item.selling_price_hold_until > new Date())
      await x.rows.updateOne(
        { _id: row._id },
        {
          $set: {
            status: 'held',
            reason: 'Selling price held until ' + item.selling_price_hold_until.toISOString(),
          },
        }
      );
  }
  await x.jobs.updateOne(
    { _id: job._id, status: 'draft' },
    { $set: { status: 'review', total: count } }
  );
  return status(c, id);
}
async function status(c, id, page = 1, filter = 'changes') {
  const x = await collections(c),
    job = await getJob(x, id),
    q = { job_id: job._id };
  const groups = await x.rows
    .aggregate([{ $match: q }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    .toArray();
  const counts = Object.fromEntries(groups.map((g) => [g._id, g.count]));
  if (filter === 'changes') q.status = { $ne: 'unchanged' };
  if (
    ['invalid', 'pending', 'updated', 'conflict', 'unchanged', 'held', 'skipped'].includes(filter)
  )
    q.status = filter;
  const total = await x.rows.countDocuments(q),
    p = Math.max(1, Math.min(2000, Number(page) || 1));
  return {
    job,
    counts,
    total,
    page: p,
    rows: await x.rows
      .find(q, { projection: { fingerprint: 0 } })
      .sort({ number: 1 })
      .skip((p - 1) * 50)
      .limit(50)
      .toArray(),
  };
}
async function processBatch(c, id, skipInvalid) {
  const x = await collections(c),
    job = await getJob(x, id);
  if (job.status === 'complete') return status(c, id);
  if (!['review', 'running'].includes(job.status))
    throw new Error('Check the sheet before applying');
  if (
    job.status === 'review' &&
    !skipInvalid &&
    (await x.rows.countDocuments({ job_id: job._id, status: 'invalid' }))
  )
    throw new Error('Correct invalid rows or explicitly skip them');
  // A lease serializes retry requests. Per-item receipts recover a lost response or a
  // crash between the item write and its audit/row acknowledgement on standalone MongoDB.
  const token = crypto.randomUUID(),
    now = new Date();
  const lock = await x.jobs.updateOne(
    {
      _id: job._id,
      revision: job.revision ?? null,
      status: { $in: ['review', 'running'] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
    },
    { $set: { lease: token, leaseUntil: new Date(Date.now() + 120000), status: 'running' } }
  );
  if (!lock.modifiedCount) throw new Error('This update is processing; resume shortly');
  const processed = [];
  const pending = {
    job_id: job._id,
    $or: [{ status: 'pending' }, { status: 'held', itemId: { $in: job.holdOverrides || [] } }],
  };
  const dueBranches = Object.entries(job.dueByBranch || {})
    .filter(([, date]) => new Date(date) <= now)
    .map(([branch]) => oid(branch));
  try {
    const rows = await x.rows
      .find({ ...pending, ...(job.dueByBranch ? { branch_id: { $in: dueBranches } } : {}) })
      .sort({ number: 1 })
      .limit(100)
      .toArray();
    for (const row of rows) {
      const renewed = await x.jobs.updateOne(
        { _id: job._id, lease: token },
        { $set: { leaseUntil: new Date(Date.now() + 120000) } }
      );
      if (!renewed.matchedCount) throw new Error('Processing lease changed; resume this job');
      const key = hash(row._id),
        base = {
          _id: oid(row.itemId),
          ...x.s,
          branch_id: row.branch_id,
          del_status: { $nin: [1, '1', true] },
        };
      const before = await x.items.findOne(base);
      if (
        row.changes.selling_price &&
        before?.selling_price_hold_until > now &&
        job.holdOverrideDates?.[row.itemId] !== before.selling_price_hold_until.toISOString() &&
        !before.price_update_receipts?.includes(key)
      ) {
        await x.rows.updateOne(
          { _id: row._id },
          {
            $set: {
              status: 'held',
              reason:
                'Selling price is held until ' + before.selling_price_hold_until.toISOString(),
            },
          }
        );
        await x.jobs.updateOne(
          { _id: job._id, lease: token },
          { $pull: { holdOverrides: row.itemId } }
        );
        pending.$or[1].itemId.$in = pending.$or[1].itemId.$in.filter((v) => v !== row.itemId);
        continue;
      }
      const set = {
        updated_date: new Date(),
        updated_by: c.userName || '',
        updated_by_id: c.userId || null,
      };
      const conditions = Object.entries(row.changes).map(([field, v]) =>
        v.old === 0 ? { $or: [{ [field]: 0 }, { [field]: null }] } : { [field]: v.old }
      );
      if (row.changes.selling_price)
        conditions.push({ selling_price_hold_until: before?.selling_price_hold_until || null });
      for (const [field, v] of Object.entries(row.changes)) set[field] = v.value;
      if (row.changes.selling_price && job.holdUntil)
        set.selling_price_hold_until = job.holdByBranch?.[String(row.branch_id)] || job.holdUntil;
      if (
        row.changes.selling_price &&
        (job.holdOverrides || []).includes(String(row.itemId)) &&
        !job.holdUntil
      )
        set.selling_price_hold_until = now;
      let item = await x.items.findOne({ ...base, price_update_receipts: key });
      if (!item) {
        const result = await x.items.updateOne(
          { ...base, price_update_receipts: { $ne: key }, $and: conditions },
          { $set: set, $addToSet: { price_update_receipts: key } }
        );
        if (!result.modifiedCount) {
          item = await x.items.findOne({ ...base, price_update_receipts: key });
          if (!item) {
            await x.rows.updateOne(
              { _id: row._id },
              {
                $set: {
                  status: 'conflict',
                  reason: 'Price changed after review or item is unavailable',
                },
              }
            );
            continue;
          }
        }
      }
      for (const [field, v] of Object.entries(row.changes)) {
        await x.db.collection('price_history').updateOne(
          { _id: oid(hash(`${row._id}:${field}`).slice(0, 24)) },
          {
            $setOnInsert: {
              item_id: oid(row.itemId),
              item_name: row.name,
              ...x.s,
              branch_id: row.branch_id,
              note: job.note || '',
              hold_overridden: (job.holdOverrides || []).includes(String(row.itemId)),
              field,
              label: FIELDS[field],
              value_type: 'money',
              old_value: v.old,
              new_value: v.value,
              process: 'Bulk',
              batch_id: job._id,
              changed_by: job.user,
              changed_by_id: job.userId,
              date: now,
              created_date: now,
              updated_date: now,
            },
          },
          { upsert: true }
        );
      }
      await x.rows.updateOne({ _id: row._id }, { $set: { status: 'updated', reason: '' } });
      processed.push({ id: row.itemId, changes: row.changes });
    }
    const remaining = await x.rows.countDocuments(pending);
    if (remaining && job.scheduled) {
      const remainingBranches = await x.rows.distinct('branch_id', pending);
      const next = new Date(
        Math.min(...remainingBranches.map((b) => new Date(job.dueByBranch[String(b)]).getTime()))
      );
      if (next > now)
        await x.jobs.updateOne(
          { _id: job._id, lease: token },
          { $set: { status: 'scheduled', effectiveAt: next } }
        );
    }
    if (!remaining) {
      const updated = await x.rows.countDocuments({ job_id: job._id, status: 'updated' });
      await x.db.collection('bulk_price_updates').updateOne(
        { _id: job._id },
        {
          $setOnInsert: {
            ...x.s,
            label: 'Selected prices',
            op: 'individual',
            scope: 'selected',
            items_changed: updated,
            items_skipped: job.total - updated,
            changed_by: job.user,
            changed_by_id: job.userId,
            date: now,
            created_date: now,
            updated_date: now,
          },
        },
        { upsert: true }
      );
      await x.jobs.updateOne(
        { _id: job._id, lease: token },
        {
          $set: {
            status: (await x.rows.countDocuments({ job_id: job._id, status: 'held' }))
              ? 'attention'
              : 'complete',
            completed_date: new Date(),
          },
        }
      );
    }
  } finally {
    await x.jobs.updateOne(
      { _id: job._id, lease: token },
      { $unset: { lease: '', leaseUntil: '' } }
    );
  }
  return { ...(await status(c, id)), processed };
}
async function list(c, input = {}) {
  const x = await collections(c);
  const ids = branchScope.selected(c, 'all');
  const q = {
    license: x.s.license,
    branch_id: { $in: ids.map(oid) },
    $nor: [{ branchIds: { $elemMatch: { $nin: ids } } }],
  };
  if (
    ['scheduled', 'attention', 'complete', 'cancelled', 'review', 'running'].includes(input.status)
  )
    q.status = input.status;
  if (input.status === 'upcoming') q.status = { $in: ['scheduled', 'running', 'attention'] };
  if (input.status === 'drafts') q.status = { $in: ['review', 'draft'] };
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = [10, 25, 50].includes(Number(input.pageSize)) ? Number(input.pageSize) : 10;
  return {
    total: await x.jobs.countDocuments(q),
    page,
    pageSize,
    jobs: await x.jobs
      .find(q)
      .sort({ created_date: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  };
}
async function configure(c, id, input) {
  const x = await collections(c),
    job = await getJob(x, id);
  if ((job.revision || 0) !== Number(input.revision || 0))
    throw new Error('Update changed; reload before editing');
  if (!['review', 'scheduled', 'attention'].includes(job.status))
    throw new Error('This update cannot be edited');
  if (await x.rows.countDocuments({ job_id: job._id, status: 'updated' }))
    throw new Error('Some prices already applied; create a new update');
  const note = String(input.note || '').trim();
  if (!['now', 'tomorrow', 'custom'].includes(input.when))
    throw new Error('Choose Now, Tomorrow or a scheduled date');
  if (!input.skipInvalid && (await x.rows.countDocuments({ job_id: job._id, status: 'invalid' })))
    throw new Error('Correct invalid rows or explicitly skip them');
  if (note.length > 500) throw new Error('Note must be at most 500 characters');
  const branchIds = job.branchIds || [String(job.branch_id)];
  const due = {},
    now = new Date();
  for (const branch of branchIds) {
    const zone = c.branches?.find((b) => b.id === branch)?.timezone || 'Asia/Calcutta';
    if (!moment.tz.zone(zone)) throw new Error('Branch timezone is not configured');
    const date =
      input.when === 'tomorrow'
        ? moment.tz(now, zone).add(1, 'day').startOf('day').toDate()
        : input.when === 'custom'
          ? moment.tz(String(input.localTime), 'YYYY-MM-DDTHH:mm', true, zone).toDate()
          : now;
    if (!Number.isFinite(date.getTime()) || (input.when !== 'now' && date <= now))
      throw new Error('Choose a future date and time');
    due[branch] = date;
  }
  let holdUntil = null;
  const holdByBranch = {};
  if (input.holdUntil) {
    for (const branch of branchIds) {
      const zone = c.branches?.find((b) => b.id === branch)?.timezone || 'Asia/Calcutta';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(input.holdUntil)
        ? moment.tz(input.holdUntil, 'YYYY-MM-DD', true, zone).endOf('day').toDate()
        : new Date(input.holdUntil);
      if (!Number.isFinite(date.getTime()) || date <= due[branch])
        throw new Error('Keep-price end must be after the effective date');
      holdByBranch[branch] = date;
    }
    holdUntil = new Date(Math.max(...Object.values(holdByBranch)));
  }
  const holdOverrides = [],
    holdOverrideDates = {};
  for (const itemId of input.holdOverrides || []) {
    const row = await x.rows.findOne({ job_id: job._id, itemId: String(itemId), status: 'held' });
    if (!row) throw new Error('Review held prices before replacing them');
    const item = await x.items.findOne({
      _id: oid(itemId),
      license: x.s.license,
      branch_id: row.branch_id,
    });
    holdOverrides.push(String(itemId));
    if (item?.selling_price_hold_until)
      holdOverrideDates[itemId] = item.selling_price_hold_until.toISOString();
  }
  // All schedule configuration is one atomic write; a crash cannot leave half an edit.
  const claim = await x.jobs.updateOne(
    { _id: job._id, status: job.status, revision: job.revision ?? null },
    {
      $set: {
        note,
        holdUntil,
        holdDate: input.holdUntil || '',
        holdByBranch,
        holdOverrides,
        holdOverrideDates,
        status: input.when === 'now' ? 'review' : 'scheduled',
        scheduled: input.when !== 'now',
        effectiveAt: new Date(Math.min(...Object.values(due))),
        dueByBranch: due,
        when: input.when,
        localTime: input.localTime || '',
        skipInvalid: input.skipInvalid === true,
      },
      $inc: { revision: 1 },
    }
  );
  if (!claim.modifiedCount) throw new Error('Update changed; reload before editing');
  return status(c, id);
}
async function cancel(c, id, input = {}) {
  const x = await collections(c),
    job = await getJob(x, id);
  if ((job.revision || 0) !== Number(input.revision || 0))
    throw new Error('Update changed; reload before cancelling');
  if (await x.rows.countDocuments({ job_id: job._id, status: 'updated' }))
    throw new Error('Already partially applied; inspect results');
  const result = await x.jobs.updateOne(
    {
      _id: job._id,
      revision: job.revision ?? null,
      status: { $in: ['review', 'scheduled', 'attention'] },
    },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: String(c.userId) } }
  );
  if (!result.modifiedCount) throw new Error('Update is already running or finished');
  return status(c, id);
}
// The public API prepares the same reviewable job as the screen. Numeric SKU
// matching is exact, and duplicate codes require explicit item IDs per branch.
async function prepare(c, input) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500)
    throw new Error('Provide 1 to 500 items per request');
  const branchIds = branchScope.selected(c, input.branches);
  const x = await collections(c),
    rows = [];
  const fingerprint = hash(
    JSON.stringify({ branches: branchIds, items: input.items, allowZero: input.allowZero === true })
  );
  const job = await create(c, input);
  if (job.requestFingerprint && job.requestFingerprint !== fingerprint)
    throw new Error('Request ID reused with different prices');
  if (job.status !== 'draft') return status(c, job._id);
  const claimed = await x.jobs.updateOne(
    {
      _id: job._id,
      $or: [{ requestFingerprint: fingerprint }, { requestFingerprint: { $exists: false } }],
    },
    { $set: { requestFingerprint: fingerprint } }
  );
  if (!claimed.matchedCount) throw new Error('Request ID reused with different prices');
  for (const entry of input.items)
    for (const branch of branchIds) {
      const filter = {
        license: x.s.license,
        branch_id: oid(branch),
        del_status: { $nin: [1, '1', true] },
      };
      if (entry.ids?.[branch]) filter._id = oid(entry.ids[branch]);
      else if (typeof entry.sku === 'string' && entry.sku.trim()) filter.itemid = entry.sku.trim();
      else throw new Error('Provide a SKU or explicit item IDs for each branch');
      const matches = await x.items.find(filter).limit(2).toArray(),
        item = matches[0];
      const prices = entry.branchPrices?.[branch] || entry.prices;
      if (!prices || typeof prices !== 'object') throw new Error('Provide price fields');
      const changes = Object.fromEntries(
        Object.entries(prices).map(([field, value]) => [field, { old: item?.[field] || 0, value }])
      );
      rows.push({
        id: item ? String(item._id) : hash(job._id + ':' + rows.length).slice(0, 24),
        branchId: branch,
        name: item?.name || entry.sku,
        changes,
        ...(matches.length > 1
          ? { invalidReason: 'Duplicate SKU; select the exact item ID' }
          : !item
            ? { skipReason: 'Item missing in branch; skipped' }
            : {}),
      });
    }
  for (let start = 0; start < rows.length; start += 500)
    await append(c, job._id, { start, rows: rows.slice(start, start + 500) });
  return finish(c, job._id, rows.length);
}
async function sheet(c, query = {}) {
  const x = await collections(c),
    filter = { ...x.s, del_status: { $nin: [1, '1', true] } };
  let branchIds = branchScope.selected(c, query.branches);
  filter.branch_id = { $in: branchIds.map(oid) };
  const safe = (value) =>
    typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  if (query.jobId) {
    const job = await getJob(x, query.jobId),
      wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet('Result');
    ws.addRow([
      'Row',
      'Item ID',
      'Item name',
      'Field',
      'Old value',
      'New value',
      'Status',
      'Reason',
      ...((c.branches?.length || 1) > 1 ? ['Branch code'] : []),
    ]);
    for await (const row of x.rows
      .find({ job_id: job._id, status: { $ne: 'unchanged' } })
      .sort({ number: 1 })) {
      const changes = Object.entries(
        row.status === 'invalid' ? row.submitted || row.changes : row.changes
      );
      if (!changes.length) changes.push(['', {}]);
      for (const [field, v] of changes)
        ws.addRow([
          row.number,
          safe(row.itemId),
          safe(row.name),
          FIELDS[field] || '',
          safe(v.old ?? ''),
          safe(v.value ?? ''),
          row.status,
          safe(row.reason),
          ...((c.branches?.length || 1) > 1
            ? [
                safe(
                  c.branches.find((b) => b.id === String(row.branch_id))?.code ||
                    String(row.branch_id)
                ),
              ]
            : []),
        ]);
    }
    return wb;
  }
  if (query.retryJobId) {
    const job = await getJob(x, query.retryJobId);
    branchIds = branchScope.selected(c, job.branchIds || [String(job.branch_id)]);
    filter.branch_id = { $in: branchIds.map(oid) };
    const unresolved = await x.rows
      .find(
        { job_id: job._id, status: { $in: ['invalid', 'conflict'] } },
        { projection: { itemId: 1 } }
      )
      .toArray();
    filter._id = {
      $in: unresolved.filter((r) => ObjectId.isValid(r.itemId)).map((r) => oid(r.itemId)),
    };
  }
  if (query.search)
    filter.$or = ['name', 'itemid'].map((f) => ({
      [f]: { $regex: searchPattern(String(query.search).slice(0, 100)), $options: 'i' },
    }));
  const categories = await branchScope.categoryFilter(c, query.category, branchIds);
  if (categories) filter.category_id = categories;
  const fields = String(query.fields || 'selling_price')
    .split(',')
    .filter((f) => Object.hasOwn(FIELDS, f));
  if (!fields.length) throw new Error('Choose a price column');
  if ((await x.items.countDocuments(filter)) > LIMIT)
    throw new Error('Export up to 100,000 items at a time; select a category');
  const workbook = new ExcelJS.Workbook(),
    ws = workbook.addWorksheet('Prices');
  const exportedAt = new Date().toISOString();
  const categoryDocs = categories
    ? await x.db
        .collection('categories')
        .find({
          _id: categories,
          license: x.s.license,
        })
        .toArray()
    : [];
  const categoryNames = [
    ...new Set(categoryDocs.map((it) => it.name || it.category_name || '').filter(Boolean)),
  ];
  const brand = await x.db.collection('app_brand').findOne({ _id: 'brand', enabled: true });
  const clean = (s) =>
    String(s)
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 65);
  const zone = c.branches?.find((b) => b.id === String(c.branchId))?.timezone || 'Asia/Calcutta';
  workbook.priceFilename = [
    clean(brand?.name || require('../helpers/brand').brandName() || 'Prices'),
    categoryNames.length
      ? categoryNames.length <= 3
        ? categoryNames.map(clean).join('-')
        : categoryNames.length + '-categories'
      : categories
        ? 'Selected-categories'
        : 'All-items',
    ...(branchIds.length > 1
      ? [branchIds.map((b) => clean(c.branches?.find((it) => it.id === b)?.code || b)).join('-')]
      : []),
    moment.tz(exportedAt, zone).format('YYYY-MM-DD-HHmm'),
  ].join('-');
  const multi = (c.branches?.length || 1) > 1;
  ws.addRow([
    'Item name',
    'SKU',
    'Unit',
    ...fields.flatMap((f) => [`Current ${FIELDS[f]}`, `New ${FIELDS[f]}`]),
    'Branch ID',
    'Item ID',
    'Exported at',
    'Categories',
    ...(multi ? ['Branch code'] : []),
  ]);
  for await (const it of x.items.find(filter).sort({ name: 1, _id: 1 }))
    ws.addRow([
      safe(it.name),
      safe(it.itemid || ''),
      safe(it.unit || ''),
      ...fields.flatMap((f) => [Number(it[f] || 0), null]),
      String(it.branch_id),
      String(it._id),
      exportedAt,
      categoryNames.join(', ') || 'All items',
      ...(multi ? [c.branches.find((b) => b.id === String(it.branch_id))?.code || ''] : []),
    ]);
  // Keep identity on each row so sorting/filtering never changes the item match.
  // CSV retains these trailing columns because it has no hidden-column support.
  const lastVisible = 3 + fields.length * 2;
  ws.getColumn(lastVisible + 1).hidden = true;
  ws.getColumn(lastVisible + 2).hidden = true;
  ws.getColumn(lastVisible + 3).hidden = true;
  ws.getColumn(lastVisible + 4).hidden = true;
  if (multi) ws.getColumn(lastVisible + 5).width = 16;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: ws.rowCount, column: lastVisible + 2 } };
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 12;
  for (let col = 4; col <= lastVisible; col++) {
    const column = ws.getColumn(col);
    column.width = 24;
    column.numFmt = '0.00';
    column.eachCell({ includeEmpty: true }, (cell, row) => {
      if (row === 1) return;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: col % 2 ? 'FFE8F5EE' : 'FFF1F4F8' },
      };
    });
  }
  ws.getRow(1).height = 32;
  ws.getRow(1).eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: col >= 4 && col <= lastVisible && col % 2 ? 'FF16704A' : 'FF24364B' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  return workbook;
}
async function importSheet(c, input, file) {
  if (!file) throw new Error('Choose a CSV or XLSX price sheet');
  const wb = new ExcelJS.Workbook();
  if (/\.xlsx$/i.test(file.originalname)) {
    checkWorkbookArchive(file.buffer);
    await wb.xlsx.load(file.buffer);
  } else if (/\.csv$/i.test(file.originalname))
    await wb.csv.read(Readable.from(file.buffer), { map: (value) => value });
  else throw new Error('Use CSV or XLSX');
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2 || ws.rowCount > LIMIT + 1)
    throw new Error('Sheet must have 1 to 100,000 rows');
  const headers = ws.getRow(1).values.slice(1).map(String);
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate column headers');
  const index = (h) => headers.indexOf(h) + 1;
  if (!index('Branch ID') || !index('Item ID'))
    throw new Error('Use the downloaded price sheet, including Branch ID and Item ID');
  const fields = Object.keys(FIELDS).filter((f) => index(`New ${FIELDS[f]}`));
  if (!fields.length || fields.some((f) => !index(`Current ${FIELDS[f]}`)))
    throw new Error('Both current and new price columns are required');
  const rows = [];
  const allowed = branchScope.selected(c, input.branches);
  const exportedDates = new Set();
  ws.eachRow((row, number) => {
    if (number === 1) return;
    const branchId = String(row.getCell(index('Branch ID')).value || '');
    if (!allowed.includes(branchId))
      throw new Error('Sheet contains an unauthorized or unselected branch');
    if (index('Branch code')) {
      const code = String(row.getCell(index('Branch code')).value || '');
      if (branchScope.selected(c, [code])[0] !== branchId)
        throw new Error('Branch code and internal branch ID disagree; download a fresh sheet');
    }
    if (index('Exported at'))
      exportedDates.add(String(row.getCell(index('Exported at')).value || ''));
    const changes = {};
    for (const f of fields)
      changes[f] = {
        old: row.getCell(index(`Current ${FIELDS[f]}`)).value,
        value: row.getCell(index(`New ${FIELDS[f]}`)).value,
      };
    rows.push({
      id: row.getCell(index('Item ID')).value,
      branchId,
      name: index('Item name') ? row.getCell(index('Item name')).value : '',
      changes,
    });
  });
  await create(c, input);
  const x = await collections(c);
  await x.jobs.updateOne(
    { _id: oid(input.jobId), status: 'draft', license: x.s.license },
    { $set: { exportedAt: [...exportedDates].slice(0, 10) } }
  );
  for (let start = 0; start < rows.length; start += 500)
    await append(c, input.jobId, { start, rows: rows.slice(start, start + 500) });
  return finish(c, input.jobId, rows.length);
}
module.exports = {
  configure,
  cancel,
  prepare,
  FIELDS,
  money,
  normalize,
  create,
  append,
  finish,
  status,
  processBatch,
  list,
  sheet,
  importSheet,
};
