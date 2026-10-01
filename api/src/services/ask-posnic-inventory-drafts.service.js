'use strict';

const { activeCatalog } = require('./ask-posnic-catalog');
const number = (value) => ({ $convert: { input: value, to: 'double', onError: null, onNull: 0 } });
const string = (value) => ({ $convert: { input: value, to: 'string', onError: '', onNull: '' } });

function requireScope(model) {
  if (!model?.branchId || !model?.licenseId) throw new Error('An authenticated shop and outlet are required.');
}

async function incoming(model, ids) {
  requireScope(model);
  const orders = await model.getCollection('purchase_orders');
  const rows = await orders.aggregate([
    { $match: model.getContextMatch({ status: { $in: ['ordered', 'partial'] } }) },
    { $unwind: '$items' },
    { $project: { item_id: string('$items.item_id'), ordered: number('$items.qty_ordered'), received: number('$items.qty_received') } },
    { $match: { item_id: { $in: ids.map(String) } } },
    { $group: { _id: '$item_id', quantity: { $sum: { $max: [0, { $subtract: ['$ordered', '$received'] }] } }, invalid: { $sum: { $cond: [{ $or: [{ $eq: ['$ordered', null] }, { $eq: ['$received', null] }, { $lt: ['$ordered', 0] }, { $lt: ['$received', 0] }] }, 1, 0] } } } },
  ], { maxTimeMS: 15000 }).toArray();
  if (rows.some((row) => row.invalid || !Number.isFinite(row.quantity))) throw new Error('Check quantities on open purchase orders before preparing this draft.');
  return new Map(rows.map((row) => [row._id, row.quantity]));
}

async function lowStock(model) {
  requireScope(model);
  const items = await model.getCollection('items');
  const rows = await items.find(model.getContextMatch({ ...activeCatalog(true), available_quantity: { $lt: 10 } }), {
    projection: { name: 1, itemid: 1, available_quantity: 1, supplier_id: 1, supplier_name: 1, cost_price: 1, unit: 1 },
  }).sort({ available_quantity: 1, _id: 1 }).limit(100).toArray();
  const pending = await incoming(model, rows.map((row) => row._id));
  const grouped = new Map(), skipped = [];
  let totalMinor = 0;
  for (const item of rows) {
    const stock = Number(item.available_quantity), onOrder = pending.get(String(item._id)) || 0;
    const quantity = Math.ceil(Math.max(0, 10 - stock - onOrder) * 1000) / 1000;
    if (!Number.isFinite(stock) || !Number.isFinite(quantity)) throw new Error('Check item stock quantities before preparing this draft.');
    if (!quantity) continue;
    if (!item.supplier_name) { skipped.push(item.name); continue; }
    const cost = Number(item.cost_price || 0);
    if (!Number.isFinite(cost) || cost < 0) throw new Error('Check item costs before preparing this draft.');
    totalMinor += Math.round(quantity * cost * 100);
    if (!Number.isSafeInteger(totalMinor)) throw new Error('The planned order value is too large. Check quantities and costs.');
    const key = String(item.supplier_id || item.supplier_name);
    if (!grouped.has(key)) grouped.set(key, { supplier_id: item.supplier_id ? String(item.supplier_id) : '', supplier_name: item.supplier_name, items: [] });
    grouped.get(key).items.push({ item_id: String(item._id), item_name: item.name, barcode_id: item.itemid || '', qty_ordered: quantity, unit_cost: cost, current_quantity: stock, incoming_quantity: onOrder, unit: item.unit || '' });
  }
  if (!grouped.size) throw new Error('No tracked low-stock items need an order with an assigned supplier after incoming quantities are included.');
  return { source: 'low_stock', orders: [...grouped.values()], skipped_without_supplier: skipped, notes: 'Top up tracked items to 10 units, less outstanding quantities on ordered or partially received purchase orders. Draft orders are excluded. Review pack sizes before ordering.' };
}

async function stockCount(model) {
  requireScope(model);
  const rows = await (await model.getCollection('items')).find(model.getContextMatch(activeCatalog(true)), {
    projection: { name: 1, itemid: 1, available_quantity: 1, unit: 1 },
  }).sort({ name: 1, _id: 1 }).limit(1000).toArray();
  if (!rows.length) throw new Error('There are no tracked inventory items to count.');
  const items = rows.map((item) => {
    const expected = Number(item.available_quantity || 0);
    if (!Number.isFinite(expected)) throw new Error('Check item stock quantities before preparing this draft.');
    return { item_id: String(item._id), item_name: item.name, barcode_id: item.itemid || '', expected_quantity: expected, unit: item.unit || '' };
  });
  return { source: 'inventory', scope: 'all', items };
}

module.exports = { incoming, lowStock, stockCount };
