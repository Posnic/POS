'use strict';
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const inventory = require('./mobile-inventory');
const headers = [
  'Item',
  'SKU',
  'Unit',
  'Current stock',
  'New stock',
  'Reason',
  'Category',
  'Item ID',
  'Branch ID',
  'Revision',
];

async function download(req) {
  const rows = [],
    metadata = new Map();
  let after;
  do {
    const page = await inventory.catalogue({
      ...req,
      query: { ...req.query, kind: 'items', after },
    });
    if (page.rows.some((r) => r.tracked && r.quantity === null))
      throw new Error(
        'Some stock quantities are invalid. Correct them before downloading a count sheet.'
      );
    page.rows.forEach((r) => metadata.set(r.id, r));
    rows.push(
      ...page.rows
        .filter((r) => r.tracked)
        .map((r) => [
          r.name,
          r.sku,
          r.unit,
          r.quantity / 1000,
          '',
          '',
          r.id,
          page.branchId,
          r.revision,
        ])
    );
    after = page.next;
    if (rows.length > 20000)
      throw new Error('Use a smaller stock catalogue (maximum 20,000 items).');
  } while (after);
  const c = await inventory.access(req);
  const categories = await req.db
    .collection('categories')
    .find({ license: c.license, branch_id: c.branchId })
    .toArray();
  const order = (r) => categories.find((v) => String(v._id) === metadata.get(r[6])?.categoryId);
  rows.sort(
    (a, b) =>
      (Number(order(a)?.sort_order) || 0) - (Number(order(b)?.sort_order) || 0) ||
      String(order(a)?.name || '').localeCompare(String(order(b)?.name || '')) ||
      String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true }) ||
      String(a[0]).localeCompare(String(b[0]))
  );
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Stock count');
  sheet.addRow(headers);
  sheet.addRows(rows.map((row) => [...row.slice(0, 6), order(row)?.name || '', ...row.slice(6)]));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  [40, 20, 12, 18, 18, 40, 24, 28, 28, 68].forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
    if (i >= 7) sheet.getColumn(i + 1).hidden = true;
  });
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5ED' } };
  sheet.pageSetup = {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
    printArea: 'A1:G' + (rows.length + 1),
  };
  return {
    filename: 'stock-count.xlsx',
    base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}

async function parse(file, branchId) {
  if (!file || file.buffer.length > 10 * 1024 * 1024)
    throw new Error('Choose a CSV or XLSX stock sheet up to 10 MB.');
  const book = new ExcelJS.Workbook();
  if (/\.xlsx$/i.test(file.originalname)) {
    require('./price-sheet').checkWorkbookArchive(file.buffer);
    await book.xlsx.load(file.buffer);
  } else if (/\.csv$/i.test(file.originalname)) {
    await book.csv.read(Readable.from(file.buffer), { map: (value) => value });
  } else throw new Error('Choose a CSV or XLSX stock sheet.');
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 20001) throw new Error('Sheet must contain at most 20,000 items.');
  const names = sheet.getRow(1).values.slice(1);
  if (
    headers.some((h) => h !== 'Category' && !names.includes(h)) ||
    new Set(names).size !== names.length
  )
    throw new Error('Use the downloaded stock sheet and keep its column headings.');
  const seen = new Set(),
    lines = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const cell = (name) => row.getCell(names.indexOf(name) + 1).value;
    const value = cell('New stock');
    if (value == null || value === '') return;
    if (typeof value !== 'number' && typeof value !== 'string')
      throw new Error('Row ' + n + ': enter a number, not a formula.');
    const text = String(value).trim();
    if (!/^\d+(\.\d{1,3})?$/.test(text))
      throw new Error('Row ' + n + ': use a non-negative quantity with up to three decimals.');
    if (String(cell('Branch ID')) !== String(branchId))
      throw new Error('This sheet belongs to another branch. Switch to that branch first.');
    const itemId = String(cell('Item ID'));
    if (seen.has(itemId)) throw new Error('Row ' + n + ': duplicate item.');
    seen.add(itemId);
    const reason = cell('Reason');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500)
      throw new Error('Row ' + n + ': enter a reason of 1 to 500 characters.');
    lines.push({
      itemId,
      quantity: Math.round(Number(text) * 1000),
      revision: String(cell('Revision')),
      reason: reason.trim(),
    });
  });
  if (!lines.length)
    throw new Error('Enter New stock for at least one item. Blank cells are left unchanged.');
  if (lines.length > 200)
    throw new Error(
      'Review at most 200 changed items at a time. Split this count into smaller sheets.'
    );
  return lines;
}

async function upload(req) {
  const c = await inventory.access(req, true);
  const lines = await parse(req.file, c.branchId);
  return inventory.prepare({
    ...req,
    body: { id: req.body.id, mode: 'count', reason: req.body.reason || 'Stock adjustment', lines },
  });
}
async function scoped(req) {
  const target = req.query?.targetBranchId || req.body?.targetBranchId;
  if (!target || String(target) === String(req.tenantContext.branchId)) return req;
  if (req.handsetDevice || process.env.POSNIC_DESKTOP === '1')
    throw new Error('Use the cloud account to adjust another branch.');
  const c = await require('./price-scope').context(
    req.user,
    req.tenantContext.branchId,
    req.tenantContext.licenseId
  );
  const branchId = require('./price-scope').selected(c, [target])[0];
  return { ...req, tenantContext: { ...req.tenantContext, branchId } };
}
async function report(req) {
  const result = await inventory.get(req);
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Adjustment results');
  sheet.addRow([
    'Reference',
    'Branch',
    'User',
    'Created at',
    'Item',
    'Previous stock',
    'New stock',
    'Reason',
    'Status',
  ]);
  for (const line of result.lines)
    sheet.addRow([
      result.operationId,
      String(req.tenantContext.branchId),
      result.actor,
      String(result.createdAt),
      line.name,
      line.expected / 1000,
      line.quantity / 1000,
      line.reason,
      result.applied.includes(line.itemId) ? 'Applied' : result.state,
    ]);
  sheet.columns.forEach((c) => (c.width = 24));
  sheet.getRow(1).font = { bold: true };
  return {
    filename: 'stock-adjustment-results.xlsx',
    base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}
module.exports = { download, upload, parse, headers, scoped, report };
