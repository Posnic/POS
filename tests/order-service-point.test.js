'use strict';

/*
 * order/assets/service-point.js - where the customer is sitting.
 *
 * WHY THIS IS TESTED AT ALL, when it is forty lines of string handling.
 *
 * It decides which prices a customer is quoted and which hotel gets paid. Get
 * it wrong in the direction of remembering too long and a guest ordering at a
 * table downstairs is charged the room markup and a hotel is credited an order
 * it had nothing to do with. Get it wrong the other way and the room number
 * vanishes on the walk to checkout and the food has nowhere to go.
 *
 * Run in a vm with a fake window, because the file is a browser IIFE that
 * publishes onto `window` and there is no bundler here to import it through.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'order', 'assets', 'service-point.js'),
  'utf8'
);

/** A page at `url`, with whatever the tab already remembered. */
function pageAt(url, remembered) {
  const parsed = new URL(url, 'https://shop.example');
  const store = new Map();
  if (remembered) store.set('posnic_service_point', JSON.stringify(remembered));

  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const sandbox = {
    window: { location: { pathname: parsed.pathname, search: parsed.search } },
    sessionStorage,
    URLSearchParams,
    String,
    JSON,
  };
  sandbox.window.sessionStorage = sessionStorage;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'service-point.js' });

  return { api: sandbox.window.KioskServicePoint, store };
}

test('a table code reads as that table, and no venue', () => {
  const { api } = pageAt('/order/AZ100/table/5');
  const point = api.read();
  assert.strictEqual(point.table, '5');
  assert.strictEqual(point.venue, '');
});

test('a venue code reads as the venue and the room', () => {
  const { api } = pageAt('/order/AZ100/venue/RC/123');
  const point = api.read();
  assert.strictEqual(point.venue, 'RC');
  assert.strictEqual(point.unit, '123');
  assert.strictEqual(api.query(), '?venue=RC&unit=123');
});

test('the walk to checkout keeps the room the arrival stored', () => {
  /* home.html, products.html, cart.html and payment.html carry no address.
     Reading the URL on each of those would lose the room at the first tap. */
  const remembered = { table: '', venue: 'RC', unit: '123', destination: null };
  const { api } = pageAt('/order/cart.html', remembered);
  assert.strictEqual(api.read().venue, 'RC');
  assert.strictEqual(api.orderFields().unit, '123');
});

/*
 * THE ONE THAT COSTS MONEY.
 *
 * A guest orders from room 123, comes downstairs, and scans the code on a
 * table. Inheriting the room would charge them the hotel markup at a table in
 * the restaurant and credit the hotel with an order it had nothing to do with,
 * which is an argument with a partner business rather than a bug report.
 */
test('arriving at the plain shop address clears a room from an earlier scan', () => {
  const remembered = { table: '', venue: 'RC', unit: '123', destination: null };
  const { api } = pageAt('/order/AZ100', remembered);
  const point = api.read();
  assert.strictEqual(point.venue, '');
  assert.strictEqual(point.unit, '');
  assert.strictEqual(api.query(), '');
});

test('and scanning a different room replaces the first one', () => {
  const remembered = { table: '', venue: 'RC', unit: '123', destination: { unit: '123' } };
  const { api } = pageAt('/order/AZ100/venue/RC/456', remembered);
  const point = api.read();
  assert.strictEqual(point.unit, '456');
  /* The correction goes with it: last visit's confirmed room must not follow
     a freshly scanned code. */
  assert.strictEqual(point.destination, null);
});

test('the customer correction is what the order carries', () => {
  const { api } = pageAt('/order/AZ100/venue/RC/123');
  api.read();
  api.confirm({ unit: '456', floor: '4' });
  const fields = api.orderFields();
  assert.strictEqual(fields.destination.unit, '456');
  assert.strictEqual(fields.destination.floor, '4');
  /* The link's own room still travels, so the server can see that the two
     disagreed rather than only the corrected value. */
  assert.strictEqual(fields.unit, '123');
});

test('a query string says the same things as a path', () => {
  /* The older shape, still printed on codes in the wild. */
  const { api } = pageAt('/order/?branch=AZ100&venue=RC&unit=9');
  assert.strictEqual(api.read().venue, 'RC');
  assert.strictEqual(api.read().unit, '9');
});

test('nothing in the URL and nothing remembered is the shop own floor', () => {
  const { api } = pageAt('/order/home.html');
  const point = api.read();
  assert.deepStrictEqual(
    { table: point.table, venue: point.venue, unit: point.unit },
    { table: '', venue: '', unit: '' }
  );
  assert.strictEqual(api.query(), '');
});

test('a room number is bounded, because it goes into a URL and onto a ticket', () => {
  const { api } = pageAt('/order/AZ100/venue/RC/' + '9'.repeat(80));
  assert.strictEqual(api.read().unit.length, 24);
});

test('a walk with the shop in the address is not an arrival: the table stays', () => {
  /* assets/shop-address.js keeps the shop in the bar - /order/AZ100/cart.html.
     Read that as an arrival and the table scanned at the door is gone at
     the first tap toward checkout. */
  const remembered = { table: '5', venue: '', unit: '', destination: null };
  for (const url of ['/order/AZ100/cart.html', '/order/AZ100/products.html?lang=ta', '/order/AZ100/thankyou.html?token=9']) {
    const { api } = pageAt(url, remembered);
    assert.strictEqual(api.read().table, '5', url + ' threw the table away');
  }
  /* The arrival shapes still replace it. */
  for (const url of ['/order/AZ100', '/order/AZ100/table/7', '/order/index.html?branch=AZ100', '/order/?branch=AZ100']) {
    const { api } = pageAt(url, remembered);
    assert.notStrictEqual(api.read().table, '5', url + ' did not read as an arrival');
  }
});
