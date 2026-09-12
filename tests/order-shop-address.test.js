'use strict';

/*
 * order/assets/shop-address.js - the shop stays in the address bar.
 *
 * Owner, looking at the sandbox: "i see develop.posnic.io/order/products.html
 * i see items but its missing ABC as branch. its better to keep user might
 * refresh page or copy page for something else. he might miss the branch."
 *
 * Every inner page resolves against <base href="/order/">, so the walk from
 * the arrival page dropped the shop. This file puts it back, and reads a
 * copied link that names ANOTHER shop as an arrival there. Run in a vm with a
 * fake window, the way the service-point test does, because the file is a
 * browser IIFE that acts the moment it runs.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'order', 'assets', 'shop-address.js'), 'utf8');

/** A page at `url`, on a browser that remembers `held` as its shop. */
function pageAt(url, held) {
  const parsed = new URL(url, 'https://shop.example');
  const store = new Map();
  if (held) store.set('posnic_store', held);
  const calls = { replaced: [], went: [] };
  const location = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  location.replace = (to) => calls.went.push(to);
  const history = {
    state: { kept: true },
    replaceState(state, title, to) {
      calls.replaced.push({ state, to });
      const next = new URL(to, 'https://shop.example');
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    },
  };
  const sandbox = {
    window: { location, history },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    String,
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'shop-address.js' });
  return { api: sandbox.window.ShopAddress, location, calls };
}

const bar = (l) => l.pathname + l.search + l.hash;

test('an inner page puts the remembered shop into the address bar, keeping query and fragment', () => {
  const a = pageAt('/order/products.html', 'ABC');
  assert.strictEqual(bar(a.location), '/order/ABC/products.html');
  assert.strictEqual(a.calls.replaced.length, 1);
  assert.deepStrictEqual(a.calls.replaced[0].state, { kept: true }, 'history state was dropped in the rewrite');
  assert.deepStrictEqual(a.calls.went, [], 'the page navigated instead of rewriting its bar');

  const b = pageAt('/order/thankyou.html?token=42#top', 'AZ100');
  assert.strictEqual(bar(b.location), '/order/AZ100/thankyou.html?token=42#top');

  const c = pageAt('/order/payment.html?lang=ta', 'fj5af');
  assert.strictEqual(bar(c.location), '/order/fj5af/payment.html?lang=ta');
});

test('a bar that already names the shop is left alone', () => {
  const { location, calls } = pageAt('/order/ABC/cart.html', 'ABC');
  assert.strictEqual(bar(location), '/order/ABC/cart.html');
  assert.deepStrictEqual(calls.replaced, []);
  assert.deepStrictEqual(calls.went, []);
});

test('a copied link naming another shop is an arrival there', () => {
  /* The browser holds XYZ; the link says ABC. The link wins, through the
     arrival page, which switches shops the proper way. */
  const { calls } = pageAt('/order/ABC/cart.html?token=1', 'XYZ');
  assert.deepStrictEqual(calls.went, ['/order/ABC']);
  assert.deepStrictEqual(calls.replaced, [], 'the bar was rewritten on a page being left');
});

test('the arrival page manages its own address: nothing happens there', () => {
  for (const url of ['/order/', '/order/ABC', '/order/ABC/table/5', '/order/index.html?branch=ABC', '/order/ABC/venue/RC/123']) {
    const { location, calls } = pageAt(url, 'XYZ');
    assert.deepStrictEqual(calls.replaced, [], url + ' was rewritten');
    assert.deepStrictEqual(calls.went, [], url + ' navigated');
    assert.strictEqual(location.pathname, new URL(url, 'https://x').pathname);
  }
});

test('a browser that remembers nothing waits for the branch row, which then sets the bar', () => {
  const { api, location, calls } = pageAt('/order/products.html', '');
  assert.deepStrictEqual(calls.replaced, []);
  assert.strictEqual(api.fromPath(), '');
  assert.strictEqual(api.page(), 'products.html');
  /* What rememberShop() does once the row is read. */
  assert.strictEqual(api.follow('ABC'), false);
  assert.strictEqual(api.keep('ABC'), true);
  assert.strictEqual(bar(location), '/order/ABC/products.html');
  /* The row disagrees with the bar: a link to follow. */
  assert.strictEqual(api.follow('XYZ'), true);
  assert.deepStrictEqual(calls.went, ['/order/ABC']);
});

test('only a store address goes into the bar', () => {
  const { api, location, calls } = pageAt('/order/cart.html', '');
  for (const bad of ['', 'ab', 'toolongtobeastore', '../admin', 'a.b', 'AB C', null, undefined]) {
    assert.strictEqual(api.keep(bad), false, JSON.stringify(bad) + ' was written into the bar');
  }
  assert.strictEqual(bar(location), '/order/cart.html');
  assert.deepStrictEqual(calls.replaced, []);
});

test('the menu mount keeps its own prefix', () => {
  const { location } = pageAt('/menu/products.html', 'ABC');
  assert.strictEqual(location.pathname, '/menu/ABC/products.html');
});

test('rememberShop hands the branch row to the address bar, and follows a link to another shop first', async () => {
  /* The indexedDB.js side of the contract, lifted the way the UX test does. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'order', 'indexedDB.js'), 'utf8');
  const lift = (name) => {
    const at = src.indexOf('function ' + name + '(');
    const start = src.lastIndexOf('\n', at) + 1;
    const end = src.indexOf('\n}\n', at) + 3;
    return src.slice(start, end);
  };
  const seen = [];
  const sandbox = {
    window: {
      ShopAddress: {
        follow: (held) => {
          seen.push(['follow', held]);
          return held === 'XYZ';
        },
        keep: (held) => {
          seen.push(['keep', held]);
          return true;
        },
      },
    },
    document: { dispatchEvent() {} },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    getData: async () => [{ id: 'ABC', name: 'Tea House' }],
    String,
    Array,
    Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['const BRANCH_STORE = "branch";', 'const shop = { name: "" };', lift('storeAddressFromRow'), lift('rememberShop')].join('\n'),
    sandbox
  );
  await sandbox.rememberShop();
  assert.deepStrictEqual(seen, [
    ['follow', 'ABC'],
    ['keep', 'ABC'],
  ]);

  seen.length = 0;
  sandbox.getData = async () => [{ id: 'XYZ' }];
  await sandbox.rememberShop();
  assert.deepStrictEqual(seen, [['follow', 'XYZ']], 'the bar was rewritten on a page that is being left');
});
