const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');
const start = source.indexOf('    addToLineItemsList: function (item_id)');
const end = source.indexOf('    clickEffect:', start);
function choose(item, SaleAction) {
  const added = [], errors = [];
  const PosnicPro = { alert: (_, message) => errors.push(message), i18n: { t: (_, text) => text },
    sales: { SaleAction, itemCache: { get: (_, cb) => cb(item) },
      itemsMenu: { clickEffect() {} }, addSalesLineItems: item => added.push(item) } };
  const method = vm.runInNewContext('({' + source.slice(start, end) + '}).addToLineItemsList',
    { PosnicPro, $: () => ({ removeClass() {} }), window: { location: { hash: '' } } });
  method('item'); return { added, errors };
}
test('visible sold-out tiles cannot add tracked stock to a sale', () => {
  for (const available_quantity of [0, -1, '0']) {
    const result = choose({ track_inventory: true, available_quantity });
    assert.equal(result.added.length, 0); assert.equal(result.errors.length, 1);
  }
});
test('stock policy preserves in-stock, untracked, allowed-negative, service and return items', () => {
  for (const [item, action] of [
    [{ track_inventory: true, available_quantity: 2 }],
    [{ track_inventory: false, available_quantity: 0 }],
    [{ track_inventory: true, negative_stock: true, available_quantity: 0 }],
    [{ track_inventory: true, item_kind: 'service', available_quantity: 0 }],
    [{ track_inventory: true, available_quantity: 0 }, 'return'],
  ]) {
    const result = choose(item, action);
    assert.equal(result.added.length, 1); assert.equal(result.errors.length, 0);
  }
});
