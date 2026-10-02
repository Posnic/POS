'use strict';

/* Menu tiles remain available; typed names, codes and barcode input now use
 * the same result renderer and keyboard picker as the main sale page.
 * Enter selects a product, then confirms its quantity before adding it. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const KOT = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'kot.js'),
  'utf8'
);

test('the menu opens categories, and a category opens its dishes', () => {
  assert.match(KOT, /menuPick: function/, 'there is no way into the menu');
  assert.match(KOT, /menuCategory: function/, 'a category cannot be opened');
  assert.match(KOT, /categories\/getCategoriesWithValidItems/,
    'the categories are not read from the endpoint the sale screen uses');
  assert.match(KOT, /items\/category\//,
    "a category's dishes are not read");
});

test('typed and scanned searches share the main sale picker and quantity flow', () => {
  assert.match(KOT, /PosnicBillingSearch.search\(query, catalogue, 20\)/);
  assert.match(KOT, /PosnicPro.sugRow\(suggestion.data/);
  assert.match(KOT, /deferRequestBy: 0, autoSelectFirst: true/);
  assert.match(KOT, /PosnicPro.kot.searchQuantity\(/);
});

test('menu tiles preserve the shared edit pricing path', () => {
  /*
   * The menu tile uses _priceOf and the shared edit-row insertion path,
   * just as the keyboard picker does.
   */
  for (const fn of ['addFromMenu']) {
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
