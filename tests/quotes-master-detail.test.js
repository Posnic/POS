const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, cssReader } = require('./helpers/source-lookup');

/*
 * The quotes master-detail: one surface, and only the document changes.
 *
 * Two bugs are pinned here, both reported from the live till.
 *
 * 1. FLICKER. showDetails() ran the whole page-entry ritual on every row
 *    click. #quotes_new itself carries the class .page_loader, so
 *    $('.page_loader').hide() tore down the very list being clicked in, and
 *    the next line built it back. Re-entering a page you are already on also
 *    throws away the rail's scroll position and restarts its transitions.
 *    Entering the page and moving between quotes are different operations;
 *    only the first may touch the page chrome.
 *
 * 2. THE EDITOR SHARES THE CONTENTBAR. It is a third child of the same
 *    element the split lays out, so "is the split on?" is not enough to
 *    decide a click is safe to fast-path, and the editor must switch the
 *    split off or it inherits the rail's border and a flex width it never
 *    asked for.
 *
 * The list assertions cover the joined look itself - two cards with a gap
 * between them was the thing being replaced - and the pager, which existed
 * but rendered only past page one, so on a shop with eight quotes it looked
 * like paging had never been built.
 */

const ROOT = path.join(__dirname, '..');
const salesSource = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8',
);
const css = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'),
  'utf8',
);
const cssRule = cssReader(css);

/* sales.js defines showDetails twice - sales history has one too - so every
   lookup starts from the quotes namespace rather than the top of the file.
   An unanchored marker here would silently test the wrong module. */
const quotesNamespace = blockAt(salesSource, 'PosnicPro.quotes = {');


test('moving between quotes does not re-enter the page', () => {
  const body = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const guard = blockAt(body, 'if (!PosnicPro.quotes._inSplit()) {');

  // the page-entry ritual lives INSIDE the guard, nowhere else. Count the
  // call itself - the comment above it names .page_loader too.
  const teardown = "$('.page_loader,#osk-container').hide()";
  assert.ok(
    guard.includes(teardown),
    'the page teardown must sit inside the already-on-page guard',
  );
  assert.strictEqual(
    body.split(teardown).length - 1,
    1,
    'the page teardown appears twice - one of them escapes the guard',
  );
  assert.ok(
    guard.includes("$('#quotes_edit_card').hide()"),
    'hiding the editor belongs to page entry',
  );
});

test('but the highlight still moves on every click', () => {
  const body = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const guard = blockAt(body, 'if (!PosnicPro.quotes._inSplit()) {');
  assert.ok(body.includes('is-active'), 'the clicked row must be marked');
  assert.ok(
    !guard.includes('is-active'),
    'the highlight is inside the guard, so it would only move on page entry',
  );
  assert.ok(
    body.indexOf('is-active') > body.indexOf(guard) + guard.length - 1,
    'the highlight must be applied after the guard block, on every call',
  );
});

test('the fast path requires a document open and the editor closed', () => {
  const fn = blockAt(quotesNamespace, '_inSplit: function () {');
  for (const required of ['#quotes_new', '#quotes_view_card', '#quotes_edit_card', 'quotes-split']) {
    assert.ok(fn.includes(required), `_inSplit must consider ${required}`);
  }
  // the editor check is a negative one - it must NOT be visible
  assert.match(
    fn,
    /!\$\('#quotes_edit_card'\)\.is\(':visible'\)/,
    'a click while the editor is open must fall through to full page entry',
  );
});

test('the editor leaves the joined surface', () => {
  const shell = blockAt(quotesNamespace, '_edShell: function () {');
  assert.match(
    shell,
    /removeClass\('quotes-split rail-collapsed'\)/,
    'the editor must switch the split off or it is laid out as a rail sibling',
  );
});

test('the pager states the count even on a single page', () => {
  const render = blockAt(quotesNamespace, 'renderList: function () {');
  const pager = render.slice(render.indexOf('q-pager'));
  assert.ok(pager, 'no pager is rendered at all');
  // the count is unconditional; only the arrows are gated on pages > 1
  assert.ok(
    /total \+ \(total === 1 \? ' quote' : ' quotes'\)/.test(pager),
    'the quote count must render regardless of page count',
  );
  assert.ok(
    !/if \(pages > 1\) \{[\s\S]*q-pager/.test(render),
    'the whole pager is still gated behind pages > 1',
  );
});

test('the two panes read as one surface, not two cards', () => {
  const split = cssRule('#quotes_new .contentbar.quotes-split {');
  assert.match(split, /gap:\s*0/, 'a gap between the panes is the thing being removed');
  assert.match(split, /border:\s*1px/, 'the outer border belongs to the split itself');
  assert.match(split, /align-items:\s*stretch/, 'the divider must run the full height');

  const panes = cssRule('#quotes_new .contentbar.quotes-split > #quotes_list_card,');
  assert.match(panes, /border:\s*0/, 'the panes must give up their own borders');
  assert.match(panes, /box-shadow:\s*none/, 'two shadows would redraw the seam');

  // and the panes must beat the theme, which sets .card borders !important
  assert.match(panes, /border:\s*0\s*!important/, 'a plain rule loses to the theme');
  assert.match(panes, /margin:\s*0\s*!important/, 'a stray card margin is the gap');

  // NO divider: the owner counted the borders, so the change of ground does it
  /* two rules share this selector - the main one and the >=1500px override -
     so anchor on the comment that sits above the main one */
  const rail = cssRule(
    '#quotes_new .contentbar.quotes-split > #quotes_list_card {',
    'drawn with colour instead of yet another',
  );
  assert.ok(
    !/border-right:\s*1px/.test(rail),
    'the list must not draw a right border - that line is what breaks the join',
  );
  assert.match(rail, /background:\s*#f6f8fa/i, 'the list is the recessed side');

  // and it must not butt into the breadcrumb bar above it
  assert.match(split, /margin:\s*20px\s+30px/, 'the split needs a top gap and page gutters');
});

test('each pane scrolls itself, so neither drags the other out of reach', () => {
  const rows = cssRule('.quotes-split #quotes_list_card #quotes_list_rows {');
  assert.match(rows, /overflow-y:\s*auto/);
  // without min-height:0 a flex child refuses to shrink and the scrollbar
  // lands on the page instead of inside the rail
  assert.match(rows, /min-height:\s*0/, 'a flex child needs min-height:0 to scroll');
});

test('the open-price checkbox stacks its hint instead of racing it', () => {
  const rule = cssRule('#items_new .custom-control.custom-checkbox {');
  assert.ok(
    !/display:\s*flex/.test(rule),
    'flex turns the label and its hint into two one-word-wide columns',
  );
  assert.match(rule, /min-height:\s*24px/, 'the centring this rule exists for must survive');
});

test('the item form tabs take the width of their words', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
  const tabs = html.slice(html.indexOf('id="item_form_tabs"') - 300, html.indexOf('id="item_form_tabs"') + 40);
  const ul = tabs.slice(tabs.lastIndexOf('<ul'));
  assert.ok(
    !/nav-justified/.test(ul),
    'nav-justified gives each tab an equal share of the full page width',
  );
  assert.ok(/nav-tabs/.test(ul), 'they are still tabs');
});

/*
 * The reading pane, second pass.
 *
 * The owner's brief: a mail app. The list and the document connect, the
 * SELECTED row is the near edge of the document rather than a highlighted
 * line in a list, there is no Back (the list never left - there is a Close),
 * and the toolbar stops shouting eleven buttons at once.
 */

const quotesHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'quotes.html'), 'utf8');

test('the selection is the near edge of the document, not a tinted row', () => {
  // the row and its cells are painted together, so the rule is a group
  const active = cssRule('.quotes-split #quotes_list_rows tr.quotes-row.is-active,');
  // the pane's ground, so the two read as one surface
  assert.match(
    active,
    /background:\s*#fff\s*!important/i,
    'the active row must share the pane background, and beat the global .card rule',
  );

  // The selection is bordered on three sides so it reads clearly, but nothing
  // may draw a line down its RIGHT - that is what would cut it off from the
  // document beside it.
  /* `is-active > td` heads more than one rule - the grouped one that paints
     it and the one that borders it - so match by CONTENT: [^}] cannot cross a
     closing brace, so this finds the bordering rule rather than whichever
     comes first. */
  assert.match(
    css,
    /is-active > td \{[^}]*border-top:\s*1px solid/,
    'the row needs a visible edge',
  );
  assert.match(
    css,
    /is-active > td \{[^}]*border-bottom:\s*1px solid/,
    'the row needs a visible edge',
  );
  assert.match(
    css,
    /is-active > td:first-child \{[^}]*border-left:\s*3px solid/,
    'the accent edge marks which row is open',
  );
  assert.ok(
    !/is-active[^{]*\{[^}]*border-right:\s*[1-9]/.test(css),
    'a right border on the selected row would cut it off from the document',
  );
  const pane = cssRule(
    '#quotes_new .contentbar.quotes-split > #quotes_view_card {',
    'The toolbar is pinned',
  );
  assert.match(pane, /background:\s*#fff/i, 'the document is the white side of the pair');
});

test('the rail has no side padding, or the selection cannot reach the divider', () => {
  const body = cssRule('#quotes_new .contentbar.quotes-split > #quotes_list_card > .card-body {');
  assert.match(body, /padding:\s*0\s*!important/, 'full-bleed rows are what make the join possible');
});

test('a wide screen shows the whole list AND the quote', () => {
  // the columns are hidden by a max-width query now, not unconditionally
  const at = css.indexOf('.quotes-split #quotes_list_card .q-col-date');
  assert.notStrictEqual(at, -1);
  const before = css.slice(0, at);
  const lastMedia = before.lastIndexOf('@media');
  assert.match(
    before.slice(lastMedia, lastMedia + 40),
    /max-width:\s*1499px/,
    'the columns must only disappear when the rail is actually narrow',
  );
});

test('Back is gone; closing is what returns the full list', () => {
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  assert.ok(!/&larr; Back/.test(view), 'a reading pane has nothing to go back to');
  assert.ok(quotesHtml.includes('id="quotes_view_close"'), 'there must be a close control');
  const handler = blockAt(salesSource, "$(document).on('click', '#quotes_view_close', function () {");
  assert.ok(
    handler.includes('showDataTablePage'),
    'closing must hand the list the full width again',
  );
});

test('the toolbar is four controls, with the rest under Share and More', () => {
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const bar = view.slice(view.indexOf('var mi = function'), view.indexOf("$('#quotes_view_actions')"));

  // everything that only sends a copy somewhere is a menu item, not a button
  for (const shared of ['Print', 'Download PDF', 'Email', 'WhatsApp', 'Copy link']) {
    assert.ok(bar.includes(shared), `${shared} should still be reachable`);
  }
  const buttons = bar.match(/<button type="button" class="btn btn-sm/g) || [];
  assert.ok(
    buttons.length <= 5,
    `the visible toolbar grew back to ${buttons.length} buttons`,
  );
  // green is reserved for "succeeded" now, so no action wears it
  assert.strictEqual(
    (bar.match(/btn-success/g) || []).length,
    0,
    'an action must not be green - green means an outcome',
  );
  assert.ok(bar.includes('Convert to sale'), 'the primary action must still be there');
});

test('destroying a quote is a menu item, never a button next to Print', () => {
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const bar = view.slice(view.indexOf('var mi = function'), view.indexOf("$('#quotes_view_actions')"));
  for (const danger of ['Cancel quote', 'Delete quote']) {
    const at = bar.indexOf(danger);
    assert.notStrictEqual(at, -1, `${danger} disappeared entirely`);
    // it is rendered through mi(), the dropdown-item helper
    assert.match(bar.slice(Math.max(0, at - 120), at), /mi\('PosnicPro\.quotes\./, `${danger} must be a menu item`);
  }
});

test('Save changes stays hidden until something is actually edited', () => {
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const at = view.indexOf('id="q_save_edits"');
  assert.notStrictEqual(at, -1, 'the save button is gone');
  assert.match(
    view.slice(at, at + 120),
    /style="display:none;"/,
    'it must start hidden - an always-lit save button teaches people to ignore it',
  );
  const reveal = blockAt(salesSource, "$(document).on('input', '#quotes_view_body .q-edit', function () {");
  assert.ok(reveal.includes("$('#q_save_edits').show()"), 'editing must reveal it');
});

test('New sits in the page header like every other list screen', () => {
  assert.ok(
    !/New quotation<\/button>/.test(quotesHtml),
    'the green block inside the list is what the owner objected to',
  );
  const bar = quotesHtml.slice(
    quotesHtml.indexOf('<div class="breadcrumbbar">'),
    quotesHtml.indexOf('<div class="contentbar">'),
  );
  assert.ok(bar.includes('widgetbar'), 'it belongs in the header widgetbar');
  assert.ok(
    bar.includes('btn-primary-rgba'),
    'and takes the same class as Customers and Items, not a one-off green',
  );
});

test('the toolbar is pinned so its menus are not clipped', () => {
  // a dropdown inside an overflow:auto ancestor gets cut off at its edge
  const pane = cssRule(
    '#quotes_new .contentbar.quotes-split > #quotes_view_card {',
    'The toolbar is pinned',
  );
  assert.ok(!/overflow-y:\s*auto/.test(pane), 'the card itself must not be the scroller');
  assert.match(pane, /flex-direction:\s*column/);
  const docBody = cssRule('.quotes-split #quotes_view_body {');
  assert.match(docBody, /overflow:\s*auto/, 'the document scrolls instead');
});

/*
 * Add Item alignment.
 *
 * The Item card sits at half the page width. Three fields across it left each
 * one about 135px, so "In stock (opening)" and the open-price label wrapped
 * to two lines while "Selling" stayed on one - and every input beneath them
 * started at a different height. Widening the columns is the fix; the label
 * rule is the belt to its braces.
 */
test('Add Item fields have room, so their labels do not wrap unevenly', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
  const colOf = (fieldId) => {
    const at = html.indexOf(`for="${fieldId}"`);
    assert.notStrictEqual(at, -1, `${fieldId} not found`);
    const before = html.slice(0, at);
    const div = before.slice(before.lastIndexOf('<div'));
    const m = div.match(/col-md-(\d+)/);
    assert.ok(m, `${fieldId} is not in a column`);
    return Number(m[1]);
  };

  // the name gets its own line; price and stock pair up beneath it
  assert.strictEqual(colOf('items_name'), 12, 'the item name needs the full card width');
  assert.strictEqual(colOf('items_selling_price'), 6);
  assert.strictEqual(colOf('items_available_quantity'), 6);

  // Price & Stock is a clean 2x2 rather than four thirds wrapping 3+1
  for (const f of ['items_company_price', 'items_mrp_price', 'items_reorder_point', 'items_unit']) {
    assert.strictEqual(colOf(f), 6, `${f} should be half the card`);
  }

  // m-t-9 was a one-off nudge that pushed Item Units out of line with its pair
  assert.ok(!html.includes('m-t-9'), 'a one-off margin is what breaks a shared baseline');
});

test('and the labels reserve a line so inputs share a baseline', () => {
  const rule = cssRule('#items_new .form-row > .form-group > label.form-control-placeholder,');
  assert.match(rule, /min-height:\s*21px/, 'a bare inline label lets its input float up');
  assert.match(rule, /display:\s*block/);
});

/*
 * "The full row needs to be highlighted, not only the left blue border."
 *
 * It already was white - but a plain global rule sets .card and .card-body
 * background from the theme with !important, which forced the LIST white too.
 * A white row on a white list is not a highlight, so all that read was the
 * blue edge. The ground has to win first; the row highlight depends on it.
 */
test('the list ground wins against the global card rule', () => {
  for (const [sel, anchor] of [
    ['#quotes_new .contentbar.quotes-split > #quotes_list_card {', 'drawn with colour instead of yet another'],
    ['#quotes_new .contentbar.quotes-split > #quotes_list_card > .card-body {', undefined],
  ]) {
    const rule = cssRule(sel, anchor);
    assert.match(
      rule,
      /background:\s*#f6f8fa\s*!important/i,
      `${sel} must beat the global .card background rule, or the list stays white`,
    );
  }
});

test('the whole row is the highlight, not a mark on its edge', () => {
  const cells = cssRule('.quotes-split #quotes_list_rows tr.quotes-row.is-active,');
  // every CELL is painted, so the highlight spans the full width
  assert.ok(
    cells.includes('background'),
    'the cells must be painted or the row highlight stops at the first one',
  );
  /* `.is-active > td` appears twice - once in the group that paints it, once
     in the rule that emphasises it. [^}] cannot cross a closing brace, so
     this matches the emphasis rule rather than the first occurrence. */
  assert.match(
    css,
    /is-active > td \{[^}]*font-weight:\s*600/,
    'the whole row reads as selected, not one cell',
  );

  // unselected rows must NOT be painted white, or nothing stands out
  const others = cssRule('.quotes-split #quotes_list_rows tr.quotes-row > td {');
  assert.match(others, /background:\s*transparent/, 'unselected rows sit on the grey');
});

/*
 * The bridge (owner ask): black, not blue, and the same line on both sides.
 *
 * An accent-coloured rule reads as decoration; a plain dark rule reads as
 * structure. The selection and the document wear the SAME line so the two
 * horizontal borders carry the eye out of the list and around the quote,
 * rather than stopping dead at the divider.
 */
test('the selection is drawn in ink, not in the accent colour', () => {
  /* `is-active > td` heads two rules - the one that paints the row and the one
     that borders it - so pick the block by CONTENT. Matching the first
     occurrence lands on the background rule, which has no border at all and
     would pass this test for the wrong reason. */
  const blocks = [...css.matchAll(/is-active > td[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  const bordered = blocks.filter((b) => /border-top:|border-left:/.test(b));
  assert.ok(bordered.length >= 2, 'expected the border rules for the row and its first cell');
  /* Only the BORDER declarations - the row also sets a near-black text colour,
     which is correct and is not what "too rude" was about. */
  const borderLines = bordered
    .flatMap((b) => b.split(/\r?\n/))
    .filter((l) => /border(-top|-bottom|-left)?\s*:/.test(l));
  assert.ok(borderLines.length >= 3, 'expected top, bottom and left border declarations');

  for (const line of borderLines) {
    assert.ok(
      !/#0969da/i.test(line),
      'an accent-coloured border reads as decoration, not structure',
    );
    for (const tooDark of ['#1f2328', '#57606a']) {
      assert.ok(
        !new RegExp(tooDark, 'i').test(line),
        `${tooDark} overshot - the selection needs to be more than its neighbours, not dark`,
      );
    }
    assert.match(line, /#8c959f/i, 'one clear step darker than the ordinary border');
  }
});

test('the A4 quote keeps its own paper edge', () => {
  /* An earlier round gave the sheet the selection's colour so the two shared
     one line. The owner asked for the document design to be left alone, so the
     sheet takes no border override at all and keeps .q-sheet's lighter edge -
     only the SELECTION is drawn darker. */
  const sheet = cssRule('.quotes-split #quotes_view_card .q-sheet {');
  assert.ok(
    !/border-color/.test(sheet),
    'the document should not be restyled to match the list highlight',
  );
  assert.match(sheet, /padding:/, 'it still gets its tighter padding inside the split');
});

/*
 * Add Item, Details and More tabs (owner queue #32).
 *
 * "Brand, Tags, this width not required... Browse button too big... images
 * unorganised." Three complaints with one cause: the fields run the full
 * width of whatever column holds them, so a wide screen gives a 700px box for
 * a brand name. A short value does not become easier to type in a wider box,
 * and without a consistent right-hand edge the form scans as a spreadsheet.
 */
test('short fields on the Details and More tabs are capped', () => {
  const rule = cssRule('#items_new #item_tab_details input.form-control,');
  assert.match(rule, /max-width:\s*420px/, 'a brand name does not need 700px');
});

test('the description keeps more room than the short fields, but not the page', () => {
  const desc = cssRule('#items_new #items_description {');
  const m = desc.match(/max-width:\s*(\d+)px/);
  assert.ok(m, 'the description needs a cap too');
  assert.ok(Number(m[1]) > 420, 'it holds sentences, so it gets more than a brand name');
  assert.ok(Number(m[1]) <= 800, 'but a text column past ~800px is hard to read back');
});

test('the dropzone is one control on a tab, not a landing page', () => {
  const heading = cssRule('#items_new .Neon-input-text h3 {');
  const m = heading.match(/font-size:\s*([\d.]+)px/);
  assert.ok(m && Number(m[1]) <= 15, 'an h3 caption is what made it read as oversized');

  const btn = cssRule('#items_new .Neon-input-choose-btn {');
  assert.match(btn, /font-size:/, 'the Browse button needs sizing down with it');
});

test('image previews lay out as a wrapping row rather than however they fall', () => {
  const preview = cssRule('#items_new #item-display-preview {');
  assert.match(preview, /display:\s*flex/);
  assert.match(preview, /flex-wrap:\s*wrap/);
  assert.match(preview, /gap:/, 'thumbnails need space between them to read as separate');
});

/*
 * Arriving straight at a quote - refresh, bookmark, shared link.
 *
 * The URL #/quotes/<id> routes to showDetails, which builds the split and
 * fetches the document. It never filled the RAIL: only showDataTablePage
 * loaded the list, so a refresh left the quote sitting beside a list that
 * still said "Loading quotes ...". Clicking through from the list hid it,
 * because by then the rail was already populated.
 */
test('arriving directly at a quote fills the list too', () => {
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const entry = blockAt(view, 'if (!PosnicPro.quotes._inSplit()) {');
  assert.ok(
    entry.includes('PosnicPro.quotes.load()'),
    'a refresh onto a quote URL would otherwise show an empty rail',
  );
});

test('but moving between quotes does NOT reload the list', () => {
  /* The load belongs inside the page-entry branch. Outside it, every row
     click would refetch and repaint the rail - which is the flicker the
     guard was added to stop in the first place. */
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const entry = blockAt(view, 'if (!PosnicPro.quotes._inSplit()) {');
  const outside = view.replace(entry, '');
  assert.ok(
    !outside.includes('PosnicPro.quotes.load()'),
    'reloading the rail on every row click reintroduces the flicker',
  );
});

test('whichever of list and quote lands second places the highlight', () => {
  /* They load in parallel on a fresh arrival. renderList marks the row when
     the list wins; showDetails must mark it when the quote wins, or a refresh
     shows the document with nothing selected beside it. */
  const view = blockAt(quotesNamespace, 'showDetails: function (id) {');
  const afterCurrent = view.slice(view.indexOf('PosnicPro.quotes._current = q;'));
  assert.match(
    afterCurrent,
    /is-active/,
    'the highlight must also be applied once the quote itself arrives',
  );

  const render = blockAt(quotesNamespace, 'renderList: function () {');
  assert.match(render, /is-active/, 'and renderList keeps doing it from _current');
});

/*
 * Add Item: capped, but LEFT (owner: "all boxes centered. not good").
 *
 * Capping the width is right - a form is read down a column, and a 1900px row
 * pushes a label miles from its field. Centring the capped block was not: the
 * page title and the tab strip sit hard left, so the cards floated away from
 * them and left a dead gutter down the left of the screen.
 */
test('the Add Item tabs are width-capped but stay left-aligned', () => {
  const rule = cssRule('#items_new #item_tab_main,');
  assert.match(rule, /max-width:\s*\d+px/, 'a form should not span a 1900px monitor');
  assert.match(
    rule,
    /margin-left:\s*0/,
    'the cap decides where content ENDS, never where it starts',
  );
  assert.ok(
    !/margin-left:\s*auto/.test(rule),
    'auto on the left centres the block and abandons the page left edge',
  );
});

/*
 * Add Item, Item tab: SKU & Barcodes belongs under Price & Stock, on the right
 * (owner ask). It used to sit in a full-width row AFTER both columns closed,
 * so it fell under the Item card on the left and the right column ended short.
 */
test('SKU & Barcodes sits inside the right column, under Price & Stock', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
  const tab = html.slice(html.indexOf('id="item_tab_main"'), html.indexOf('id="item_tab_details"'));

  const sku = tab.indexOf('id="sku_card_col"');
  assert.notStrictEqual(sku, -1, 'the SKU card must still be on this tab');
  assert.ok(tab.indexOf('lang_price_stock_title') < sku, 'it comes after Price & Stock');

  /* Walk the divs before it and check a col-lg-6 wrapper is still open -
     that is what puts it in a COLUMN rather than a full-width row below
     both of them. */
  let depth = 0;
  const open = [];
  for (const m of tab.slice(0, sku).matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (m[0].startsWith('</')) {
      if (open.length && open[open.length - 1] === depth) open.pop();
      depth -= 1;
    } else {
      depth += 1;
      if (m[0].includes('col-lg-6')) open.push(depth);
    }
  }
  assert.ok(open.length > 0, 'the SKU card escaped its column and fell full-width again');
});

test('the SKU wrapper keeps the id items.js toggles', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'items_write.html'), 'utf8');
  const js = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js'),
    'utf8',
  );
  assert.ok(html.includes('id="sku_card_col"'), 'the id must survive the move');
  assert.ok(js.includes('#sku_card_col'), 'items.js shows/hides it with the variant toggle');
});

/*
 * Quote filters (owner: "indexed search is fine, but I want filters too -
 * exact field and time duration").
 */
test('the rail offers a field selector, an exact toggle and a date window', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'quotes.html'), 'utf8');
  for (const id of ['quotes_search_field', 'quotes_search_exact', 'quotes_from', 'quotes_to', 'quotes_filters_clear']) {
    assert.ok(html.includes(`id="${id}"`), `${id} missing from the filter bar`);
  }
  // the field list must name the columns the server accepts
  const sel = html.slice(html.indexOf('id="quotes_search_field"'), html.indexOf('quotes_search_exact'));
  for (const v of ['all', 'quote_id', 'customer_name']) {
    assert.ok(sel.includes(`value="${v}"`), `${v} should be selectable`);
  }
});

test('the filters are actually sent with the request', () => {
  const load = blockAt(quotesNamespace, 'load: function (keepPage) {');
  for (const p of ['params.field', 'params.exact', 'params.from', 'params.to']) {
    assert.ok(load.includes(p), `${p} is never sent`);
  }
});

test('defaults are omitted rather than spelled out', () => {
  /* field=all&exact=false says exactly what sending neither says, and a URL
     that states its defaults is harder to read in a log. */
  const load = blockAt(quotesNamespace, 'load: function (keepPage) {');
  assert.match(load, /field !== 'all'/, 'the default field should not be sent');
  assert.match(load, /is\(':checked'\)/, 'exact should only be sent when ticked');
});

test('changing a filter reloads the list, and Clear resets every control', () => {
  const onChange = blockAt(
    salesSource,
    "$(document).on('change', '#quotes_search_field,#quotes_search_exact,#quotes_from,#quotes_to', function () {",
  );
  assert.ok(onChange.includes('PosnicPro.quotes.load()'), 'a changed filter must reload');

  const clear = blockAt(salesSource, "$(document).on('click', '#quotes_filters_clear', function () {");
  for (const id of ['#quotes_search', '#quotes_search_field', '#quotes_search_exact']) {
    assert.ok(clear.includes(id), `Clear leaves ${id} set`);
  }
  assert.ok(clear.includes('PosnicPro.quotes.load()'), 'Clear must reload too');
});

test('the filter controls flex with the rail rather than using fixed widths', () => {
  /* The rail is 330px on a laptop and 560px past 1500px, so a fixed-width
     control either overflows the narrow case or strands space in the wide one. */
  const row = cssRule('.q-filter-row {');
  assert.match(row, /display:\s*flex/);
  assert.match(row, /gap:/, 'gap, not margins - a wrapped row must still space itself');
  const search = cssRule('.q-filter-row #quotes_search {');
  assert.match(search, /flex:\s*1 1 auto/, 'the search box should take the slack');
});
