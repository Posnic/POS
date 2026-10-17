const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
test('desktop availability previews exact changes and retries the same identity after lost response', () => {
  const dom = new JSDOM('<body></body>');
  const $ = require('jquery')(dom.window);
  $.fn.modal = function () { return this; };
  const rows = [
    { id: 'a'.repeat(24), name: '<Milk>', sku: 'A', barcode: '123', price: 100, taxInclusive: true, quantity: 4000, unit: 'each', availableForSale: true },
    { id: 'b'.repeat(24), name: 'Premium milk', sku: 'B', barcodes: ['123'], price: 200, taxInclusive: true, quantity: 8000, unit: 'each', availableForSale: true },
  ];
  const writes = [];
  const pos = { items: {}, get: (url, cb) => cb({ rows, permissions: { write: true } }),
    post: (request, ok, fail) => { writes.push(JSON.parse(request.data)); if (writes.length === 1) fail(); else ok({ results: [{ state: 'confirmed' }] }); } };
  const source = fs.readFileSync('frontend/static/script/js/modules/js/items.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('PosnicPro.items.availability = function')), { PosnicPro: pos, $, document: dom.window.document, crypto: webcrypto, Uint8Array });
  pos.items.availability();
  $('form').trigger('submit');
  assert.match($('.availability-rows').text(), /Different selling prices/);
  assert.equal($('Milk').length, 0);
  $('input[data-item-id="' + rows[1].id + '"]').prop('checked', false);
  $('.availability-review').trigger('click');
  assert.equal(writes.length, 0);
  assert.match($('.availability-preview').text(), /Premium milk.*Available → Hidden/);
  assert.ok(!$('.availability-preview').text().includes('<Milk>'));
  $('.availability-confirm').trigger('click');
  assert.match($('.availability-status').text(), /Not confirmed/);
  $('.availability-confirm').trigger('click');
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].changes.length, 1);
  assert.equal(writes[0].changes[0].itemId, rows[1].id);
  assert.match($('.availability-status').text(), /Server confirmed/);
  assert.equal(rows[1].quantity, 8000);
  dom.window.close();
});
