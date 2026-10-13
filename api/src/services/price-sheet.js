'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { Readable } = require('stream');
const { inflateRawSync } = require('zlib');
const ExcelJS = require('exceljs');
const BaseModel = require('../models/base.model');
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
  };
}
async function getJob(x, id) {
  const job = await x.jobs.findOne({ _id: oid(id), ...x.s });
  if (!job) throw new Error('Price job not found in this branch');
  return job;
}
async function create(c, input) {
  const x = await collections(c),
    id = oid(input.jobId);
  await x.jobs.updateOne(
    { _id: id, ...x.s },
    {
      $setOnInsert: {
        ...x.s,
        status: 'draft',
        name: String(input.name || 'Price grid').slice(0, 150),
        allowZero: input.allowZero === true,
        created_date: new Date(),
        user: String(c.userName || ''),
        userId: String(c.userId || ''),
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
      normalized = normalize(raw, job.allowZero);
    } catch (e) {
      error = e.message;
    }
    return {
      _id: `${job._id}:${start + i}`,
      job_id: job._id,
      ...x.s,
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
      status: error ? 'invalid' : Object.keys(normalized.changes).length ? 'pending' : 'unchanged',
      reason: error || '',
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
      { $group: { _id: '$itemId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const d of duplicates)
    await x.rows.updateMany(
      { job_id: job._id, itemId: d._id },
      { $set: { status: 'invalid', reason: 'Duplicate item ID in sheet; keep one row per item' } }
    );
  const cursor = x.rows.find({ job_id: job._id, status: 'pending' });
  for await (const row of cursor) {
    const item = await x.items.findOne({
      _id: oid(row.itemId),
      ...x.s,
      del_status: { $nin: [1, '1', true] },
    });
    const reason = !item
      ? 'Item not found in this branch'
      : Object.entries(row.changes).some(([f, v]) => Number(item[f] || 0) !== v.old)
        ? 'Price changed since export; download current prices'
        : '';
    if (reason) await x.rows.updateOne({ _id: row._id }, { $set: { status: 'invalid', reason } });
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
  if (['invalid', 'pending', 'updated', 'conflict', 'unchanged'].includes(filter))
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
    { _id: job._id, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
    { $set: { lease: token, leaseUntil: new Date(Date.now() + 120000), status: 'running' } }
  );
  if (!lock.modifiedCount) throw new Error('This update is processing; resume shortly');
  const processed = [];
  try {
    const rows = await x.rows
      .find({ job_id: job._id, status: 'pending' })
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
        base = { _id: oid(row.itemId), ...x.s, del_status: { $nin: [1, '1', true] } };
      const set = {
        updated_date: new Date(),
        updated_by: c.userName || '',
        updated_by_id: c.userId || null,
      };
      const conditions = Object.entries(row.changes).map(([field, v]) =>
        v.old === 0 ? { $or: [{ [field]: 0 }, { [field]: null }] } : { [field]: v.old }
      );
      for (const [field, v] of Object.entries(row.changes)) set[field] = v.value;
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
    const remaining = await x.rows.countDocuments({ job_id: job._id, status: 'pending' });
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
        { $set: { status: 'complete', completed_date: new Date() } }
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
async function list(c) {
  const x = await collections(c);
  return x.jobs.find(x.s).sort({ created_date: -1 }).limit(30).toArray();
}
async function sheet(c, query = {}) {
  const x = await collections(c),
    filter = { ...x.s, del_status: { $nin: [1, '1', true] } };
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
        ]);
    }
    return wb;
  }
  if (query.retryJobId) {
    const job = await getJob(x, query.retryJobId);
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
  const categories = require('../utils/price-category-filter')(query.category);
  if (categories) filter.category_id = categories;
  const fields = String(query.fields || 'selling_price')
    .split(',')
    .filter((f) => Object.hasOwn(FIELDS, f));
  if (!fields.length) throw new Error('Choose a price column');
  if ((await x.items.countDocuments(filter)) > LIMIT)
    throw new Error('Export up to 100,000 items at a time; select a category');
  const workbook = new ExcelJS.Workbook(),
    ws = workbook.addWorksheet('Prices');
  ws.addRow([
    'Item name',
    'SKU',
    'Unit',
    ...fields.flatMap((f) => [`Current ${FIELDS[f]}`, `New ${FIELDS[f]}`]),
    'Branch ID',
    'Item ID',
  ]);
  for await (const it of x.items.find(filter).sort({ name: 1, _id: 1 }))
    ws.addRow([
      safe(it.name),
      safe(it.itemid || ''),
      safe(it.unit || ''),
      ...fields.flatMap((f) => [Number(it[f] || 0), null]),
      String(c.branchId),
      String(it._id),
    ]);
  // Keep identity on each row so sorting/filtering never changes the item match.
  // CSV retains these trailing columns because it has no hidden-column support.
  const lastVisible = 3 + fields.length * 2;
  ws.getColumn(lastVisible + 1).hidden = true;
  ws.getColumn(lastVisible + 2).hidden = true;
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
  ws.eachRow((row, number) => {
    if (number === 1) return;
    if (String(row.getCell(index('Branch ID')).value || '') !== String(c.branchId))
      throw new Error('Sheet belongs to a different branch');
    const changes = {};
    for (const f of fields)
      changes[f] = {
        old: row.getCell(index(`Current ${FIELDS[f]}`)).value,
        value: row.getCell(index(`New ${FIELDS[f]}`)).value,
      };
    rows.push({
      id: row.getCell(index('Item ID')).value,
      name: index('Item name') ? row.getCell(index('Item name')).value : '',
      changes,
    });
  });
  await create(c, input);
  for (let start = 0; start < rows.length; start += 500)
    await append(c, input.jobId, { start, rows: rows.slice(start, start + 500) });
  return finish(c, input.jobId, rows.length);
}
module.exports = {
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
