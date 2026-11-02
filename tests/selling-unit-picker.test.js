const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');
const start = source.indexOf('PosnicPro.sales.chooseSellingUnit =');
const end = source.indexOf('PosnicPro.sales.askSearchQuantity =', start);
test('unit picker supports automatic and explicit prices and cancellation', async () => {
  for (const [price, expected] of [[null, 30.48], [32, 32]]) {
    let selected, callback;
    const P = { sales: {}, i18n: { t: (_key, fallback) => fallback }, alert: () => {} };
    vm.runInNewContext(source.slice(start, end), { crypto: require('node:crypto'), PosnicPro: P, $: () => ({ text: () => '' }), swal: () => ({ then: fn => { callback = fn; } }) });
    P.sales.chooseSellingUnit({ id: 'pipe', unit: 'm', selling_price: 100, available_quantity: 3.048, selling_units: [{ unit: 'ft', factor: .3048, price }] }, row => { selected = row; });
    callback({ dismiss: 'cancel' }); assert.equal(selected, undefined);
    callback({ value: '1' }); assert.equal(selected.unit, 'ft'); assert.equal(selected.selling_price, expected); assert.equal(selected.available_quantity, 10);
  }
});
test('another unit uses a distinct line while repeated units reuse their cart row', () => {
  let selected;
  const P = { sales: { SaleTableLineItems: {
    metres: { item_id: 'metres', product_id: 'pipe', addSalesLineItemUnit: 'm' },
    feet: { item_id: 'feet', product_id: 'pipe', addSalesLineItemUnit: 'ft' },
  } }, i18n: { t: (_key, fallback) => fallback }, alert: () => { throw Error('unexpected warning'); } };
  vm.runInNewContext(source.slice(start, end), { crypto: require('node:crypto'), PosnicPro: P, $: () => ({ text: () => 'm' }), swal: () => ({ then: fn => fn({ value: '1' }) }) });
  P.sales.chooseSellingUnit({ id: 'pipe', unit: 'm', selling_price: 100, selling_units: [{ unit: 'ft', factor: .3048 }] }, row => { selected = row; });
  assert.equal(selected.id, 'feet');
  assert.equal(selected.product_id, 'pipe');
  assert.equal(selected.line_id, 'feet');
  assert.equal(selected.unit, 'ft');
});

test('alternate-unit price editing cannot overwrite the base item price', () => {
  const begin = source.indexOf('    canUpdateItem: function (id)');
  const finish = source.indexOf('    _save: function', begin);
  const P = { sales: { SaleTableLineItems: {
    legacy: {},
    base: { unit_conversion: { unit: 'm', base_unit: 'm', factor: 1 } },
    feet: { unit_conversion: { unit: 'ft', base_unit: 'm', factor: .3048 } },
    pack: { unit_conversion: { unit: 'length', base_unit: 'm', factor: 6 } },
  } } };
  const editor = vm.runInNewContext('({' + source.slice(begin, finish) + '})', { PosnicPro: P });
  assert.equal(editor.canUpdateItem('legacy'), true);
  assert.equal(editor.canUpdateItem('base'), true);
  assert.equal(editor.canUpdateItem('feet'), false);
  assert.equal(editor.canUpdateItem('pack'), false);
});
