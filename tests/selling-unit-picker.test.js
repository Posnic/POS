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
    const P = { sales: {}, alert: () => {} };
    vm.runInNewContext(source.slice(start, end), { PosnicPro: P, $: () => ({ text: () => '' }), swal: () => ({ then: fn => { callback = fn; } }) });
    P.sales.chooseSellingUnit({ id: 'pipe', unit: 'm', selling_price: 100, available_quantity: 3.048, selling_units: [{ unit: 'ft', factor: .3048, price }] }, row => { selected = row; });
    callback({ dismiss: 'cancel' }); assert.equal(selected, undefined);
    callback({ value: '1' }); assert.equal(selected.unit, 'ft'); assert.equal(selected.selling_price, expected); assert.equal(selected.available_quantity, 10);
  }
});
test('another unit cannot silently merge into the existing product line', () => {
  let selected = false, warned = false;
  const P = { sales: {}, alert: () => { warned = true; } };
  vm.runInNewContext(source.slice(start, end), { PosnicPro: P, $: () => ({ text: () => 'm' }), swal: () => ({ then: fn => fn({ value: '1' }) }) });
  P.sales.chooseSellingUnit({ unit: 'm', selling_price: 100, selling_units: [{ unit: 'ft', factor: .3048 }] }, () => { selected = true; });
  assert.equal(selected, false); assert.equal(warned, true);
});
