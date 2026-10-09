'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  const nodes = new Map();
  function $(key) {
    if (!nodes.has(key)) {
      const node = { value: '', textValue: '', handlers: {}, val(v) { if (v === undefined) return this.value; this.value = v; return this; }, text(v) { this.textValue = v; return this; }, html(v) { if (v === undefined) return this.textValue; return this; }, one(event, fn) { this.handlers[event] = fn; return this; }, modal(action) { if (action === 'hide' && this.handlers['hidden.bs.modal']) { const fn = this.handlers['hidden.bs.modal']; delete this.handlers['hidden.bs.modal']; fn(); } return this; } };
      for (const name of ['toggle', 'prop', 'empty', 'removeClass', 'attr', 'hide', 'show', 'appendTo', 'on']) node[name] = function () { return this; };
      nodes.set(key, node);
    }
    return nodes.get(key);
  }
  const storage = new Map();
  let branch = 'branch-a', request, route;
  const added = [];
  const PosnicPro = { local: { get: () => branch }, i18n: { t: (key, fallback) => fallback }, ACLForModule() {}, alert() {}, receiving_lineitems: [], get(url, yes, no) { request = { url, yes, no }; }, items: { _adjRows: {}, openStockAdjustment() { this._adjRows = {}; }, adjReasonChanged() {} }, receivings: { clearReceivingForm() {}, addReceivingLineItems(r) { added.push(r); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/lowstock.js'), 'utf8'), { PosnicPro, $, document: {}, setTimeout, hasher: { setHash(v) { route = v; } }, sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } });
  const app = PosnicPro.lowstockitems;
  app.restockContext();
  return { app, $, PosnicPro, added, request: () => request, route: () => route, branch(v) { branch = v; } };
}
test('restock starts at one, does not navigate, and reopening does not duplicate', () => {
  const t = setup(); t.app.loadLowStockValue('a');
  t.request().yes({ type: 'success', data: { name: 'Cable', available_quantity: 9 } });
  assert.equal(t.app._restock.a.qty, 1);
  t.app._restock.a.qty = 4; t.app.loadLowStockValue('a');
  assert.equal(t.app._restock.a.qty, 4); assert.equal(t.route(), undefined);
});
test('invalid quantities cannot finish and failed fetch leaves no phantom row', () => {
  const t = setup(); t.app.loadLowStockValue('a'); t.request().no();
  assert.equal(Object.keys(t.app._restock).length, 0);
  for (const qty of [0, -1, '', 'NaN', Infinity, 100001]) { t.app._restock.a = { qty }; assert.equal(t.app.validRestock(), false); }
  t.app._restock.a.qty = 2; assert.equal(t.app.validRestock(), true);
});
test('branch switch ignores an outstanding response and keeps baskets separate', () => {
  const t = setup(); t.app.loadLowStockValue('a'); t.branch('branch-b');
  t.request().yes({ type: 'success', data: { name: 'Cable' } });
  assert.equal(Object.keys(t.app._restock).length, 0);
});
test('direct stock addition is reviewed first and only confirmed rows leave basket', () => {
  const t = setup(); t.app._restock = { a: { name: 'Cable', qty: 3, available_quantity: 4 }, b: { name: 'Brush', qty: 2, available_quantity: 0 } };
  t.app.restockDirect();
  assert.equal(t.$('#stock_adjust_mode').val(), 'add');
  assert.equal(t.PosnicPro.items._adjRows.a.qty, 3);
  assert.equal(Object.keys(t.app._restock).length, 2);
  t.app.loadList = () => {};
  t.PosnicPro.items._adjustmentComplete({ updatedItemIds: ['a'] });
  assert.deepEqual(Object.keys(t.app._restock), ['b']);
});
test('purchase transfers a supplier group with selected quantities after form initialisation', () => {
  const t = setup(); t.app._restock = { a: { name: 'Cable', qty: 3, supplier_id: 'supplier-a', company_price: 2 }, b: { name: 'Brush', qty: 2, supplier_id: 'supplier-b' } };
  t.$('#restock_supplier').val('supplier-a'); t.app.restockPurchase();
  assert.equal(t.route(), 'receivings/new'); assert.equal(t.added.length, 0);
  t.app.applyPurchaseDraft();
  assert.equal(t.added.length, 1); assert.equal(t.added[0].item_quantity, 3);
  assert.equal(t.added[0].item_id, 'a'); assert.equal(t.$('#receiving_add_supplier_id').val(), 'supplier-a');
  assert.deepEqual(Object.keys(t.app._restock), ['b']);
});
test('existing purchase is never erased by a restock handoff', () => {
  const t = setup(); t.PosnicPro.receiving_lineitems = [{ item_id: 'existing' }];
  t.app._restock = { a: { name: 'Cable', qty: 1 } }; t.app.restockPurchase();
  assert.equal(t.route(), undefined); assert.equal(t.app._restock.a.qty, 1);
});
