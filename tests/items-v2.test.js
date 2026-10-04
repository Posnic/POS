const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess, payload } = require('../frontend/static/script/js/modules/js/items_v2');
const base = { name: 'Tea', price: '25', cost: '', quantity: '', kind: 'product', stock: 'tracked', zeroStock: '', confirmZero: false, barcode: '', sku: '', description: '', taxType: 'inclusive' };

test('name alone cannot silently create a zero-price item', () => {
  assert.equal(assess({ ...base, price: '' }).field, 'iv2-confirm-zero');
});
test('zero stock needs an explicit choice even after confirming zero price', () => {
  assert.equal(assess({ ...base, price: '', confirmZero: true }).field, 'iv2-zero-stock');
});
test('save for later does not enable negative stock', () => {
  const item = payload({ ...base, price: '', confirmZero: true, zeroStock: 'later' });
  assert.equal(item.selling_price, 0); assert.equal(item.inventory, true); assert.equal(item.negative_stock, false);
});
test('untracked goods are products, not services, and do not retain stale quantities', () => {
  const item = payload({ ...base, stock: 'untracked', quantity: '17' });
  assert.equal(item.item_kind, 'product'); assert.equal(item.inventory, false); assert.equal(item.available_quantity, 0);
});
test('below-zero sales are enabled only by the explicit item choice', () => {
  assert.equal(payload({ ...base, zeroStock: 'negative' }).negative_stock, true);
  assert.equal(payload({ ...base, quantity: '2' }).negative_stock, false);
});
test('services cannot accidentally track stock', () => {
  assert.equal(payload({ ...base, kind: 'service' }).inventory, false);
});
test('invalid and negative prices and stock are blocked', () => {
  for (const price of ['-1', 'Infinity', 'bad']) assert.ok(assess({ ...base, price }).error);
  for (const quantity of ['-1', 'Infinity', 'bad']) assert.equal(assess({ ...base, quantity }).field, 'iv2-quantity');
});
test('tax and item codes use the existing API contract', () => {
  const item = payload({ ...base, quantity: '3', taxId: 'tax', taxName: 'GST', taxRate: '5', taxType: 'exclusive', sku: ' TE ', barcode: '12345' });
  assert.equal(item.tax, 5); assert.equal(item.tax_type, 'exclusive'); assert.equal(item.sku_id, 'TE'); assert.equal(item.available_quantity, 3);
});
