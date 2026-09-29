'use strict';
// A preparation amount is a per-item instruction, not a bill total.
function snapshot(line) {
  const value = line && line.priced_at_table;
  const amount = Number(value);
  return value !== null && value !== undefined && Number.isFinite(amount) && amount > 0
    ? { priced_at_table: amount } : {};
}
function forSaleItem(product, line, price) {
  const special = product.open_price === true || Number(product.selling_price || 0) <= 0 ||
    String(product.item_status || line.item_status || '').toLowerCase() === 'instant';
  return special ? snapshot({ priced_at_table: price }) : {};
}
module.exports = { snapshot, forSaleItem };
