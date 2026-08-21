const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cssReader } = require('./helpers/source-lookup');

/*
 * The Add Item form lines up.
 *
 * Release-blocking, reported as: "why each field have different width. make it
 * even align properly" and "service item, variant item, add categoory add
 * supplier and etc not aligned properly".
 *
 * The root cause of the widths was a fix of mine from an earlier round. Capping
 * short fields at 420px solved a real problem — a 700px box for a brand name —
 * but it made a field's width depend on which COLUMN it sat in: a col-md-6
 * (~510px available) capped to 420, while a col-md-4 (~355px) never reached the
 * cap. Same tab, same kind of field, two widths, and the rows stopped lining
 * up.
 *
 * A cap is not a layout. The columns have to match; then the cap applies evenly
 * or not at all, and either way the fields agree.
 */

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
const css = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'),
  'utf8',
);
const itemsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
  'utf8',
);
const cssRule = cssReader(css);

/* The column class wrapping a given field id. */
const columnOf = (id) => {
  const at = html.indexOf(`id="${id}"`);
  assert.notStrictEqual(at, -1, `#${id} is not on the form`);
  const before = html.slice(0, at);
  const m = [...before.matchAll(/class="((?:form-group )?col-[\w- ]*)"/g)].pop();
  assert.ok(m, `#${id} sits in no column`);
  return m[1];
};

test('every short field on Details shares one column width', () => {
  /* This is the reported bug in one assertion. Brand and Tags were col-md-6 and
     hit the cap; the dates and position were col-md-4 and did not. */
  const fields = ['items_brand', 'items_tags', 'items_sort', 'items_mfg_date', 'items_expiry_date'];
  const spans = fields.map((f) => `${f}: ${columnOf(f)}`);
  const distinct = new Set(fields.map((f) => columnOf(f)));
  assert.strictEqual(
    distinct.size,
    1,
    `short fields must share one column span, got ${spans.join(', ')}`,
  );
  assert.ok([...distinct][0].includes('col-md-4'), 'a three-across grid keeps the rows aligned');
});

test('the description and the dropzone are the same width', () => {
  /* They sit in equal col-lg-6 columns but carried different caps - 640 and
     420 - so one filled its column and the other stopped short. Two panels of
     different widths side by side, which is what was on screen.

     Equal, NOT uncapped. My first attempt set both to 100%, and an existing
     test caught it: a text column past ~800px is hard to read back, and a
     col-lg-6 on a wide monitor is exactly that. Matching the caps gives even
     widths AND a readable line length; removing them traded one for the other. */
  const desc = cssRule('#items_new #items_description', 'THE CAP ONLY WORKS IF THE COLUMNS MATCH');
  const drop = cssRule('#items_new .Neon-theme-dragdropbox');
  const d = desc.match(/max-width:\s*(\d+)px/);
  const p = drop.match(/max-width:\s*(\d+)px/);
  assert.ok(d && p, 'both need an explicit cap to be provably equal');
  assert.strictEqual(d[1], p[1], 'they share a row, so they share a width');
  assert.ok(Number(d[1]) <= 800, 'past ~800px a text column is hard to read back');
});

test('the cap still exists, and says why uniform columns matter', () => {
  /* Removing it would bring back the 700px brand box. The point is that a cap
     and a grid have to agree, not that caps are wrong. */
  const cap = cssRule('#items_new #item_tab_details input.form-control,');
  assert.match(cap, /max-width:\s*420px/, 'the short-field cap is gone entirely');
  assert.match(css, /THE CAP ONLY WORKS IF THE COLUMNS MATCH/, 'the reasoning is not recorded');
});

test('"+ Add Category" and "+ Add Supplier" sit on their label lines', () => {
  /* Under the controls, each link's position depended on the height of the
     thing above it — and a select2 is not the same height as a plain input, so
     two links on one row sat at two different heights. */
  for (const id of ['items_category', 'items_supplier']) {
    const at = html.indexOf(`id="${id}"`);
    const before = html.slice(Math.max(0, at - 1400), at);
    assert.match(
      before,
      /d-flex align-items-baseline justify-content-between/,
      `the "+ Add" link above #${id} is not on the label line`,
    );
  }
  assert.strictEqual(
    (html.match(/class="items-inline-add"/g) || []).length,
    2,
    'both add links must use the same treatment',
  );
  const add = cssRule('.items-inline-add');
  assert.match(add, /white-space:\s*nowrap/, 'the link wraps and drags the label with it');
});

test('the item KIND is decided above the fields it governs', () => {
  /* Service and variants both hide parts of the form below them. Asking them
     from inside that form meant a control could hide the row it was standing in
     - the owner asked for them "in top may be in title, so that we can hide
     properly". They are in the card header now, together, because they answer
     the same question. */
  const at = html.indexOf('items-kind-header');
  assert.notStrictEqual(at, -1, 'the kind header is gone');
  const header = html.slice(at, html.indexOf('card-body', at));
  for (const id of ['item_is_service', 'item_service_unit', 'variant_mode_link']) {
    assert.ok(header.includes(id), `#${id} is not in the card header any more`);
  }
  /* The radios that every mode check in items.js reads must come with them. */
  assert.ok(header.includes('product_without_variant'), 'the mode radios were left behind');
  assert.ok(header.includes('product_with_variant'), 'the mode radios were left behind');

  const row = cssRule('.items-kind-header');
  assert.match(row, /display:\s*flex/, 'the header does not lay the title and controls out');
  assert.match(row, /justify-content:\s*space-between/, 'the controls do not sit opposite the title');
});

test('the service checkbox appears exactly once', () => {
  /* It was moved, not copied. Two checkboxes with one id means the one the
     browser finds and the one items.js reads can differ. */
  assert.strictEqual((html.match(/id="item_is_service"/g) || []).length, 1);
  assert.strictEqual((html.match(/id="item_service_unit"/g) || []).length, 1);
});

test('Import is out of the form entirely', () => {
  /* It is not a field - it is the alternative to filling the form at all, so it
     belongs in the page header, not buried under the fields it lets you skip. */
  const at = html.indexOf('importTableFile');
  assert.notStrictEqual(at, -1, 'the import entry point is gone');
  assert.ok(
    html.slice(0, at).includes('id="item_header_actions"'),
    'import is still inside the form body',
  );
  assert.ok(
    at < html.indexOf('id="item_form_tabs"'),
    'import must sit above the tabs, in the page header',
  );
  assert.strictEqual((html.match(/importTableFile/g) || []).length, 1, 'it was copied, not moved');
});

test('Import opens where you are, and does not navigate away', () => {
  /* It carried href="#/items" and fired the dialog on a 300ms timer, so asking
     to import FROM the Add Item page went to the item list first - discarding
     anything already typed - and the delay existed only to wait for that page.
     #import_modal is global and the results render into its own table, so the
     trip was never needed. */
  const at = html.indexOf('id="item_import_btn"');
  assert.notStrictEqual(at, -1, 'the import control is gone');
  const el = html.slice(html.lastIndexOf('<', at), html.indexOf('>', html.indexOf('onclick', at)) + 1);
  assert.ok(!/href=/.test(el), 'it still navigates - typed values are lost on the way');
  assert.ok(!/setTimeout/.test(el), 'the timer only existed to wait for a page change');
  assert.match(el, /onclick="PosnicPro\.importTableFile\('items'\);"/, 'it must open the dialog directly');
  assert.match(el, /^<button/, 'a link that goes nowhere should not be an anchor');
});

test('showing the service unit does not fight its own row', () => {
  /* applyServiceMode replaces the whole style attribute. It used to write
     width:auto, which overrode the row's sizing and put the select back where
     it started. */
  const at = itemsJs.indexOf("$('#item_service_unit').attr('style'");
  assert.notStrictEqual(at, -1, 'the toggle is gone');
  const line = itemsJs.slice(at, itemsJs.indexOf('\n', at));
  assert.ok(!/width:auto/.test(line), 'the toggle writes sizing that the CSS row owns');
  assert.match(line, /display:none !important/, 'the markup hides it with !important - this must beat it');
});

/*
 * Getting through a tabbed form (owner: "next button to move next tab... if one
 * tab full completed green tick or something").
 */
test('every tab has a way forward', () => {
  const navs = [...html.matchAll(/data-nav-for="(\w+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(
    navs,
    ['item_tab_main', 'item_tab_details', 'item_tab_more'],
    'each pane needs its own step row, in order',
  );
  assert.match(html, /class="btn btn-sm btn-primary item-tab-next" data-goto="item_tab_details"/);
  assert.match(html, /class="btn btn-sm btn-primary item-tab-next" data-goto="item_tab_more"/);
  /* The last tab has no Next and the first has no Back - a button that goes
     nowhere is worse than no button. */
  assert.ok(!/item-tab-next" data-goto="item_tab_main"/.test(html), 'Next must not loop back to the start');
  assert.ok(!/item-tab-back" data-goto="item_tab_more"/.test(html), 'Back must not point forwards');
});

test('the tick means "there is something here", not "this is correct"', () => {
  /* Only the Item tab has required fields. Ticking the optional tabs for
     correctness would be a claim the form cannot make, and a badge that lies is
     one people stop reading. */
  const req = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.TAB_REQUIRED = {'));
  const block = req.slice(0, req.indexOf('};') + 2);
  assert.match(block, /item_tab_main:/, 'the Item tab must state its required fields');
  assert.ok(!/item_tab_details:/.test(block), 'Details is optional - it cannot have required fields');
  assert.ok(!/item_tab_more:/.test(block), 'More is optional too');
});

test('an open-price item can still complete the Item tab', () => {
  /* Its selling price is deliberately empty - the cashier types it at the till.
     Requiring one would leave that tab permanently unticked for a legitimate
     item, which is exactly the badge-that-lies problem in reverse. */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.refreshTabTicks'));
  const body = fn.slice(0, fn.indexOf('\n    };'));
  assert.match(body, /item_open_price/, 'open price is not considered');
  assert.match(body, /openPrice.*return true|if \(sel === '#items_selling_price' && openPrice\)/s);
});

test('the ticks are not driven by a list of field ids', () => {
  /* A hardcoded list goes stale the first time a field is added to a tab. */
  const fn = itemsJs.slice(itemsJs.indexOf('$(document).on(\'input change\', \'#item_image_upload_form'));
  const line = fn.slice(0, fn.indexOf('\n'));
  assert.match(line, /input, #item_image_upload_form select, #item_image_upload_form textarea/);
});

test('an empty form shows no ticks at all', () => {
  /* A row of grey ticks is indistinguishable from earned ones at a glance. */
  const tick = cssRule('#item_form_tabs .item-tab-tick');
  assert.match(tick, /display:\s*none/, 'the tick must be hidden until earned');
  const done = cssRule('#item_form_tabs .nav-link.is-complete .item-tab-tick');
  assert.match(done, /display:\s*inline-block/, 'an earned tick never appears');
});

/*
 * Colour and shape describe the sale-grid tile WHEN THERE IS NO IMAGE - the
 * label always said so, and the controls stayed on screen anyway.
 */
test('the tile controls sit beside the image', () => {
  const fallback = html.indexOf('id="item_tile_fallback"');
  const preview = html.indexOf('id="item-display-preview"');
  const dates = html.indexOf('id="items_mfg_date"');
  assert.notStrictEqual(fallback, -1, 'the tile block is gone');
  assert.ok(fallback > preview, 'it must follow the image preview, in the same column');
  assert.ok(fallback < dates, 'it must not have been left down with the date row');
});

test('an uploaded image hides them', () => {
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.refreshTileFallback'));
  const body = fn.slice(0, fn.indexOf('\n    };'));
  assert.match(body, /item-display-preview'\)\.find\('img'\)\.length/, 'the preview strip is not consulted');
  assert.match(body, /cover !== 'item\.svg'/, 'the default placeholder counts as no image');
  assert.match(body, /toggle\(!hasImage\)/, 'the block does not follow the image state');
});

test('the image state is watched, not hooked per upload path', () => {
  /* An image arrives three ways - fresh upload, edit load, clone - and hooking
     each is how the third gets missed. */
  assert.match(itemsJs, /new MutationObserver\(function \(\) \{[\s\S]{0,120}refreshTileFallback/);
  assert.match(itemsJs, /typeof MutationObserver === 'undefined'/, 'no fallback if the API is absent');
});

/*
 * Variant mode (owner: "item with varient behaved weird. its hiding so many
 * stuff but those required. please check.")
 *
 * What it hid: cost, MRP, reorder point, units, quick code, SKU, barcode.
 * What it KEPT: selling price and opening stock - and selling price is
 * required. But every variant row carries its own, and saveVariantFamily reads
 * items_selling_price_<n> / items_available_quantity_<n> and never looks at the
 * parent's. So the form demanded two numbers it then discarded, on the one
 * screen where it also hid the fields you did need.
 */
test('variant mode hides the parent price and stock, which the variants own', () => {
  const fn = itemsJs.slice(itemsJs.indexOf('var plain = $("#product_without_variant").is(":checked");'));
  const body = fn.slice(0, fn.indexOf('\n    });'));
  assert.match(
    body,
    /\$\('#items_selling_price'\)\.closest\('\.form-group'\)\.toggle\(plain\)/,
    'the parent selling price still shows in variant mode',
  );
  assert.match(body, /#item_opening_wrap'\)\.toggle\(plain/, 'the parent opening stock still shows');
});

test('a service item does not get an opening-stock box back', () => {
  /* Two rules meet on that field: variants own stock, and a service has none.
     Restoring it for "plain" alone would undo applyServiceMode. */
  const fn = itemsJs.slice(itemsJs.indexOf('var plain = $("#product_without_variant").is(":checked");'));
  const body = fn.slice(0, fn.indexOf('\n    });'));
  assert.match(
    body,
    /toggle\(plain && !\$\('#item_is_service'\)\.is\(':checked'\)\)/,
    'switching off variants would show stock for a service',
  );
});

test('variant mode does not demand a price it throws away', () => {
  /* The field is hidden AND required - the form could refuse to save with no
     visible field to fix. */
  const fn = itemsJs.slice(itemsJs.indexOf('addMethod("sellingPriceOrOpen"'));
  const body = fn.slice(0, fn.indexOf('}, "Enter a selling price'));
  assert.match(body, /#product_with_variant'\)\.is\(':checked'\)/, 'variant mode is not exempted');
  assert.ok(
    body.indexOf('product_with_variant') < body.indexOf('parseFloat'),
    'the exemption must come before the numeric check, or it never runs',
  );
});
