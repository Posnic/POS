'use strict';
const allocation = require('../utils/transfer-allocation');
const orderLine = require('../utils/order-line');
const { BSON } = require('mongodb');
const clone = value => BSON.EJSON.deserialize(BSON.EJSON.serialize(value));
const lineFields = ['name', 'item_name', 'quantity', 'item_quantity', 'qty', 'unit_price', 'item_base_price', 'item_price',
  'item_total', 'total', 'total_amount', 'item_discount', 'item_tax', 'tax_amount', 'tax', 'tax_type',
  'cgst_tax', 'sgst_tax', 'igst_tax', 'tax_components'];
const saleFields = ['sales_sub_total', 'subtotal', 'total', 'items_subtotal', 'items_total', 'sales_total',
  'discount', 'tax', 'sales_tax', 'round_off', 'sales_round_off'];
const quantity = line => Number(line.quantity ?? line.item_quantity ?? line.qty);

// Metadata-only changes must not recalculate transferred pennies using today's
// catalogue. Return null for financial edits; they need explicit reconciliation.
function metadata(sale, proposed, branch) {
  const saved = allocation.read(sale, branch);
  if (!saved) return null;
  for (const field of ['extra_discount', 'extra_discount_type', 'sale_extra_discount'])
    if (proposed[field] !== undefined && proposed[field] !== sale[field]) return null;
  const before = sale.items || [], after = proposed.items || [];
  if (before.length !== after.length || before.some((line, index) => !line || !after[index] ||
      orderLine.key(line) !== orderLine.key(after[index]) || orderLine.product(line) !== orderLine.product(after[index]) ||
      quantity(line) !== quantity(after[index]) || !!line.return !== !!after[index].return ||
      !!line.cancelled !== !!after[index].cancelled || line.status !== after[index].status)) return null;
  const result = { ...proposed, items: clone(after) };
  result.items.forEach((line, index) => {
    for (const field of lineFields) {
      if (before[index][field] === undefined) delete line[field];
      else line[field] = clone(before[index][field]);
    }
  });
  // Preserve historical aliases and omit newly calculated aliases which the
  // original bill did not have. The caller replaces its proposed $set fields.
  for (const field of saleFields) {
    if (sale[field] !== undefined) result[field] = clone(sale[field]);
    else delete result[field];
  }
  result.captain_transfer_allocation = allocation.seal({ ...sale, ...result }, branch, saved);
  return result;
}
// Reconcile reductions from the existing allocation, never current catalogue
// prices. Increases/new preparations and bill-level discount changes still need
// their own pricing policy. The ordinary editor owns cancellation history and
// stock side effects; this function only reconciles its monetary projection.
function reduce(sale, proposed, branch) {
  const saved = allocation.read(sale, branch);
  if (!saved || Number(sale.extra_discount || 0) || Number(sale.sale_extra_discount || 0)) return null;
  for (const field of ['extra_discount', 'extra_discount_type', 'sale_extra_discount'])
    if (proposed[field] !== undefined && proposed[field] !== sale[field]) return null;
  const { divide, units } = require('./captain-transfer-plan');
  const { applyMoney } = require('./captain-transfer-projection');
  const before = new Map((sale.items || []).filter(Boolean).map(line => [orderLine.key(line), line]));
  const seen = new Set(), side = { lines: [], components: {}, totalMinor: 0 };
  const result = { ...proposed, items: clone(proposed.items || []) };
  for (const line of result.items) {
    if (!line) return null;
    const key = orderLine.key(line), old = before.get(key);
    if (!old || seen.has(key) || orderLine.product(old) !== orderLine.product(line) ||
        !!old.return !== !!line.return || !!old.cancelled !== !!line.cancelled || old.status !== line.status) return null;
    seen.add(key);
    const count = units(quantity(line)), previous = units(quantity(old));
    if (!count || count > previous) return null;
    const allocated = saved.lines.find(row => row.lineKey === key);
    if (!allocated) return null;
    for (const field of lineFields) {
      if (old[field] === undefined) delete line[field];
      else line[field] = clone(old[field]);
    }
    for (const field of ['quantity', 'item_quantity', 'qty'])
      if (old[field] !== undefined) line[field] = count / 1000;
    const components = allocated.components.map(row => ({ key: row.key,
      minor: divide(row.minor, count, previous - count)[0] }));
    const amountMinor = components.reduce((sum, row) => sum + row.minor, 0);
    side.lines.push({ ...clone(allocated), quantity: count / 1000, components, amountMinor });
    side.totalMinor += amountMinor;
    for (const row of components) side.components[row.key] = (side.components[row.key] || 0) + row.minor;
  }
  if (side.totalMinor < 0) return null;
  return applyMoney(sale, result, branch, side);
}
module.exports = { metadata, reduce };
