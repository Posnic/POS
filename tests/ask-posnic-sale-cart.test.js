'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

test('the normal document-to-sale loader preserves fractional draft quantities', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
  const start = source.indexOf('PosnicPro.sales.loadDocumentIntoCart = function');
  const code = source.slice(start, source.indexOf('\n};', start) + 3);
  const dom = new JSDOM('<input id="sales_new_item_name"><input id="touchsale_item_qtytea" value="1">');
  const $ = require('jquery')(dom.window);
  $.expr.pseudos.visible = () => true;
  const callbacks = new Map(); let next = 0, recalculations = 0, loaded = false;
  $('#touchsale_item_qtytea').on('keyup', () => { recalculations++; });
  const PosnicPro = { sales: { itemsMenu: { addToLineItemsList: () => {} } } };
  vm.runInNewContext(code, { PosnicPro, $, hasher: { setHash: () => {} }, setInterval: (fn) => { callbacks.set(++next, fn); return next; }, clearInterval: (id) => callbacks.delete(id) });
  PosnicPro.sales.loadDocumentIntoCart({ lines: [{ item_id: 'tea', qty: 0.5 }], honour: false, onLoaded: () => { loaded = true; } });
  [...callbacks.values()][0]();
  [...callbacks.values()][0]();
  assert.equal($('#touchsale_item_qtytea').val(), '0.5');
  assert.equal(recalculations, 1);
  assert.equal(loaded, true);
  assert.equal(callbacks.size, 0);
});
