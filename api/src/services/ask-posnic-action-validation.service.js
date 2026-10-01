'use strict';

const { ObjectId } = require('mongodb');
const { activeCatalog } = require('./ask-posnic-catalog');
const { incoming } = require('./ask-posnic-inventory-drafts.service');

async function validateInventory(type, payload, model) {
  if (!['purchase_order', 'stock_count'].includes(type)) return;
  if (type === 'purchase_order' && payload.source === 'demand')
    return require('./ask-posnic-reorder.service').validate(model, payload);
  const lines =
    type === 'purchase_order'
      ? (payload.orders || []).flatMap((order) =>
          (order.items || []).map((line) => ({
            ...line,
            supplier_id: order.supplier_id,
            supplier_name: order.supplier_name,
          }))
        )
      : payload.items || [];
  if (!lines.length || lines.some((line) => !ObjectId.isValid(String(line.item_id))))
    throw new Error('Prepare a new draft with current inventory.');
  const ids = lines.map((line) => new ObjectId(String(line.item_id)));
  const rows = await (
    await model.getCollection('items')
  )
    .find(model.getContextMatch({ _id: { $in: ids }, ...activeCatalog(true) }))
    .toArray();
  const pending = type === 'purchase_order' ? await incoming(model, ids) : new Map();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  for (const line of lines) {
    const item = byId.get(String(line.item_id));
    const expected = Number(
      type === 'purchase_order' ? line.current_quantity : line.expected_quantity
    );
    if (
      !item ||
      Number(item.available_quantity || 0) !== expected ||
      String(item.name) !== String(line.item_name) ||
      String(item.unit || '') !== String(line.unit || '') ||
      String(item.itemid || '') !== String(line.barcode_id || '')
    )
      throw new Error(
        'Inventory changed since this draft was prepared. Prepare a new draft to review the changes.'
      );
    if (
      type === 'purchase_order' &&
      (String(item.supplier_id || '') !== String(line.supplier_id || '') ||
        String(item.supplier_name || '') !== String(line.supplier_name || '') ||
        Number(item.cost_price || 0) !== Number(line.unit_cost))
    )
      throw new Error(
        'Supplier or cost changed since this draft was prepared. Prepare a new draft.'
      );
    if (
      type === 'purchase_order' &&
      (line.incoming_quantity === undefined ||
        (pending.get(String(item._id)) || 0) !== line.incoming_quantity)
    )
      throw new Error(
        'Incoming orders changed or were not checked. Prepare a new draft to review current quantities.'
      );
  }
}

module.exports = { validateInventory };
