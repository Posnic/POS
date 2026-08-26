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

test('no activity view renders a raw sale_process - a legacy or demo sale must not badge "undefined"', () => {
  /* Same incident family, third member: the Process column printed
     row.sale_process raw, and a sale without the field (demo-seeded or
     legacy) showed a red "undefined" badge. The seeder stamps 'Add' now,
     and every reader defaults - installed data has no field to gain. */
  for (const f of ['customers.js', 'categories.js', 'customer_categories.js', 'items.js']) {
    const src = read(f);
    assert.ok(!src.includes("+ row.sale_process + '</span>"),
      f + ' still renders sale_process unguarded');
    assert.match(src, /\(row\.sale_process \|\| 'Add'\)/, f);
    assert.match(src, /!row\.sale_process \|\| row\.sale_process == 'Add'/,
      f + ' badges a missing process as an error');
    assert.match(src, /let process = val\.sale_process \|\| 'Add';/, f + ' (export path)');
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

test('the money-path lists are card-ready on phones (Mobile P2)', () => {
  /* MOBILE_EXPERIENCE_PLAN P2: each list opts into the table-to-cards
     mechanism (m-cards on the table, data-label on the cells). The
     mechanism is inert on desktop and inert without the labels, so this
     pin is what keeps a rewritten row template from quietly shipping a
     label-less phone view. */
  const fsx = require('fs');
  const px = require('path');
  const mod = (f) => fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'modules', f), 'utf8');
  const js = (f) => fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', f), 'utf8');
  for (const f of ['items.html', 'receivings.html', 'sales_read.html', 'customers.html', 'suppliers.html',
    /* P3 slice 2 */ 'users.html', 'kothistory.html', 'stockactivity.html', 'variants.html', 'settings_write.html']) {
    assert.match(mod(f), /table-borderless m-cards/, f + ' lost its m-cards opt-in');
  }
  for (const [f, label] of [
    ['items.js', 'data-label="Price"'],
    ['receiving_add.js', 'data-label="Supplier"'],
    ['sales.js', 'data-label="Total"'],
    ['customers.js', 'data-label="Address"'],
    ['suppliers.js', 'data-label="Address"'],
    /* P3 slice 2 */
    ['users.js', 'data-label="Role"'],
    ['kothistory.js', 'data-label="Order type"'],
    ['stocklog.js', 'data-label="Closing"'],
    ['variants.js', 'data-label="Name"'],
    ['expenses.js', 'data-label="Approved by"'],
    /* P3 slice 3: the detail-view sales histories (the sale_process family) */
    ['customers.js', 'data-label="Return total"'],
    ['categories.js', 'data-label="Return total"'],
    ['customer_categories.js', 'data-label="Return total"'],
    ['items.js', 'data-label="Return total"'],
  ]) {
    assert.ok(js(f).includes(label), f + ' rows lost their ' + label);
  }
  /* the detail tables themselves opt in - two live in modals/ */
  const anyf = (rel) => fsx.readFileSync(px.join(__dirname, '..', 'frontend', rel), 'utf8');
  for (const [rel, id] of [
    ['modals/customer.html', 'view_customerdetails'],
    ['modals/items_read.html', 'view_itemdetails'],
    ['modules/categories.html', 'view_categorydetails'],
    ['modules/customer_categories.html', 'view_customercategorydetails'],
  ]) {
    assert.match(anyf(rel), new RegExp('id="' + id + '" class="table table-borderless m-cards"'), rel);
  }
  /* and the mechanism itself is present and token-coloured */
  const css = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8');
  assert.match(css, /table\.m-cards td\[data-label\]::before/);
});

test('report tables keep their first column under a scrolling thumb (Mobile P3)', () => {
  /* Dense numeric reports stay tables on phones - cards would bury the
     numbers - but they scroll sideways, and without a pinned first column
     the row names scroll away with them. Every report page opts in. */
  const fsx = require('fs');
  const px = require('path');
  const css = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8');
  assert.match(css, /table\.m-sticky-first th:first-child/);
  assert.match(css, /position: sticky/);
  const dir = px.join(__dirname, '..', 'frontend', 'modules');
  const reportPages = fsx.readdirSync(dir).filter((f) => /report\.html$/i.test(f));
  assert.ok(reportPages.length >= 15, 'the report-page scan found almost nothing');
  for (const f of reportPages) {
    const s = fsx.readFileSync(px.join(dir, f), 'utf8');
    if (!s.includes('table-borderless')) continue;
    assert.ok(s.includes('m-sticky-first'), f + ' lost its sticky first column');
  }
});

test('money and quantity fields ask the phone for the number pad (Mobile P2 tail)', () => {
  /* inputmode="decimal" pops the numeric keyboard; without it a cashier
     types every quantity through the full QWERTY. The qty inputs live in
     JS row templates, the price fields in the items form. */
  const fsx = require('fs');
  const px = require('path');
  const sales = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'), 'utf8');
  const qty = sales.match(/inputmode="decimal" name="addSalesLineItemQty"/g) || [];
  assert.ok(qty.length >= 4, 'the sale-screen qty inputs lost their number pad (' + qty.length + ')');
  const recv = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'receiving_add.js'), 'utf8');
  assert.match(recv, /rec_sale_inp_val" inputmode="decimal"/);
  const items = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'modules', 'items_write.html'), 'utf8');
  for (const fid of ['items_selling_price', 'items_company_price', 'items_mrp_price', 'items_available_quantity']) {
    const tag = items.match(new RegExp('<input[^>]*id="' + fid + '"[^>]*>'));
    assert.ok(tag && tag[0].includes('inputmode="decimal"'), fid + ' lost its number pad');
  }
});

test('phone inputs build on demand, never at boot (DOM diet)', () => {
  /* intl-tel-input renders ~1,222 nodes of country list per instance. Three
     were live on the dashboard - 14% of the whole document - inside the
     first second, which is the window iPhones were dying in. The call sites
     are untouched because the instance is a getter; what changed is WHEN it
     is built. */
  const fsx = require('fs');
  const px = require('path');
  const core = fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
  assert.match(core, /PosnicPro\.lazyPhoneInput = function/);
  assert.match(core, /Object\.defineProperty\(target, prop, \{ configurable: true, get: build \}\)/);
  assert.match(core, /\$\(document\)\.on\('focusin', selector, build\)/);
  assert.match(core, /if \(!window\.__mobileSafeMode\) \{/);
  const js = (f) => fsx.readFileSync(px.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', f), 'utf8');
  for (const f of ['branches.js', 'customers.js', 'suppliers.js', 'settings.js', 'sales.js']) {
    assert.ok(!js(f).includes('= window.intlTelInput(document.querySelector'),
      f + ' builds a phone widget at boot again');
    assert.match(js(f), /PosnicPro\.lazyPhoneInput\('#/, f);
  }
});
