const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cssReader, stripComments } = require('./helpers/source-lookup');

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

test('no field is labelled "optional"', () => {
  /* Required fields carry a red asterisk, so marking everything else optional
     labels the rule instead of the exception - noise on eleven fields to say
     what the absence of an asterisk already says (owner ask). */
  const markup = stripComments(html);
  assert.ok(!/lang_optional/.test(markup), 'an "(optional)" label suffix is back');
  assert.ok(
    !/placeholder="[^"]*optional[^"]*"/i.test(markup),
    'a placeholder still says optional',
  );
  assert.ok(
    !/Choose a Supplier \(optional\)/.test(itemsJs),
    'the picker placeholder still says optional',
  );
});

test('the asterisk that replaces it is still there', () => {
  /* Removing "(optional)" only works while the required fields are marked. */
  const markup = stripComments(html);
  for (const id of ['items_name', 'items_selling_price']) {
    const at = markup.indexOf(`for="${id}"`);
    assert.notStrictEqual(at, -1, `the label for #${id} is gone`);
    const label = markup.slice(at, markup.indexOf('</label>', at));
    assert.match(label, /text-danger/, `#${id} is required but carries no asterisk`);
  }
});

test('the "+ Add" links are gone from the form', () => {
  /* Removed on request. They were also the thing pushing "(optional)" down. */
  assert.ok(!/lang_add_category/.test(html), '"+ Add Category" is back');
  assert.ok(!/lang_add_supply/.test(html), '"+ Add Supplier" is back');
  assert.ok(!/items-inline-add/.test(html), 'the link treatment is still applied to something');
  assert.ok(!/items-inline-add/.test(css), 'dead CSS left behind for a link that no longer exists');
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

test('a tick means the tab is FINISHED, not merely touched', () => {
  /* It used to tick after one field, which told nobody anything. Every visible
     field in the tab has to be answered (owner ask). */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.tabIsComplete'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /if \(\$\.trim\(\$f\.val\(\) \|\| ''\) === ''\) \{ complete = false; \}/,
    'an empty field no longer blocks the tick');
  assert.ok(!/done = true/.test(body), 'the old "any field wins" rule is back');
  assert.ok(!/TAB_REQUIRED/.test(itemsJs), 'the per-tab required list should be gone');
});

test('checkboxes and radios cannot block a tick', () => {
  /* Unchecked IS an answer. Requiring them would mean ticking every toggle on
     the form to earn a tick - the opposite of what it should encourage. */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.tabIsComplete'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /type === 'checkbox' \|\| type === 'radio' \|\| type === 'hidden'/);
  assert.match(body, /is\(':disabled'\) \|\| \$f\.prop\('readonly'\)/, 'disabled fields would block it');
});

test('a field the mode has hidden cannot block a tick', () => {
  /* Service mode hides stock, variant mode hides price and SKU. A tab cannot be
     incomplete because of a box nobody can reach. */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.tabIsComplete'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /is\(':visible'\)/, 'hidden fields are still counted');
  /* select2 hides its own <select>, so :visible on it is always false - the
     rendered container is what the user can see. */
  assert.match(body, /select2-hidden-accessible/, 'every select2 field would read as hidden');
  assert.match(body, /next\('\.select2-container'\)/, 'nothing looks at the rendered control');
});

test('an empty tab is not a complete one', () => {
  /* Otherwise a pane with nothing in it ticks for having been opened. */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.tabIsComplete'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /return seen > 0 && complete;/, 'a tab with no fields would tick');
});

test('an open-price item can still complete the Item tab', () => {
  /* Its selling price is deliberately empty - the cashier types it at the till.
     Requiring one would leave that tab permanently unticked for a legitimate
     item. */
  const fn = itemsJs.slice(itemsJs.indexOf('PosnicPro.items.tabIsComplete'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /#items_selling_price'\) && openPrice/, 'open price is not exempted');
  assert.match(body, /seen \+= 1; return;/, 'the exemption must still COUNT the field, or an all-open tab looks empty');
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

/*
 * Supplier is a picker like Category (owner ask), and never opens empty.
 */
test('supplier is a select2, not a bare autocomplete', () => {
  assert.match(html, /<select id="items_supplier_pick"[^>]*class="select2/, 'the picker is gone');
  assert.ok(
    !/<input type="text"[^>]*id="items_supplier"/.test(html),
    'the old free-text supplier box is back',
  );
});

test('the fields every payload builder reads are untouched', () => {
  /* items.js reads #items_supplier and #items_supplier_id in six places. The
     picker drives them; it does not replace them. */
  assert.match(html, /<input type="hidden" id="items_supplier" name="items_supplier">/);
  assert.match(html, /<input type="hidden" name="items_supplier_id" id="items_supplier_id">/);
  assert.match(
    itemsJs,
    /on\('change', '#items_supplier_pick'[\s\S]{0,300}items_supplier_id'\)\.val/,
    'nothing keeps the hidden fields in step with the picker',
  );
});

test('the picker is loaded from the database, not left empty', () => {
  /* "If there is no recent item fire db query get latest or most used. i dont
     want empty list." An empty query IS that read - it returns the branch's
     suppliers rather than nothing. */
  const fn = itemsJs.slice(itemsJs.indexOf('loadSelectSupplier: function'));
  const body = fn.slice(0, fn.indexOf('\n    },'));
  assert.match(body, /suppliers\/getSuppliersAjaxList/, 'it never asks the server');
  assert.match(body, /query=&branch=/, 'an empty query is what returns the list');
  assert.match(body, /No suppliers yet/, 'a genuinely empty shop gets no explanation');
});

test('editing an item cannot silently clear its supplier', () => {
  /* An inactive or deleted supplier is not in the list, so selecting by id
     would fall back to blank and the next save would drop it. */
  const fn = itemsJs.slice(itemsJs.indexOf('loadSelectSupplier: function'));
  const body = fn.slice(0, fn.indexOf('\n    },'));
  assert.match(body, /if \(selectedId && !\$pick\.find\('option\[value="' \+ selectedId/, 'a missing id is not restored');
  assert.match(itemsJs, /loadSelectSupplier\(data\.supplier_id, data\.supplier_name\)/, 'the edit path does not pass it');
});

test('the autocomplete bound to the now-hidden input is gone', () => {
  /* A plugin initialised against an invisible field can never fire, and reads
     as working code for years. */
  assert.ok(
    !/\$\('#items_supplier'\)\.autocomplete\(/.test(itemsJs),
    'an autocomplete is still bound to the hidden supplier input',
  );
});

test('the variant builder uses the column the hidden cards vacate', () => {
  /* Outside it, the right half of the screen went blank in variant mode and two
     inputs stretched across the page. The generated variant ROWS stay full
     width - that is a table and it wants the room. */
  const rightCol = html.indexOf('class="col-lg-6 d-flex flex-column"', 5000);
  let depth = 1;
  let j = html.indexOf('>', rightCol) + 1;
  while (depth > 0) {
    const o = html.indexOf('<div', j);
    const c = html.indexOf('</div>', j);
    if (o !== -1 && o < c) { depth += 1; j = o + 4; } else { depth -= 1; j = c + 6; }
  }
  assert.ok(html.indexOf('id="show_variant_fields"') < j, 'the builder is outside the right column');
  assert.ok(html.indexOf('id="load_price_fields"') > j, 'the variant rows should stay full width');
});

test('the Item card is sized to its content', () => {
  /* flex-grow-1 stretched it to match the taller column, leaving empty white
     under the category and supplier pickers. */
  const at = html.indexOf('<h5 class="card-title mb-0"><lang class="lang_item_title">Item</lang>');
  const card = html.slice(Math.max(0, at - 1200), at);
  assert.ok(!/card m-b-30 flex-grow-1/.test(card), 'the Item card still stretches to fill');
});

/*
 * Saving must not throw when a feature is off or an optional field is empty.
 *
 * Reported from the live till with the tax module DISABLED:
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'element')
 *       p = f[0].element.attributes["data-tax-value"].value
 *
 * The save read the tax select2's selection as data[0].element.attributes[...],
 * which throws the moment there IS no selection - and with tax off there never
 * is one. The same line existed at BOTH save sites, and the category read a
 * line below had the same shape: category_id was guarded, category_name was
 * not. Category is optional, so saving without one threw as well.
 */
test('no save path reads a select2 selection unguarded', () => {
  const code = stripComments(itemsJs);
  const bad = [...code.matchAll(/attributes\['data-(tax|category)-[a-z]+'\]/g)];
  assert.deepStrictEqual(
    bad.map((m) => m[0]),
    [],
    'a direct attribute read is back - it throws whenever there is no selection',
  );
  assert.ok(
    !/select2\("data"\)\[0\]\.element/.test(code),
    'indexing [0].element assumes a selection that an off feature never makes',
  );
});

test('the safe reader returns a value, not an exception', () => {
  const fn = itemsJs.slice(itemsJs.indexOf('selectAttr: function'));
  const body = fn.slice(0, fn.indexOf('\n    },'));
  assert.match(body, /try \{/, 'select2("data") on an uninitialised select throws too');
  assert.match(body, /data && data\.length \? data\[0\]\.element : null/, 'an empty selection is not handled');
  assert.match(body, /fallback === undefined \? '' : fallback/, 'callers cannot supply a default');
});

test('tax falls back to 0, not to empty string', () => {
  /* tax_value reaches the server as a number. An empty string is not "no tax";
     it is a value the server has to guess about. */
  const code = stripComments(itemsJs);
  const hits = [...code.matchAll(/selectAttr\('#items_tax', 'data-tax-value', 0\)/g)];
  assert.strictEqual(hits.length, 2, 'both save paths must default tax to 0');
});

test('both save paths are fixed, not just the one that was reported', () => {
  const code = stripComments(itemsJs);
  assert.strictEqual(
    (code.match(/selectAttr\('#items_category', 'data-category-name'\)/g) || []).length,
    2,
    'the second save path still reads category unguarded',
  );
});

/*
 * Reorder point and Item Units belong with the item, not with its prices.
 * Neither is a price: one is when to buy more, the other is how the item is
 * counted.
 */
test('reorder point and units sit in the Item card, above the pickers', () => {
  const priceCard = html.indexOf('lang_price_stock_title');
  const category = html.indexOf('for="items_category"');
  for (const id of ['items_reorder_point', 'items_unit']) {
    const at = html.indexOf(`id="${id}"`);
    assert.notStrictEqual(at, -1, `#${id} is gone`);
    assert.ok(at < priceCard, `#${id} is still inside Price & Stock`);
    assert.ok(at < category, `#${id} must sit above the category row`);
  }
});

test('they share one row, like the pickers below them', () => {
  const at = html.indexOf('id="items_reorder_point"');
  const unit = html.indexOf('id="items_unit"');
  assert.ok(unit > at, 'units should follow the reorder point');
  /* Only the span BETWEEN the two - running to the category label crosses into
     that row and counts its form-row instead. */
  const between = html.slice(at, unit);
  assert.ok(
    !between.includes('<div class="form-row">'),
    'a second form-row opened between them - they are on separate lines',
  );
});

test('a service item still loses its reorder point', () => {
  /* applyServiceMode hides it via closest('[class*="col-"]'), which only works
     while it is wrapped in a column. Moving it must not have stripped that. */
  const at = html.indexOf('id="items_reorder_point"');
  const wrapper = html.slice(html.lastIndexOf('<div class="col-', at), at);
  assert.match(wrapper, /class="col-/, 'the column wrapper applyServiceMode relies on is gone');
  assert.match(itemsJs, /#items_available_quantity, #items_reorder_point'\)\.closest\('\[class\*="col-"\]'\)/);
});

/*
 * The option loaders.
 *
 * Five of them shared three defects. `var option;` starts undefined, so
 * `option += '<option...'` put the literal string "undefined" in front of every
 * entry. select2() ran INSIDE the loop, re-initialising the widget once per
 * option - which is what threw "Cannot read properties of null (reading
 * 'offsetWidth')", because select2 measures a container the previous init has
 * already replaced. And one fired change.select2 at a select before it was a
 * select2 at all.
 */
test('no loader builds its options from an undefined string', () => {
  const code = stripComments(itemsJs);
  assert.ok(!/var option;/.test(code), 'the "undefined" prefix bug is back');
  assert.ok(!/let unitOption;/.test(code), 'the same bug in the variant-row unit loader');
  assert.ok(
    !/option \+= '<option/.test(code),
    'options are being concatenated onto an uninitialised variable again',
  );
});

test('select2 is initialised once, not once per option', () => {
  /* Checked by SHAPE, not by variable name: the first version of this assertion
     matched the literal `append(option)` and a mutation that renamed the
     variable walked straight past it. What matters is that no append inside a
     per-row callback is chained to select2 or trigger. */
  const code = stripComments(itemsJs);
  for (const name of ['loadSelectCategory', 'loadSelectVariant', 'loadSelectTax', 'loadSelectUnit']) {
    const at = code.indexOf(name + ': function');
    assert.notStrictEqual(at, -1, `${name} is gone`);
    const body = code.slice(at, code.indexOf('\n    },', at));
    assert.ok(
      !/\$\.each\([\s\S]*?\.append\([^)]*\)\.(select2|trigger)\(/.test(body),
      `${name} appends and re-initialises per row - this is the offsetWidth crash`,
    );
    assert.ok(
      !/\.append\([^)]*\)\.select2\(\)/.test(body),
      `${name} chains select2 onto an append`,
    );
    assert.strictEqual(
      (body.match(/\.select2\(/g) || []).length <= 1,
      true,
      `${name} initialises select2 more than once`,
    );
  }
});

test('a select becomes a select2 before anything triggers change.select2', () => {
  /* Firing it first hands select2 a widget that does not exist yet. */
  const code = stripComments(itemsJs);
  for (const m of code.matchAll(/\$\("?\.items_category"?\)\.val\(''\)\.trigger\('change\.select2'\)/g)) {
    const before = code.slice(Math.max(0, m.index - 320), m.index);
    assert.match(
      before,
      /items_category"?\)\.select2\(\{/,
      'change.select2 fires before the select is initialised',
    );
  }
});

test('the description fills its column so the two halves end together', () => {
  const rule = cssRule('#items_new .items-description-fill');
  assert.match(rule, /flex:\s*1 1 auto/, 'it no longer stretches - the left half strands again');
  assert.match(rule, /min-height/, 'with no floor it collapses when the other column is short');
  /* Two rules share this prefix - the row and its columns - so anchor it. */
  const row = cssRule('.items-details-row', 'Details, top row');
  assert.match(row, /align-items:\s*stretch/, 'the columns do not stretch to match');
});

test('the save bar is inside the tab box and matches its width', () => {
  /* Outside it the bar took the full column width while the panes are inset by
     their own padding and a scrollbar, so it ran past the Next button. */
  const bar = html.indexOf('id="item_save_bar"');
  const tc = html.indexOf('id="item_form_tabs_content"');
  assert.ok(bar > tc, 'the save bar is not inside the tab-content box');
  const rule = cssRule('.item-save-bar');
  assert.match(rule, /position:\s*sticky/, 'it must stay in reach on a long form');
  assert.match(rule, /margin-right/, 'without the pane inset it overhangs on the right');
  const pane = cssRule('#item_form_tabs_content > .tab-pane', 'The save bar matches the form above it.');
  assert.match(pane, /scrollbar-gutter:\s*stable/, 'the inset shifts when a pane starts scrolling');
});

/*
 * The More tab gets the same discipline as Details.
 */
test('More uses grid columns, not arbitrary spans', () => {
  const at = html.indexOf('id="item_tab_more"');
  const seg = html.slice(at, html.indexOf('id="item_save_bar"'));
  const spans = [...seg.matchAll(/class="(col-[\w- ]*)"/g)].map((m) => m[1].trim());
  for (const bad of ['col-7', 'col-5', 'col-md-9', 'col-md-3']) {
    assert.ok(!spans.includes(bad), `${bad} is an arbitrary span - use the grid`);
  }
});

test('the two pack fields are an even pair', () => {
  const a = html.indexOf('id="items_purchase_unit"');
  const b = html.indexOf('id="items_conversion_factor"');
  const colOf = (at) => {
    const m = [...html.slice(0, at).matchAll(/class="(col-[\w- ]*)"/g)].pop();
    return m[1].trim();
  };
  assert.strictEqual(colOf(a), colOf(b), 'two fields of the same kind, two different widths');
});

test('nothing overrides the grid gutter with inline padding', () => {
  /* padding:0 !important on the discount value made it sit flush against the
     radios beside it. */
  const at = html.indexOf('id="item_tab_more"');
  const seg = html.slice(at, html.indexOf('id="item_save_bar"'));
  assert.ok(!/style="padding: 0 !important;"/.test(seg), 'an inline padding override is back');
});

test('no per-field width caps remain on More', () => {
  /* They made two fields in one row different widths - the same complaint as
     Details. The shared cap applies evenly now that the columns match. */
  assert.ok(!/#items_new #items_conversion_factor\s*\{[^}]*max-width/.test(css));
  assert.ok(!/#items_new #items_discount_percentage\s*\{[^}]*max-width/.test(css));
});

/*
 * One width for the whole form.
 *
 * The 1140px cap used to sit on the More tab alone, so that pane stopped there
 * while the others - and the save bar below them - ran to the full column
 * width. That is why the bar overhung the Next button and the cards.
 */
test('the tab box caps every pane and the save bar together', () => {
  const box = cssRule('#items_new #item_form_tabs_content');
  assert.match(box, /max-width:\s*1140px/, 'the shared cap is gone - panes can drift apart again');
  assert.match(box, /margin-left:\s*0/, 'the form must stay left-aligned, not centred');
  assert.ok(
    !/#items_new #item_tab_more\s*\{[^}]*max-width/.test(css),
    'the cap is back on one pane only - that is the bug',
  );
});

test('the save bar carries the pane inset, not the box edge', () => {
  /* Its edges have to land where the cards inside a pane land, and those are
     inset by the pane's own padding. */
  const rule = cssRule('.item-save-bar');
  assert.match(rule, /margin-left:\s*2px/);
  assert.match(rule, /margin-right:\s*6px/);
  /* Two rules share this selector - the original one carries the padding, the
     one I added carries scrollbar-gutter - so assert against the file. */
  assert.match(
    css,
    /#item_form_tabs_content > \.tab-pane \{[^}]*padding:\s*2px 6px 2px 2px/,
    'the bar mirrors this inset - they must agree',
  );
});

test('the pickers are set apart from the numbers above them', () => {
  /* form-row children get no bottom margin from the card rule, which only
     covers .row - so the two groups ran together. */
  const at = html.indexOf('class="form-row items-picker-row"');
  assert.notStrictEqual(at, -1, 'the picker row lost its class');
  assert.ok(at < html.indexOf('for="items_category"'), 'the class is on the wrong row');
  const rule = cssRule('.items-picker-row');
  assert.match(rule, /margin-top/, 'no gap above the pickers');
});

test('Quick code is the same width as SKU and Barcode', () => {
  const q = columnOf('items_plu_code');
  const sku = columnOf('items_itemid');
  const bar = columnOf('items_barcodeid');
  assert.strictEqual(q, sku, 'the shortest field in the card is the odd one out again');
  assert.strictEqual(sku, bar, 'SKU and Barcode must match each other too');
});

test('the discount value is not flush against the card edge', () => {
  /* It is right-aligned text in the last column of its row, so it reads as
     clipped without a little air before the border. */
  const rule = cssRule('#items_new .floating-label > #items_discount_amount,');
  assert.match(rule, /margin-right:\s*10px/, 'no gap before the border');
  assert.match(rule, /width:\s*calc\(100% - 10px\)/, 'the margin would push it out of its column');
});

test('the Photos dropzone is labelled like the field beside it', () => {
  /* An unlabelled dropzone reads as decoration until you notice the Browse
     button; Description next to it says what it is. */
  const at = html.indexOf('Neon Neon-theme-dragdropbox');
  const before = html.slice(Math.max(0, at - 700), at);
  assert.match(before, /lang_item_photos_title/, 'the dropzone has no label');
  assert.match(before, /for="item_upload_image"/, 'the label is not tied to the input');
});

/*
 * Saving on a tabbed form.
 *
 * An error on a hidden tab is an error nobody sees: jQuery Validate focuses the
 * first invalid field, and if that pane is not on screen the focus goes
 * nowhere and the message renders where nobody is looking. Save appeared to do
 * nothing at all.
 */
test('a validation error opens the tab it is on', () => {
  const at = itemsJs.indexOf('invalidHandler: function (event, validator)');
  assert.notStrictEqual(at, -1, 'nothing reacts to an invalid form');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n        },', at));
  assert.match(body, /validator\.invalidElements\(\)/, 'it does not ask which fields failed');
  assert.match(body, /PosnicPro\.items\.tabOf\(first\)/, 'it does not work out which tab to open');
  assert.match(body, /goToTab\(pane/, 'it never switches to that tab');
});

test('a successful save returns to the first tab, on the name', () => {
  /* Focusing the name without switching tabs put the cursor on a hidden pane
     whenever the item was saved from Details or More. */
  const at = itemsJs.indexOf("if (PosnicPro.action === 'add') {");
  const body = itemsJs.slice(at, itemsJs.indexOf('\n                        }', at));
  assert.match(
    body,
    /goToTab\('item_tab_main', '#items_name'\)/,
    'it must switch tabs AND focus, not just focus',
  );
  assert.ok(!/\$\('#items_name'\)\.focus\(\);/.test(body), 'the bare focus call is back');
});

test('focus waits for the pane to be shown', () => {
  /* A field on a pane that is still display:none cannot take focus - the
     browser silently refuses. */
  const at = itemsJs.indexOf('goToTab: function (paneId, focusSelector)');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n    },', at));
  assert.match(body, /setTimeout\(/, 'focus happens before the tab has rendered');
  assert.match(body, /is\(':visible'\)/, 'it focuses regardless of whether the field is showing');
  /* select2 hides its own select, so focusing that would do nothing visible. */
  assert.match(body, /select2-hidden-accessible/, 'a select2 field cannot be focused this way');
});

test('an already-active tab is not re-shown', () => {
  /* .tab('show') on the active tab re-fires shown.bs.tab, which re-runs the
     tick refresh and any other listener for no reason. */
  const at = itemsJs.indexOf('goToTab: function (paneId, focusSelector)');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n    },', at));
  assert.match(body, /if \(!\$link\.hasClass\('active'\)\) \{ \$link\.tab\('show'\); \}/);
});

test('the tile preview shows what the item will actually look like', () => {
  /* The swatches sat unselected, so "no image" read as "no appearance" - which
     was never true, since the save derives a colour from the name and stores
     it. */
  assert.match(html, /id="item_tile_preview"/, 'the preview is gone from the form');
  const at = itemsJs.indexOf('refreshTilePreview: function ()');
  assert.notStrictEqual(at, -1, 'nothing renders the preview');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n    },', at));
  assert.match(body, /PosnicPro\.autoTile\(name\)/, 'it does not use the same rule the save uses');
  assert.match(body, /if \(!name\) \{ \$box\.hide\(\); return; \}/, 'an unnamed item previews a meaningless colour');
});

test('the automatic colour is derived, never random', () => {
  /* A sale grid is navigated by recognition - "the red one is Coke". A colour
     that differs between tills, or changes on re-render, teaches a habit and
     then breaks it. The hash of the name gives the same variety and none of
     that. */
  const salesJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
    'utf8',
  );
  const at = salesJs.indexOf('PosnicPro.autoTile = function (name)');
  assert.notStrictEqual(at, -1, 'autoTile is gone');
  const body = salesJs.slice(at, salesJs.indexOf('\n};', at));
  assert.ok(!/Math\.random/.test(body), 'the tile colour is random - it cannot be recognised twice');
  assert.match(body, /h \* 31 \+ str\.charCodeAt/, 'it no longer derives from the name');
});

/*
 * Variant mode: the order you fill the form in must not matter.
 *
 * loadVariant needs the item name - every row is titled "<item> / <value>" - so
 * choosing variants first produced "Fill in the required fields" and NO pricing
 * rows. The message did not say which field was missing, the field was on
 * another card, and nothing rebuilt the rows once the name was typed. Reported
 * as an error on picking a variant, and "no place to enter pricing details".
 */
test('the variant error that remains names its field', () => {
  /* The missing-NAME error is gone entirely - the rows build without it now.
     The one remaining refusal (no values chosen) still has to say so. */
  const at = itemsJs.indexOf('loadVariant: function ()');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n        } else {', at));
  assert.ok(
    !/Fill in the required fields\./.test(body),
    'the generic message is back - it does not say which field, or where it is',
  );
  assert.match(body, /Choose at least one variant value/, 'the empty-values case says nothing useful');
});

test('the item name arriving fills headings without touching the rows', () => {
  /* Filling the name last has to work, and must not cost anything already
     typed into the pricing rows. */
  const at = itemsJs.indexOf("$(document).on('input', '#items_name', function () {\n        if (!$('#product_with_variant')");
  assert.notStrictEqual(at, -1, 'nothing updates the rows when the name arrives');
  const body = itemsJs.slice(at, itemsJs.indexOf('\n    });', at));
  assert.match(body, /product_with_variant/, 'it runs outside variant mode too');
  assert.match(body, /retitleVariantRows\(\)/, 'the headings never fill in');
  assert.doesNotMatch(
    body,
    /loadVariant\(\)/,
    'a keystroke in the name rebuilds the rows and wipes prices already typed',
  );
});

/*
 * Close returns where you came from.
 */
test('following "Open it" and closing goes back, not to the list', () => {
  const core = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'),
    'utf8',
  );
  assert.match(core, /on\('click', '\[id\^="last_created_"\]'/, 'nothing records where you came from');
  assert.match(core, /PosnicPro\.returnTo = currentHash/, 'the origin is not captured');
  const at = core.indexOf('if (PosnicPro.returnTo) {');
  assert.notStrictEqual(at, -1, 'the close handler ignores the marker');
  const body = core.slice(at, core.indexOf('var patt =', at));
  assert.match(body, /PosnicPro\.returnTo = '';/, 'a stale marker would hijack an unrelated Close');
  assert.ok(
    body.indexOf("PosnicPro.returnTo = '';") < body.indexOf('hasher.setHash(back)'),
    'it must be cleared BEFORE navigating, or a failed nav leaves it armed',
  );
});

test('the variant pricing rows do not wait for the item name', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/script/js/modules/js/items.js'),
    'utf8',
  );
  const at = js.indexOf('loadVariant: function ()');
  assert.notStrictEqual(at, -1, 'loadVariant is gone');
  const fn = js.slice(at, js.indexOf('\n    },', at));

  // The bug: picking a variant value errored and rendered nothing, so there
  // was nowhere to type a price. Clicking Save then re-entered and finally
  // drew the rows - which is why Save looked like it opened the price box.
  const guard = fn.slice(0, fn.indexOf('$(variant_value).each'));
  assert.doesNotMatch(
    guard,
    /items_name.*length <= 2/s,
    'the rows are gated on the item name again - picking a value will error with no price fields',
  );
  assert.doesNotMatch(
    guard,
    /Enter the item name first/,
    'the name is still being demanded before the rows can be built',
  );
  // The values guard is the one that legitimately remains.
  assert.match(guard, /variant_value\.length === 0/, 'nothing checks that a value was chosen');
});

test('a variant row heading survives having no item name yet', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/script/js/modules/js/items.js'),
    'utf8',
  );
  const at = js.indexOf('variantRowTitle: function (index, itemName, value)');
  assert.notStrictEqual(at, -1, 'variantRowTitle is gone');
  const fn = js.slice(at, js.indexOf('\n    },', at));
  // Without a name it must not render "undefined / Large" or " / Large".
  assert.match(fn, /name \? name \+ ' \/ ' : ''/, 'the separator is emitted with no name in front of it');

  // Retitling, not rebuilding: a rebuild on every keystroke discards prices.
  const rt = js.indexOf('retitleVariantRows: function ()');
  assert.notStrictEqual(rt, -1, 'retitleVariantRows is gone');
  const body = js.slice(rt, js.indexOf('\n    },', rt));
  assert.doesNotMatch(body, /loadVariant\(\)/, 'retitling rebuilds the rows and throws away typed prices');
  assert.match(body, /variant-row-title/, 'nothing selects the headings to retitle');

  // and the heading must carry what the retitle needs to rebuild its text
  assert.match(js, /data-variant-value="' \+ name \+ '"/, 'the heading does not record its value');
  assert.match(js, /data-variant-index="' \+ \(key \+ 1\) \+ '"/, 'the heading does not record its number');
});

test('services and variants are mutually exclusive', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/script/js/modules/js/items.js'),
    'utf8',
  );
  const at = js.indexOf('applyServiceMode: function ()');
  assert.notStrictEqual(at, -1, 'applyServiceMode is gone');
  const fn = js.slice(at, js.indexOf('\n    },', at));
  // A variant family is a family of STOCK rows (sku, barcode, quantity), and
  // _sharedItemFields stamps item_kind:'service' on every one of them.
  assert.match(fn, /\$\('#variant_mode_link'\)\.toggle\(!isService\)/, 'a service can still be given variants');
  assert.match(
    fn,
    /product_without_variant'\)\.prop\('checked', true\)\.trigger\('change'\)/,
    'ticking Service leaves an active variant family in place',
  );
  assert.match(fn, /alert\('info'/, 'the variant rows are cleared silently');

  // and the reverse direction
  const vt = js.indexOf('$("#product_without_variant, #product_with_variant").change');
  assert.notStrictEqual(vt, -1, 'the variant mode handler is gone');
  const vbody = js.slice(vt, vt + 900);
  assert.match(
    vbody,
    /#item_is_service'\)\.closest\('\.custom-control'\)\.toggle\(plain\)/,
    'the Service tick stays offered while building a variant family',
  );
});

test('every field in Extra barcodes & packs is labelled', () => {
  /* A placeholder disappears the moment you type, so a filled-in field stops
     saying what it is - which is exactly when someone goes back to check.
     These three were the only unlabelled inputs left on the screen. */
  for (const id of ['items_barcodes_alt', 'items_purchase_unit', 'items_conversion_factor']) {
    const label = new RegExp('<label[^>]*for="' + id + '"');
    assert.match(html, label, id + ' has a placeholder and no label');
  }
  // and they use the same label class as the rest of the form, not a new one
  const at = html.indexOf('for="items_purchase_unit"');
  assert.match(
    html.slice(at - 120, at),
    /items-label-inline/,
    'the new labels do not match the label style used everywhere else',
  );
});

test('a service hides the pack fields, extra barcodes included', () => {
  /* applyServiceMode hides these with .closest('.form-row'). items_barcodes_alt
     sat directly in the card body with no .form-row above it, so closest()
     matched nothing and a service kept showing an extra-barcodes box. */
  const at = html.indexOf('id="items_barcodes_alt"');
  assert.notStrictEqual(at, -1, 'items_barcodes_alt is gone');
  const before = html.slice(0, at);
  const rowAt = before.lastIndexOf('form-row');
  const cardBodyAt = before.lastIndexOf('card-body');
  assert.ok(
    rowAt > cardBodyAt,
    'items_barcodes_alt has no .form-row wrapper - applyServiceMode cannot hide it',
  );

  const js = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/script/js/modules/js/items.js'),
    'utf8',
  );
  assert.match(
    js,
    /#items_barcodes_alt, #items_purchase_unit, #items_conversion_factor'\)\.closest\('\.form-row'\)/,
    'the service-mode hide no longer covers all three pack fields',
  );
});
