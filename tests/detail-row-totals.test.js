'use strict';

/*
 * Two incidents from the same shop, one afternoon, pinned together.
 *
 * 1. "The till is taking too long to load ... Cannot read properties of
 *    undefined (reading 'toFixed')" - the item details page rendered
 *    row.items_total.toFixed(2) on raw sale documents, and a demo-seeded
 *    sale carries sales_total only. One such sale in the table white-paged
 *    the whole page. The same template lives in five detail views.
 *
 * 2. "all toggle are on" - the first-run welcome sent its switches as
 *    'true'/'false' STRINGS, the group endpoint stored them verbatim, and
 *    every `!== false` gate read the string "false" as enabled. The client
 *    now sends booleans (the server coerces too, but an honest payload is
 *    correct even against a not-yet-updated server).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) =>
  fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', f), 'utf8');

const DETAIL_PAGES = [
  'customer_categories.js',
  'customers.js',
  'categories.js',
  'suppliers.js',
];

test('no detail page renders a raw row total - one legacy sale must not white-page the view', () => {
  for (const f of DETAIL_PAGES.concat('items.js')) {
    const src = read(f);
    assert.ok(
      !src.includes('row.items_total.toFixed') && !src.includes('row.items_return_total.toFixed'),
      f + ' still calls toFixed on a raw row total'
    );
  }
  /* and the guarded form is actually present, so this is a rewrite, not a removal */
  const items = read('items.js');
  assert.match(items, /rowSaleTotal\.toFixed\(2\)/);
  assert.match(items, /rowReturnTotal\.toFixed\(2\)/);
  assert.match(items, /Number\(row\.items_total\) \|\| 0/);
  for (const f of DETAIL_PAGES) {
    assert.match(read(f), /\(Number\(row\.items_total\) \|\| 0\)\.toFixed\(2\)/, f);
  }
});

test('the welcome saves BOOLEANS - the string "false" reads as enabled everywhere', () => {
  const src = read('settings.js');
  const saveIntro = src.slice(src.indexOf('saveIntro:'), src.indexOf('saveIntro:') + 2500);
  assert.match(
    saveIntro,
    /payload\[\$\(this\)\.data\('key'\)\] = \$\(this\)\.is\(':checked'\);/,
    'welcome toggles must be sent as booleans'
  );
  assert.ok(!saveIntro.includes("? 'true' : 'false'"), 'the string form is back');
  assert.match(saveIntro, /payload\.first_run_decided = true;/);
  /* the "Not now" write too */
  assert.match(src, /\{ first_run_done: true, first_run_decided: true \}/);
});
