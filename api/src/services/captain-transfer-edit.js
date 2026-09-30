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
module.exports = { metadata };
