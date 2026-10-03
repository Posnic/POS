const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/kot.js'), 'utf8');
function setup(items) {
  const dom = new JSDOM('<div class="loader-table-kot-detail"></div>', { runScripts: 'outside-only' });
  const w = dom.window, $ = require('jquery')(w), requests = [];
  w.$ = $;
  w.setTimeout = () => {};
  w.PosnicPro = { kot: {}, i18n: { t: (_, fallback) => fallback }, alert() {},
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    get(params, done) {
      done(typeof params === 'string'
        ? { type: 'success', data: { _id: 'order', items, sale_status: 'pending' } }
        : { suggestions: [{ data: { item_id: 'new-product', selling_price: 45 } }] });
    },
    put(params, done) { requests.push(JSON.parse(params.data)); done({ type: 'success' }); },
  };
  w.eval(source.slice(0, source.indexOf('\n};') + 3));
  w.PosnicPro.kot.refreshTables = () => {};
  return { w, $, requests, close: () => w.close() };
}
const saved = { item_id: 'water', line_id: 'captain-1', item_quantity: 1, item_price: 28.57,
  pricing: { version: 1, selling_price: 30 }, held: true, seat: 2, course: 'Main',
  allergies: ['milk'], item_description: 'No ice', modifiers: [] };

test('desktop quick Add retains existing preparation and inclusive selling price', () => {
  const x = setup([saved]);
  x.w.PosnicPro.kot.addProductToKOT('order', 'new-product');
  assert.equal(x.requests.length, 1);
  assert.deepEqual(x.requests[0].items[0], { product_id: 'water', line_id: 'captain-1',
    quantity: 1, price: 30, held: true, seat: 2, course: 'Main', allergies: ['milk'],
    item_description: 'No ice', modifiers: [] });
  assert.deepEqual(x.requests[0].items[1], { product_id: 'new-product', quantity: 1, price: 45 });
  x.close();
});

test('desktop Modify sends separate saved lines and preserves fractional quantities', () => {
  const second = { ...saved, line_id: 'captain-2', seat: 3, item_description: 'With ice' };
  const x = setup([saved, second]);
  const kot = x.w.PosnicPro.kot;
  x.$('body').append(kot.buildTableDetailsPanel('4', [{ _id: 'order', items: [saved, second] }], 1));
  kot.updateTotalDisplay = () => {};
  kot.initModifyUpdateHandlers();
  x.$('.kot-modify-btn').trigger('click');
  x.$('[data-line-id="captain-1"] .qty-input').val('2');
  x.$('[data-line-id="captain-2"] .qty-input').val('1.5');
  kot.addProductToEditMode('order', 'new-product', 'Paratha', 47.25, 45);
  x.$('.kot-update-btn').trigger('click');
  assert.equal(x.requests.length, 1);
  assert.deepEqual(x.requests[0].items.map(l => [l.line_id, l.quantity, l.price, l.seat]),
    [['captain-1', 2, 30, 2], ['captain-2', 1.5, 30, 3], [undefined, 1, 45, undefined]]);
  assert.equal(x.$('.loadingSpinner').length, 0);
  x.close();
});

test('server compatibility does not guess among duplicate preparations or duplicate payload lines', () => {
  const lines = require('../api/src/utils/order-line');
  assert.throws(() => lines.reconcile([{ product_id: 'water' }], [saved, { ...saved, line_id: 'other' }]), /ambiguous_order_lines/);
  assert.throws(() => lines.reconcile([{ product_id: 'water' }, { product_id: 'water' }], [saved]), /ambiguous_order_lines/);
});

test('Add Item saves the entered quantity and preserves existing preparation details', () => {
  const x = setup([saved]);
  x.$('body').append('<div id="kot_add_item_modal"><div class="modal-content"></div></div>');
  x.$('#kot_add_item_modal').data('sale-id', 'order');
  let completed;
  x.w.PosnicPro.kot.addItemToOrder('new-product', 2.5, value => { completed = value; });
  assert.equal(completed, true);
  assert.equal(x.requests[0].items[0].line_id, 'captain-1');
  assert.equal(x.requests[0].items[0].price, 30);
  assert.equal(x.requests[0].items[0].item_description, 'No ice');
  assert.deepEqual(x.requests[0].items[1], { product_id: 'new-product', quantity: 2.5, price: 45 });
  assert.equal(x.$('#kot_add_item_modal').data('kot-dirty'), true);
  assert.equal(x.$('.loadingSpinner').length, 0);
  x.close();
});

test('quantity selection cancels cleanly and repeated Enter cannot submit twice', () => {
  const x = setup([]);
  x.$('body').append('<input id="search">');
  const $search = x.$('#search');
  let calls = 0, finish;
  x.w.PosnicPro.kot.searchQuantity($search, { item_name: 'Tea' }, (_data, qty, done) => {
    calls++; assert.equal(qty, 3); finish = done;
  });
  const $qty = x.$('.kot-search-quantity input');
  $qty.val('3').trigger(x.$.Event('keydown', { key: 'Enter' }));
  $qty.trigger(x.$.Event('keydown', { key: 'Enter' }));
  assert.equal(calls, 1);
  finish(false);
  assert.equal($qty.prop('disabled'), false);
  $qty.trigger(x.$.Event('keydown', { key: 'Escape' }));
  assert.equal(x.$('.kot-search-quantity').length, 0);
  assert.equal($search.prop('disabled'), false);
  assert.equal(calls, 1);
  x.close();
});
