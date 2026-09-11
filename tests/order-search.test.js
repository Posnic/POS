'use strict';

/**
 * Search on the page people actually order from.
 *
 * THE GAP THIS CLOSED.
 *
 * `/menu` could find a dish and `/order` could not - it had category scrolling
 * and nothing else, so a customer hunting one line in a catalogue of four
 * hundred scrolled until they gave up. The read-only page was better at
 * finding food than the page where money changes hands.
 *
 * Driven rather than read: the real functions, lifted out of the real bundle,
 * with a fake catalogue behind them. A search box wired to nothing passes
 * every static check in this repository.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BUNDLE = path.join(__dirname, '..', 'order', 'indexedDB.js');

const CATALOGUE = {
  starters: [
    { id: 'a1', name: 'Paneer Tikka', description: 'Charred, on skewers', category_name: 'Starters', price: 280, diet: 'veg', ordered_count: 12 },
    { id: 'a2', name: 'Chicken 65', description: 'Chettinad style', category_name: 'Starters', price: 320, diet: 'non_veg', ordered_count: 40 },
    { id: 'a3', name: 'Gobi Manchurian', description: 'Cauliflower, soy', category_name: 'Starters', price: 240, diet: '', ordered_count: 3 },
  ],
  breads: [
    { id: 'b1', name: 'Butter Naan', description: '', category_name: 'Breads', price: 60, diet: 'veg', ordered_count: 55 },
  ],
};

/**
 * The search half of the bundle, on its own.
 *
 * Cut from the marker the bundle itself carries rather than by line number:
 * line numbers move every time somebody edits the file above it, and a test
 * that silently evaluates the wrong slice is worse than no test.
 */
function engine() {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  const marker = '/* ==========================================================================\n * SEARCH, FILTERS AND SORT on the ordering page.';
  const at = src.indexOf(marker);
  assert.ok(at !== -1, 'the ordering search block is gone or was renamed');

  const sandbox = {
    String, Math, Array, Object, Number, Boolean, JSON,
    products: JSON.parse(JSON.stringify(CATALOGUE)),
    localStorage: { getItem: () => 'starters', setItem() {} },
    document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ setAttribute() {} }) },
    /* jQuery reduced to what the block reaches for. The delegated handlers at
       the bottom run at load, so .on has to exist or nothing evaluates. */
    $: () => ({
      on() { return this; },
      toggle() { return this; },
      text() { return ''; },
      first() { return this; },
      val() { return ''; },
      attr() { return this; },
      trigger() { return this; },
      append() { return this; },
      html() { return this; },
    }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src.slice(at), sandbox);
  return sandbox;
}

/*
 * Spread first, deliberately.
 *
 * The lists come back from the vm sandbox, so they carry ITS Array prototype
 * and deepStrictEqual reports "same structure but not reference-equal" for two
 * things that are in every way the same. Spreading into a host literal brings
 * them home.
 */
const found = (rows) => [...rows].map((r) => r.name);

test('a search spans every category, not the open one', () => {
  /*
   * Somebody typing "biryani" is asking the restaurant a question, not the
   * Mains tab. Searching only the open category is the behaviour that made
   * the old page useless for finding anything.
   */
  const box = engine();
  box.orderView.query = 'naan';
  const list = box.orderViewList(box.allProducts());
  assert.deepStrictEqual(found(list), ['Butter Naan']);
});

test('a misspelling still finds it', () => {
  const box = engine();
  box.orderView.query = 'panner';
  assert.deepStrictEqual(found(box.orderViewList(box.allProducts())), ['Paneer Tikka']);
});

test('a word nobody resembles finds nothing', () => {
  const box = engine();
  box.orderView.query = 'lasagne';
  assert.deepStrictEqual(found(box.orderViewList(box.allProducts())), []);
});

test('veg only keeps the veg and never guesses at the unmarked', () => {
  /* Gobi Manchurian has no diet set. A shop that left the field empty has
     promised nothing, and marking it vegetarian on their behalf is the one
     mistake this filter must not make. */
  const box = engine();
  box.orderView.vegOnly = true;
  const list = found(box.orderViewList(box.allProducts()));
  assert.ok(list.includes('Paneer Tikka'));
  assert.ok(!list.includes('Chicken 65'));
  assert.ok(!list.includes('Gobi Manchurian'), 'an unmarked item was assumed vegetarian');
});

test('the filter and the search narrow together', () => {
  const box = engine();
  box.orderView.vegOnly = true;
  box.orderView.query = 'tikka';
  assert.deepStrictEqual(found(box.orderViewList(box.allProducts())), ['Paneer Tikka']);
});

test('most ordered puts the best seller first', () => {
  const box = engine();
  box.orderView.sort = 'popular';
  assert.strictEqual(found(box.orderViewList(box.allProducts()))[0], 'Butter Naan');
});

test('price sorts run both ways on the price being shown', () => {
  const box = engine();
  box.orderView.sort = 'price_asc';
  assert.strictEqual(found(box.orderViewList(box.allProducts()))[0], 'Butter Naan');

  box.orderView.sort = 'price_desc';
  assert.strictEqual(found(box.orderViewList(box.allProducts()))[0], 'Chicken 65');
});

/*
 * Somebody who just typed "chicken" is asking a question. Answering it in
 * price order buries the answer under everything cheaper.
 */
test('a live search outranks the sort box', () => {
  const box = engine();
  box.orderView.sort = 'price_asc';
  box.orderView.query = 'chicken';
  assert.deepStrictEqual(found(box.orderViewList(box.allProducts())), ['Chicken 65']);
});

test('an empty query is the whole catalogue in the shop own order', () => {
  const box = engine();
  assert.strictEqual(box.orderViewList(box.allProducts()).length, 4);
});

test('the page ships the controls the handlers are bound to', () => {
  /* The other half of the wiring: a handler bound to a selector no markup
     carries is a search box that does nothing, and that passes every static
     check here. */
  const html = fs.readFileSync(path.join(__dirname, '..', 'order', 'products.html'), 'utf8');
  for (const id of ['product-search', 'product-search-clear', 'order-filter-veg', 'order-sort']) {
    assert.ok(html.includes(`id="${id}"`), `products.html has no #${id} for its handler`);
  }

  const js = fs.readFileSync(BUNDLE, 'utf8');
  for (const id of ['#product-search', '#product-search-clear', '#order-filter-veg', '#order-sort']) {
    assert.ok(js.includes(id), `nothing is bound to ${id}`);
  }
});
