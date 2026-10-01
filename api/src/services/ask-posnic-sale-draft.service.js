'use strict';
const { ObjectId } = require('mongodb');
const math = require('./document-math');
const { activeCatalog } = require('./ask-posnic-catalog');

function parse(text) {
  if (typeof text !== 'string' || text.length > 10000) throw new Error('Enter up to 30 item lines.');
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length || rows.length > 30) throw new Error('Enter one to 30 item lines.');
  return rows.map((line) => {
    const match = line.match(/^(\d+(?:\.\d{1,3})?)\s*[x×]\s+(.{1,200})$/i);
    if (!match || Number(match[1]) <= 0 || Number(match[1]) > 100000) throw new Error('Use quantity x exact item name or barcode, for example: 2 x Tea.');
    return { qty: Number(match[1]), query: match[2].trim() };
  });
}
function snapshot(item, qty) {
  const price = Number(item.selling_price), tax = Number(item.tax || 0);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error(`Check the catalog price and tax for ${item.name}.`);
  if (!Number.isSafeInteger(Math.round(qty * price * 100))) throw new Error('The requested line total is too large.');
  return { item_id: String(item._id), item_name: String(item.name || '').slice(0, 200), qty, unit_price: price, tax_value: tax, tax_type: String(item.tax_type || ''), unit: item.unit || '' };
}
async function prepare(model, input) {
  if (!model.branchId || !model.licenseId) throw new Error('An authenticated shop and outlet are required.');
  const rows = parse(input.lines_text), items = await model.getCollection('items'), selected = new Map();
  for (const row of rows) {
    const escaped = row.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alternatives = [{ name: { $regex: `^${escaped}$`, $options: 'i' } }, { itemid: row.query }, { barcode_id: row.query }, { sku: row.query }];
    if (ObjectId.isValid(row.query)) alternatives.push({ _id: new ObjectId(row.query) });
    const matches = await items.find(model.getContextMatch({ ...activeCatalog(), $or: alternatives }), { projection: { name: 1, selling_price: 1, tax: 1, tax_type: 1, unit: 1 } }).limit(2).toArray();
    if (!matches.length) throw new Error(`No sellable item matches "${row.query}" in this outlet.`);
    if (matches.length > 1) throw new Error(`"${row.query}" matches more than one item. Use its unique barcode or SKU.`);
    const item = matches[0], key = String(item._id), qty = (selected.get(key)?.qty || 0) + row.qty;
    if (qty > 100000) throw new Error('Combined quantity is too large.');
    selected.set(key, snapshot(item, qty));
  }
  const lines = Array.from(selected.values());
  const parsed = math.normalizeLines(lines, 'sales draft');
  if (parsed.error) throw new Error(parsed.error);
  const totals = math.computeTotals({ lines: parsed.lines, charges: [], discount: null });
  return { customer_name: String(input.customer_name || 'Walk-In-Customer').trim().slice(0, 200) || 'Walk-In-Customer', lines, total: totals.total, tax_total: totals.tax_total, notes: 'Sales draft. Review and convert through the normal quotation workflow.' };
}
async function validate(model, payload) {
  if (!model.branchId || !model.licenseId || !Array.isArray(payload.lines) || !payload.lines.length) throw new Error('Prepare a new sales draft.');
  const ids = payload.lines.map((line) => new ObjectId(line.item_id));
  const items = await (await model.getCollection('items')).find(model.getContextMatch({ _id: { $in: ids }, ...activeCatalog() })).toArray();
  const byId = new Map(items.map((item) => [String(item._id), item]));
  for (const line of payload.lines) {
    const item = byId.get(line.item_id);
    if (!item || JSON.stringify(snapshot(item, line.qty)) !== JSON.stringify(line)) throw new Error('Catalog details changed. Prepare a new sales draft to review current prices and tax.');
  }
}
module.exports = { parse, prepare, validate };
