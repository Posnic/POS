'use strict';

/*
 * ADDING A DISH TO A TABLE WORKS LIKE THE SALE SCREEN.
 *
 * Owner, on the first attempt at this: "browse not good. VERY BAD. implement
 * something good for add item. how normal flow selecting item and search or
 * barcode read."
 *
 * He was right. What was there was a dropdown you had to type two letters
 * into, with 13px rows, and a "Browse" button that offered the branch's
 * most-ordered dishes - useful once, useless when the dish you want is not in
 * the top twenty. A waiter at a table has the menu in their head, not a
 * search term; a counter has a scanner.
 *
 * The sale screen has done this properly for years: categories, then dishes,
 * as tiles you tap. So the panel where a table is amended now offers the same
 * three ways in, and this test pins all three, because losing any one of them
 * puts somebody back to typing:
 *
 *   Menu      categories, then that category's dishes
 *   typing    name, SKU or barcode
 *   a scan    the gun types and presses Enter, and the dish is added
 *
 * The endpoints are named here too. Each was checked against the API before
 * being used - `items/category/:id` returns whole item documents, which is why
 * a tile can be priced without a second request, and
 * `getOnlineItemsAjaxList` has a `type=barcode` mode that asks only the
 * barcode fields.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const KOT = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'kot.js'),
  'utf8'
);
const NL = String.fromCharCode(10);

test('the menu opens categories, and a category opens its dishes', () => {
  assert.match(KOT, /menuPick: function/, 'there is no way into the menu');
  assert.match(KOT, /menuCategory: function/, 'a category cannot be opened');
  assert.match(KOT, /categories\/getCategoriesWithValidItems/,
    'the categories are not read from the endpoint the sale screen uses');
  assert.match(KOT, /items\/category\//,
    "a category's dishes are not read");
});

test('a scan adds the dish and leaves the box ready for the next one', () => {
  const at = KOT.indexOf('scanBarcode: function');
  assert.ok(at > 0, 'there is no scan path');
  const body = KOT.slice(at, at + 1600);

  assert.match(body, /type=barcode/,
    'a scan searches names too, so a number inside a dish name could add the wrong thing');
  assert.match(body, /length !== 1/,
    'more than one item wearing a barcode would be added blind');
  assert.match(body, /val\(''\)\.trigger\('focus'\)/,
    'the box is not cleared and refocused, so a second scan cannot follow the first');
});

test('Enter is what tells a scan from somebody typing', () => {
  /* A scanner ends with a return; that is the only thing distinguishing it. */
  const at = KOT.indexOf("'keydown', '.kot-product-search'");
  assert.ok(at > 0, 'nothing listens for the scanner');
  const body = KOT.slice(Math.max(0, at - 400), at + 500);
  assert.match(body, /e\.key !== 'Enter'/, 'Enter is not what triggers it');
  assert.match(body, /scanBarcode/, 'Enter does not reach the scan path');
});

test('a typed name that is not a barcode still finds something', () => {
  /*
   * The failure that would be invisible: Enter on a typed name matches no
   * barcode, and if that were the end of it the box would appear dead.
   */
  const at = KOT.indexOf('scanBarcode: function');
  const body = KOT.slice(at, at + 1600);
  assert.match(body, /asSearch/, 'a non-barcode term has no fallback');
  const calls = (body.match(/asSearch/g) || []).length;
  assert.ok(calls >= 3,
    'the fallback is not used on both the no-match and the failed-request paths');
});

test('every way in prices the dish the same way', () => {
  /*
   * Three entry points, one price. The tile prices from the row its grid was
   * built from, the scan prices from the search hit, and both go through
   * _priceOf - the same function the typed search uses.
   */
  for (const fn of ['addFromMenu', 'scanBarcode']) {
    const at = KOT.indexOf(fn + ': function');
    assert.ok(at > 0, fn + ' is gone');
    const body = KOT.slice(at, at + 1600);
    assert.match(body, /_priceOf\(/, fn + ' prices a dish some other way');
    assert.match(body, /addProductToEditMode\(/, fn + ' does not add through the shared door');
  }
});

test('the Browse grid it replaced is gone, not left beside it', () => {
  /* Two pickers is worse than one bad one. */
  assert.ok(!/quickPicks|addQuickPick|kot-quick-pick/.test(KOT),
    'the old Browse picker is still in the file');
});

test('a dish name from the menu is escaped before it becomes markup', () => {
  /* Names are somebody's typing, and these tiles are built as HTML strings. */
  const at = KOT.indexOf('menuCategory: function');
  const body = KOT.slice(at, at + 2600);
  assert.match(body, /_escape\(/, 'a dish name goes into the tile unescaped');
});
