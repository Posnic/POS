'use strict';
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const inventory = require('./mobile-inventory');
const spoilage = require('./spoilage');
const headers = [
  'Product',
  'SKU',
  'Unit',
  'Available stock',
  'Spoiled quantity',
  'Reason',
  'Remarks',
  'Item ID',
  'Branch ID',
];
async function download(req) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Spoilage');
  sheet.addRow(headers);
  let after;
  do {
    const page = await inventory.catalogue({
      ...req,
      query: { ...req.query, kind: 'items', tracked: 'true', limit: undefined, after },
    });
    for (const r of page.rows)
      sheet.addRow([r.name, r.sku, r.unit, r.quantity / 1000, '', '', '', r.id, page.branchId]);
    after = page.next;
    if (sheet.rowCount > 20001) throw Error('Filter to fewer than 20,000 products.');
  } while (after);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  [40, 18, 12, 18, 20, 24, 45, 28, 28].forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
    if (i >= 7) sheet.getColumn(i + 1).hidden = true;
  });
  for (const n of [5, 6, 7])
    sheet.getColumn(n).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5ED' } };
  for (let i = 2; i <= sheet.rowCount; i++)
    sheet.getCell(i, 6).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"' + spoilage.reasons.join(',') + '"'],
    };
  return {
    filename: 'spoilage-entry.xlsx',
    base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}
async function upload(req) {
  const c = await inventory.access(req, true),
    file = req.file;
  if (!file || !file.buffer || file.buffer.length > 10 * 1024 * 1024)
    throw Error('Choose an Excel or CSV sheet up to 10 MB.');
  const book = new ExcelJS.Workbook();
  if (/\.xlsx$/i.test(file.originalname)) {
    require('./price-sheet').checkWorkbookArchive(file.buffer);
    await book.xlsx.load(file.buffer);
  } else if (/\.csv$/i.test(file.originalname))
    await book.csv.read(Readable.from(file.buffer), { map: (v) => v });
  else throw Error('Choose an XLSX or CSV file.');
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 20001) throw Error('Use a sheet with at most 20,000 products.');
  const names = sheet.getRow(1).values.slice(1);
  if (new Set(names).size !== names.length || headers.some((h) => !names.includes(h)))
    throw Error('Use the downloaded spoilage sheet and keep its headings.');
  const lines = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const value = (h) => row.getCell(names.indexOf(h) + 1).value,
      qty = value('Spoiled quantity');
    if (qty == null || qty === '') return;
    if (!['number', 'string'].includes(typeof qty) || !/^\d+(\.\d{1,3})?$/.test(String(qty).trim()))
      throw Error(
        'Row ' +
          n +
          ': enter a positive quantity with up to three decimals; formulas are not supported.'
      );
    if (String(value('Branch ID')) !== String(c.branchId))
      throw Error('This sheet belongs to another branch.');
    lines.push({
      itemId: String(value('Item ID')),
      quantity: Math.round(Number(qty) * 1000),
      reason: value('Reason'),
      remarks: value('Remarks'),
    });
    if (lines.length > 200) throw Error('Upload at most 200 selected products at a time.');
  });
  return { lines: await spoilage.previewLines(req, lines) };
}
module.exports = { download, upload, headers };
