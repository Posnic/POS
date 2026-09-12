'use strict';

/*
 * The card on the console's Online Orders screen, actually drawn.
 *
 * A delivery order carried a name and an address on the sale and printed
 * them on the ticket, and the card the staff decide from showed neither -
 * nor how the order travels, nor the note on any line. A card nobody can
 * act on is an order that gets rejected or delivered wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'online_orders.js'),
  'utf8'
);

function card(order) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'order', 'assets', 'jquery-3.7.1.min.js'), 'utf8'));
  const sandbox = {
    window,
    document: window.document,
    $: window.$,
    PosnicPro: {
      i18n: { t: (key, fallback) => fallback },
      local: { get: () => '₹' },
      HideSideBarModal() {},
      get() {},
      post() {},
    },
    Number,
    String,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const html = sandbox.PosnicPro.onlineorders.card(order);
  window.document.body.innerHTML = html;
  return window.document.body;
}

const base = {
  sale_id: 's1',
  sales_id: 'SID42',
  token_id: 'B042',
  items: [
    { name: 'Chicken Biryani', quantity: 2, note: 'less spicy' },
    { name: 'Butter Naan', quantity: 2, note: '' },
  ],
  total: 760,
  delivery_fee: 0,
  note: 'Ring the bell',
  customer_phone: '9876543210',
};

test('a delivery shows how it travels, who it is for and where', () => {
  const body = card({ ...base, fulfilment: 'delivery', customer_name: 'Asha', customer_address: '12, Beach Road', delivery_fee: 30 });
  const text = body.textContent;
  assert.match(text, /Delivery/);
  assert.match(text, /Asha/);
  assert.match(text, /12, Beach Road/);
  assert.match(text, /less spicy/, 'the note on a line is not shown');
  assert.match(text, /Ring the bell/, 'the order note is not shown');
  assert.match(text, /₹30\.00/, 'the delivery fee is not shown');
});

test('a delivery with no address says so rather than showing nothing', () => {
  const body = card({ ...base, fulfilment: 'delivery', customer_name: '', customer_address: '' });
  assert.match(body.textContent, /No address given/);
});

test('a table order shows the table and how many', () => {
  const body = card({ ...base, fulfilment: 'dine_in', destination: '5', person_count: 3 });
  assert.match(body.textContent, /Dine in/);
  assert.match(body.textContent, /5 · 3 pax|5 . 3 pax/);
});

test('a collection order says to collect at the counter', () => {
  const body = card({ ...base, fulfilment: 'pickup', customer_name: 'Ravi' });
  assert.match(body.textContent, /Pickup/);
  assert.match(body.textContent, /Collect at the counter/);
  assert.match(body.textContent, /Ravi/);
});

test('the queue API carries what the card needs', () => {
  const repo = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'repositories', 'sale.repository.js'), 'utf8');
  const fn = repo.slice(repo.indexOf('async pendingOnlineOrders('));
  const block = fn.slice(0, fn.indexOf('catch (error)'));
  for (const field of ['customer_name', 'customer_address', 'person_count']) {
    assert.match(block, new RegExp(field + ': 1'), field + ' is not projected');
    assert.match(block, new RegExp(field + ': '), field + ' is not mapped');
  }
  assert.match(block, /note: item\.item_description/, 'the line note is not mapped');
});
