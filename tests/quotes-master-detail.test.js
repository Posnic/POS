const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, cssReader, stripComments } = require('./helpers/source-lookup');

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

test('the pager always says something, even on a single page', () => {
  const render = blockAt(quotesNamespace, 'renderList: function () {');
  const pager = render.slice(render.indexOf('var label;'));
  assert.ok(pager, 'no pager is rendered at all');
  assert.ok(
    /total \+ \(total === 1 \? ' quote' : ' quotes'\)/.test(pager),
    'a measured total must be shown as a count',
  );
  /* The property is "it always renders something", not "no if statement
     appears nearby". The previous version matched any `if (pages > 1)`
     anywhere before the markup, so decorating the LABEL with a page number
     tripped it - a test failing on correct code, which is how tests get
     deleted rather than fixed. */
  assert.match(render, /html \+= '<div class="q-pager">'/, 'the pager must always be emitted');
  assert.match(render, /label = /, 'and it must always have something to say');
  assert.ok(
    render.includes('} else {'),
    'both the measured and unmeasured paths must set a label',
  );
});

/*
 * The pager may only state what was measured.
 *
 * A text search deliberately skips countDocuments - running an unanchored
 * regex across every row twice per keystroke is what makes a list feel slow.
 * So on that path there is no total and no page count, and inventing one would
 * be a pager that lies. It shows the range on screen and a working Next
 * instead, because "is there more" is the only question the total answered.
 */
test('with no measured total the pager shows a range, not a made-up count', () => {
  const render = blockAt(quotesNamespace, 'renderList: function () {');
  assert.match(render, /typeof meta\.total === 'number'/, 'a missing total must be detected');
  assert.match(render, /'Showing '/, 'it should fall back to the range on screen');
  assert.ok(
    !/total \|\| rows\.length/.test(render),
    'defaulting the total to the page size invents a number that is simply wrong',
  );
});

test('Next is driven by hasMore, so it works without a page count', () => {
  const render = blockAt(quotesNamespace, 'renderList: function () {');
  assert.match(render, /meta\.hasMore/, 'the server says whether another page exists');
  assert.match(
    render,
    /arrow\(cur \+ 1, '&raquo;', !hasMore\)/,
    'Next must be enabled by hasMore rather than by comparing against pages',
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
    for (const tooDark of ['#1f2328', '#57606a', '#8c959f', '#afb8c1']) {
      assert.ok(
        !new RegExp(tooDark, 'i').test(line),
        `${tooDark} overshot - the selection needs to be more than its neighbours, not dark`,
      );
    }
    assert.match(line, /#c9d1d9/i, 'a hair above the ordinary border, nothing more');
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
 * The filter bar is shared (core/list-filter.js).
 *
 * It is going on every list - quotes, items, sales, purchases - so it is built
 * once and configured per screen. Quotes supplies its fields and what to do on
 * change; it owns none of the mechanics. These tests check that boundary
 * holds, because the moment a screen reaches past it the next screen copies
 * the reach.
 */
const listFilterSrc = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'list-filter.js'),
  'utf8',
);

test('the shared bar knows nothing about quotes', () => {
  for (const leak of ['quote', 'sales_new', 'item_tab']) {
    assert.ok(
      !new RegExp(leak, 'i').test(listFilterSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
      `the shared component mentions "${leak}" outside a comment - that is a screen leaking in`,
    );
  }
});

test('it is loaded by the build, after PosnicPro and before the modules', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'frontend', 'pages_css_js_map.json'), 'utf8'),
  );
  const js = manifest.dashboard.js;
  const core = js.findIndex((p) => p.endsWith('core/PosnicPro.js'));
  const lf = js.findIndex((p) => p.endsWith('core/list-filter.js'));
  const sales = js.findIndex((p) => p.endsWith('modules/js/sales.js'));
  assert.ok(lf > core, 'it extends PosnicPro, so it must load after it');
  assert.ok(lf < sales, 'and before the module that mounts it');
});

test('the whole bar lives on the header line, between title and buttons', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'quotes.html'), 'utf8');
  const header = html.slice(html.indexOf('<div class="breadcrumbbar">'), html.indexOf('<div class="contentbar">'));

  assert.ok(header.includes('quotes_filter_btn'), 'the Filter button belongs in the header');
  assert.ok(header.includes('quotes_filter_panel'), 'and so does the panel it opens');
  assert.ok(header.indexOf('quotes_filter_btn') < header.indexOf('quotes/new'), 'Filter before New');

  // title, then the panel, then the buttons - in that order on one line
  assert.ok(
    header.indexOf('lang_quotes_title') < header.indexOf('quotes_filter_panel'),
    'the panel goes after the title',
  );
  assert.ok(
    header.indexOf('quotes_filter_panel') < header.indexOf('quotes_filter_btn'),
    'and before the buttons',
  );

  const panel = html.slice(html.indexOf('id="quotes_filter_panel"'));
  assert.match(panel.slice(0, 120), /display:\s*none/, 'a list is for reading - it opens on request');
});

test('the bar renders as ONE row, not stacked rows', () => {
  /* Stacked rows in a page header push it open and misalign against the title
     on one side and the buttons on the other - which is exactly how it looked. */
  const rows = (listFilterSrc.match(/<div class="lf-row">/g) || []).length;
  assert.strictEqual(rows, 1, `the bar emits ${rows} rows; it must be a single strip`);
});

test('suggestions are not gated on which field is selected', () => {
  /* Gating on field === customer was wrong twice: searching "All fields" for a
     customer is exactly when the suggestion helps, and with All selected - the
     default - typing hid the list that had just appeared on focus. */
  assert.ok(
    !/cfg\.typeahead !== 'customer'/.test(listFilterSrc),
    'the per-field gate is what stopped typing from working',
  );
  assert.ok(
    !/state\.field !== '[a-z_]+'/.test(listFilterSrc),
    'a per-field gate is back - typing with "All fields" would hide the list again',
  );
  assert.match(
    listFilterSrc,
    /var entity = m\.cfg\.typeahead;\s+var e = entity && LF\.ENTITIES\[entity\];/,
    'the gate must be the panel-level entity, not the selected field',
  );
  assert.match(listFilterSrc, /typeaheadField/, 'and picking a name narrows the field for you');
});

test('quotes takes its filter params from the shared bar, not its own inputs', () => {
  const load = blockAt(quotesNamespace, 'load: function (keepPage) {');
  assert.match(load, /PosnicPro\.listFilter\.params\('quotes'\)/, 'it must ask the shared bar');
  for (const gone of ['#quotes_search_field', '#quotes_from', '#quotes_to']) {
    assert.ok(!load.includes(gone), `${gone} is a control quotes no longer owns`);
  }
});

test('the date presets are the ones people actually pick', () => {
  for (const p of ['today', 'yesterday', 'week', 'month', 'year', 'last7', 'last30', 'custom']) {
    assert.ok(new RegExp(`key: '${p}'`).test(listFilterSrc), `${p} preset missing`);
  }
});

test('presets carry a time, not a bare date', () => {
  /* "Today" on a till means since midnight in the shop's own timezone. Sending
     a bare date makes the server guess, and the guess is wrong for any shop
     that trades past midnight. */
  assert.match(listFilterSrc, /setHours\(0, 0, 0, 0\)/, 'the range must start at midnight');
  assert.match(listFilterSrc, /setHours\(23, 59, 59, 999\)/, 'and end at the end of the day');
  assert.match(listFilterSrc, /toISOString\(\)/, 'and travel as an instant');
});

test('the typeahead uses the cached recents, not a query per keystroke', () => {
  assert.match(listFilterSrc, /_recentGet\(key\)/, 'recents come from local storage');
  assert.match(listFilterSrc, /recents\('recent_customers'\)/, 'customers read the recents the sale screen keeps');
  assert.match(listFilterSrc, /_customerSeed/, 'and the session seed already fetched for the sale screen');
  /* The whole point: no network call anywhere in the suggestion path. */
  const suggest = blockAt(listFilterSrc, 'LF.suggest = function (entity, term) {');
  assert.ok(!/ajax|\$\.get|\$\.post/.test(suggest), 'a query per keystroke is exactly what this replaced');
});

test('the Filter button shows how many filters are on', () => {
  /* A closed panel is otherwise where filters hide: someone narrows to one
     customer, forgets, and reports the list as broken. */
  assert.match(listFilterSrc, /lf-count/, 'the button needs a count badge');
  assert.match(listFilterSrc, /activeCount/, 'and something to count');
});

/*
 * Search-as-you-type, without a query per letter.
 *
 * Worth being precise about the cost, because the same bar is going on sales
 * and items where the row counts are real. On a till the database is local;
 * pos.sbala.in is a network hop AND one process serving many shops, so an
 * expensive scan there competes with somebody else's request.
 */
test('typing is debounced, so a word is one request and not four', () => {
  assert.match(listFilterSrc, /LF\.DEBOUNCE_MS\s*=\s*\d+/, 'the delay must be named, not buried');
  assert.match(listFilterSrc, /setTimeout\(function \(\) \{ LF\._changed\(key\); \}, LF\.DEBOUNCE_MS\)/);
  assert.match(listFilterSrc, /clearTimeout/, 'each keystroke must cancel the pending one');
});

test('one character never reaches the server', () => {
  /* It matches almost every row: the most expensive query anyone can run and
     the least useful answer. Below the minimum the list keeps what it has. */
  assert.match(listFilterSrc, /LF\.MIN_SEARCH\s*=\s*[2-9]/, 'a minimum length must exist');
  assert.match(listFilterSrc, /if \(!LF\.shouldQuery\(term\)\)/, 'and be enforced before the timer');
});

test('but CLEARING the box always reloads', () => {
  /* Emptying the search is how you get the whole list back - blocking it on
     the same minimum would strand you in a filtered list with no way out. */
  assert.match(
    listFilterSrc,
    /t\.length === 0 \|\| t\.length >= LF\.MIN_SEARCH/,
    'an empty term must be allowed through',
  );
});

test('the typeahead is exempt - it reads cache, not the database', () => {
  const handler = listFilterSrc.slice(listFilterSrc.indexOf("on('input', '.lf-q'"));
  const body = handler.slice(0, handler.indexOf('});'));
  assert.ok(
    body.indexOf('LF.typeahead(key, this.value)') < body.indexOf('shouldQuery'),
    'suggestions must update on every keystroke, before the minimum-length gate',
  );
});

test('the module still drops out-of-order responses', () => {
  /* Debouncing reduces requests; it does not order them. Without this a slow
     response for "ac" can land after the one for "acme" and repaint the list
     with the wrong rows. */
  const load = blockAt(quotesNamespace, 'load: function (keepPage) {');
  assert.match(load, /var mine = \+\+PosnicPro\.quotes\._seq/, 'each request takes a sequence number');
  assert.match(load, /if \(mine !== PosnicPro\.quotes\._seq\) \{ return; \}/, 'and a stale one returns early');
});

/*
 * "Not provided can not preset as address."
 *
 * A branch record held the literal string "Not provided" where its address
 * should be, and the quotation printed it - to the customer. That is worse
 * than a blank line: a blank line reads as "not applicable", a placeholder
 * reads as "we did not finish filling this in".
 *
 * The fix lives at the document boundary, not in settings. Settings must keep
 * showing the real stored value or nobody can ever correct it.
 */
test('a placeholder never reaches a customer-facing document', () => {
  const real = blockAt(quotesNamespace, '_real: function (v) {');
  for (const p of ['not provided', 'n/a', 'nil', 'none', 'null', 'undefined']) {
    assert.ok(
      real.includes(`'${p}'`),
      `"${p}" is not treated as a placeholder - it would print on the quote`,
    );
  }
  assert.match(real, /\.trim\(\)/, 'a padded placeholder is still a placeholder');
  assert.match(real, /toLowerCase\(\)/, '"Not Provided" must be caught too');
});

test('the on-screen quote omits the line rather than printing a placeholder', () => {
  /* q-shop appears twice - the authoring preview and the finished document -
     and BOTH printed the placeholder. Check each. */
  const blocks = quotesNamespace
    .split("'<div class=\"q-shop\">")
    .slice(1)
    .map((b) => b.slice(0, b.indexOf('})()') + 4));
  assert.strictEqual(blocks.length, 2, 'a third seller block appeared - it needs the same filter');
  const block = blocks.join('\n');
  assert.ok(
    !/branchaddress'\) \|\| ''/.test(block),
    'the address still falls back to the raw stored value - a placeholder prints',
  );
  assert.match(block, /var real = PosnicPro\.quotes\._real/, 'the header filters through _real');
  assert.match(block, /if \(addr\) \{/, 'no address means no address line at all');
  assert.match(block, /if \(ph \|\| em\)/, 'no phone and no email means no contact line');
});

test('the PDF filters the same way, and leaves no gap behind', () => {
  const s = blockAt(quotesNamespace, '_seller: function () {');
  for (const f of ['address', 'phone', 'email', 'gstin']) {
    assert.ok(
      s.includes(`${f}: real(PosnicPro.local.get`),
      `_seller.${f} is unfiltered - the PDF would print a placeholder`,
    );
  }
  /* splitTextToSize('') is [''], which prints nothing and still costs 4.3mm. */
  assert.match(
    salesSource,
    /splitTextToSize\(txt\(seller\.address\), 104\)\.filter\(Boolean\)/,
    'an empty address still reserves a line of header space',
  );
});

/*
 * "Filter button acts as toggle so, when filter is showing have little design
 *  different expressing its kind of toggle button."
 *
 * The panel opens somewhere else in the header, so the button is the only
 * thing under the cursor that can report the state it just changed.
 */
test('the Filter button looks pressed while its panel is open', () => {
  const toggle = blockAt(listFilterSrc, 'LF.toggle = function (key) {');
  assert.match(toggle, /var opening = !\$panel\.is\(':visible'\)/, 'the state is read before the animation, not after');
  assert.match(toggle, /toggleClass\('lf-btn-open', opening\)/, 'the pressed class is never wired');
  assert.match(toggle, /attr\('aria-expanded'/, 'a screen reader is told nothing');

  const open = cssRule('.lf-btn-open');
  assert.ok(open, '.lf-btn-open has no styling, so the class changes nothing');
  assert.match(open, /!important/, 'the theme sets button backgrounds with !important - this loses silently');
});

test('paint does not fight the toggle over the button class', () => {
  const paint = blockAt(listFilterSrc, 'LF.paintButton = function (key) {');
  assert.ok(
    !/lf-btn-open/.test(paint),
    'paintButton touches lf-btn-open - a filter change would close-look the open panel',
  );
});

/*
 * "filter stuff see conjuste when quote list page."
 *
 * .contentbar is globally padding-top:0. That read fine when the page header
 * was only a title; with the filter strip up there, the list card butts
 * straight into it.
 */
test('the quotes list gets air between the header and the card', () => {
  /* .quotes-split selectors all begin with this, so anchor past them. */
  const bar = cssRule('#quotes_new .contentbar', 'ends up butted right against it');
  assert.ok(bar, '#quotes_new .contentbar has no rule, so the global 0 still wins');
  assert.match(bar, /padding-top:\s*5px\s*!important/, 'the global .contentbar padding-top:0 is !important');
});

/*
 * Every entity the picker offers must have something behind it.
 *
 * LF.ENTITIES declares customer, item and supplier. A declared entity whose
 * source is never written opens an empty popover on every till and reads as a
 * broken feature - the same failure as a settings switch nothing consults, and
 * one of those shipped and had to be removed this week. So the check is
 * mechanical: every recents key the picker READS must be a key something
 * WRITES.
 */
test('every recents list the picker reads is one something writes', () => {
  const salesJs = salesSource;
  const receivingJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'receiving_add.js'),
    'utf8',
  );
  const written = new Set(
    [...salesJs.matchAll(/_recentPush\('([a-z_]+)'/g), ...receivingJs.matchAll(/_recentPush\('([a-z_]+)'/g)].map(
      (m) => m[1],
    ),
  );
  const read = [...listFilterSrc.matchAll(/recents\('([a-z_]+)'\)/g)].map((m) => m[1]);

  assert.ok(read.length >= 3, 'the picker should read a list per entity');
  for (const key of read) {
    assert.ok(
      written.has(key),
      `the picker reads ${key} but nothing writes it - that entity opens empty`,
    );
  }
});

test('a recent row only shows fields the writer actually stores', () => {
  /* recent_items carries {id, name, price, image}. Reading sku or barcode off
     it renders a blank note on every row. */
  const entities = blockAt(listFilterSrc, 'LF.ENTITIES = {');
  assert.ok(!/i\.sku/.test(entities), 'recent items have no sku - that note is always blank');
  assert.match(entities, /note: i\.price/, 'price is what a recent item actually carries');
});

/*
 * The status chips are a filter, so the bar has to know about them.
 *
 * They sit outside the panel and used to be a variable of their own. That gave
 * a Filter button reading "0 filters" while the list was filtered to Accepted -
 * exactly the forgotten filter the count exists to catch - and a Clear that
 * emptied the panel while the chip kept filtering.
 */
test('a status chip counts as a filter', () => {
  const setExtra = blockAt(listFilterSrc, 'LF.setExtra = function (key, name, value) {');
  assert.match(setExtra, /m\.state\.extra\[name\] = value/, 'the value must land in the counted state');
  assert.match(setExtra, /delete m\.state\.extra\[name\]/, 'clearing a chip must remove it, not store ""');
  assert.match(setExtra, /LF\._changed\(key\)/, 'the button must repaint and the list reload');
  assert.match(setExtra, /if \(!m\) return false/, 'the bar mounts lazily - setting before that must not throw');

  /* The iteration itself, not just a mention of st.extra: replacing the source
     list with [] leaves `st.extra[k]` in the loop body, so a looser assertion
     passes over a count that has stopped counting. */
  const count = blockAt(listFilterSrc, 'activeCount: function (key) {');
  assert.match(
    count,
    /\(st\.extra \? Object\.keys\(st\.extra\) : \[\]\)\.forEach/,
    'extras must be iterated or the chip is invisible to the button',
  );
});

test('quotes stops carrying status itself', () => {
  const load = blockAt(quotesNamespace, 'load: function (keepPage) {');
  assert.ok(
    !/params\.status = PosnicPro\.quotes\._status/.test(load),
    'two sources for one filter - Clear would empty the bar and leave the list filtered',
  );
  assert.match(load, /PosnicPro\.listFilter\.params\('quotes'\)/, 'the bar must be the only source');
});

test('the chips paint from the bar, not from the click', () => {
  /* Painting on click means Clear leaves a lit chip over an unfiltered list. */
  const handler = salesSource.slice(salesSource.indexOf("$(document).on('click', '.quotes-chip'"));
  const body = handler.slice(0, handler.indexOf('});') + 3);
  assert.match(body, /setExtra\('quotes', 'status'/, 'the chip must go through the bar');
  assert.ok(!/addClass\('btn-primary-rgba'\)/.test(body), 'the handler must not paint directly');
  assert.match(salesSource, /_paintChips = function \(status\)/, 'there must be one painter');

  const mount = salesSource.slice(salesSource.indexOf('PosnicPro.quotes.mountFilters = function'));
  assert.match(
    mount.slice(0, mount.indexOf('};')),
    /_paintChips\(\(state\.extra && state\.extra\.status\) \|\| ''\)/,
    'onChange must repaint the chips from the bar state',
  );
});

test('"no results" no longer reads a control that was deleted', () => {
  /* #quotes_search stopped existing when the shared bar took over. Reading it
     returned '' forever, so anyone whose SEARCH found nothing was told they had
     never written a quote. */
  /* stripComments: the comment above the fix NAMES the removed control, which
     is the point of the comment - the assertion is about code. */
  const render = stripComments(blockAt(quotesNamespace, 'renderList: function () {'));
  assert.ok(!/#quotes_search/.test(render), 'it still reads the removed input');
  assert.match(
    render,
    /PosnicPro\.listFilter\.activeCount\('quotes'\) > 0/,
    'whether a filter is on is a question only the bar can answer now',
  );
});

test('no handler is left bound to the removed search input', () => {
  assert.ok(
    !/on\('input', '#quotes_search'/.test(salesSource),
    'a handler bound to an element that no longer exists never fires and reads as working code',
  );
});

/*
 * "Filters not aligned well. Can we make in same line of filter row itself."
 *
 * The bar sits in the page header between the title and the buttons, so a
 * second row does not just look untidy - it pushes the header open and
 * misaligns the strip against both. One line is the requirement, not a
 * preference, and these pin the two ways it can break.
 */
test('the strip is one line, whatever is selected', () => {
  const row = cssRule('.lf-row');
  assert.match(row, /flex-wrap:\s*nowrap/, 'wrap puts a second row inside the page header');
  assert.match(row, /min-width:\s*0/, 'without this a flex child refuses to shrink and overflows');
});

test('running out of room shrinks the search box rather than breaking the line', () => {
  /* A fixed min-width on the widest control is what forces the wrap. Shrinking
     the search is the least harmful way to run out of room - every other
     control has a fixed label to show. */
  const search = cssRule('.lf-search', 'flex-wrap: nowrap');
  assert.match(search, /min-width:\s*0/, 'a floor on the search box forces the wrap it is meant to avoid');
});

test('the custom range opens under the preset instead of sitting on the line', () => {
  /* Two datetime-local inputs are ~185px each in Chrome; with "to" between
     them that is nearly 400px added to a strip sharing a header row. */
  const custom = cssRule('.lf-custom', 'that is nearly 400px on a strip');
  assert.match(custom, /position:\s*absolute/, 'inline, this is what breaks the single line');
  assert.match(custom, /z-index/, 'a panel with no stacking order renders behind the list');
  assert.match(custom, /background:\s*#fff\s*!important/, 'the theme paints card backgrounds !important');

  const wrap = cssRule('.lf-preset-wrap');
  assert.match(wrap, /position:\s*relative/, 'without this the panel positions against the page, not the control');
  assert.match(
    listFilterSrc,
    /<div class="lf-preset-wrap">/,
    'the markup must nest the editor with the control that opens it',
  );
});

test('the range popover survives the dark theme', () => {
  /* Its light rule carries !important to beat the theme's card background, so
     the dark rule must too - otherwise the popover is a white card on a dark
     page, which is how the typeahead nearly shipped. */
  /* cssRule returns the BODY, so the selector is checked against the file and
     the declaration against the rule it belongs to. */
  assert.match(
    css,
    /\[data-theme\] \.lf-custom \{/,
    'the range popover is not themed at all - it would be a white card on a dark page',
  );
  const dark = cssRule('[data-theme] .lf-typeahead,', 'lf-count');
  assert.match(dark, /background: var\(--theme-card-bg\) !important/, 'a plain rule loses to its own light rule');
  assert.match(dark, /border-color: var\(--theme-border-color\) !important/, 'the border needs it for the same reason');
});

/*
 * Selectors pointing at elements that do not exist.
 *
 * #quotes_search (fixed above) was one. A sweep with tests/tools/dead-selectors.js
 * found two more that could be verified by hand, both leftovers from a UI that
 * changed underneath them:
 *
 *   #branch_view       - the branch details view became an infobar sidebar, so
 *                        `.modal('show')` on the old id did nothing at all.
 *   #quote_settings_modal - quotation settings moved into the feature-config
 *                        popup, so `.modal('hide')` after saving closed nothing.
 *
 * Neither threw, neither logged. That is what makes this class worth a test:
 * the code reads as working.
 */
test('no selector targets an element that was removed', () => {
  const branchesJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'branches.js'),
    'utf8',
  );
  const settingsJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
    'utf8',
  );
  const html = ['modals/branch.html', 'modules/settings_write.html', 'modules/quotes.html']
    .map((f) => fs.readFileSync(path.join(ROOT, 'frontend', ...f.split('/')), 'utf8'))
    .join('\n');

  for (const [id, src, where] of [
    ['branch_view', branchesJs, 'branches.js'],
    ['quote_settings_modal', settingsJs, 'settings.js'],
    ['quotes_search', salesSource, 'sales.js'],
  ]) {
    /* includes, not RegExp: the escaping needed to express `$('#id')` as a
       pattern is exactly the kind that survives being written wrong. The first
       version of this line lost a backslash level, so the pattern compiled to
       an end-anchor followed by a group, matched nothing, and passed over both
       live bugs. A plain substring cannot be wrong in that direction. */
    const used = stripComments(src).includes(`$('#${id}')`);
    const exists = html.includes(`id="${id}"`);
    assert.ok(
      !used || exists,
      `${where} selects #${id}, and no markup defines it - the call does nothing and looks like it works`,
    );
  }
});

test('the dead-selector sweep is a tool, and it runs', () => {
  /* It cannot be a pass/fail gate: ids built by concatenation never appear as a
     literal, so it reports them as missing. A guard with a hundred standing
     exceptions is one people learn to scroll past. */
  const tool = path.join(ROOT, 'tests', 'tools', 'dead-selectors.js');
  assert.ok(fs.existsSync(tool), 'the sweep tool is referenced but missing');
  const src = fs.readFileSync(tool, 'utf8');
  assert.match(src, /public/, 'built bundles must be skipped - they are the same source concatenated');
  assert.match(src, /Verify each before deleting/, 'the output must say the list needs checking');
});

/*
 * Escape closes the picker.
 *
 * Every other overlay in this app closes on Escape - the modals carry a
 * close_on_esc class for it - so a popover that ignores it is the odd one out,
 * and pressing Escape is the reflex before reaching for a mouse.
 */
test('Escape dismisses the suggestion list', () => {
  const src = stripComments(listFilterSrc);
  assert.match(src, /on\('keydown', function \(e\)/, 'nothing listens for Escape at the document level');
  assert.match(src, /e\.key !== 'Escape' && e\.keyCode !== 27/, 'older browsers report keyCode, not key');
  assert.match(src, /\$\('\.lf-typeahead:visible'\)/, 'it must act only when one is actually open');
});

test('Escape does not close everything behind the picker too', () => {
  /* Without stopPropagation the same keypress carries on, and dismissing a
     suggestion list would also close the panel or modal around it. */
  const src = stripComments(listFilterSrc);
  const block = src.slice(src.indexOf("on('keydown', function (e)"));
  const body = block.slice(0, block.indexOf('});') + 3);
  assert.match(body, /if \(!\$open\.length\) return;[\s\S]*stopPropagation/, 'it must bail BEFORE stopping propagation');
});

test('Escape does not reopen the list it just closed', () => {
  /* .lf-q has a delegated focus handler that OPENS the picker. Re-focusing the
     input after closing fires it again, so Escape would toggle rather than
     dismiss - and the input already has focus, since that is how Escape was
     pressed. */
  const src = stripComments(listFilterSrc);
  const block = src.slice(src.indexOf("on('keydown', function (e)"));
  const body = block.slice(0, block.indexOf('});') + 3);
  assert.ok(
    !/trigger\('focus'\)/.test(body),
    'refocusing the search box re-fires the focus handler that opens the picker',
  );
});

/*
 * Arrow keys in the picker.
 *
 * "I want similar as in sales new" - and the sale screen runs on the
 * autocomplete plugin, which moves through its list on the arrow keys. A till
 * is operated from the keyboard; a hand-rolled popover that only takes clicks
 * is a downgrade wearing the same design.
 */
test('the picker moves on the arrow keys', () => {
  const src = stripComments(listFilterSrc);
  assert.match(src, /on\('keydown', '\.lf-q'/, 'the search box takes no keys');
  assert.match(src, /e\.key === 'ArrowDown' \|\| e\.keyCode === 40/, 'keyCode is needed for older tills');
  assert.match(src, /e\.key === 'ArrowUp' \|\| e\.keyCode === 38/, 'up must work as well as down');
  assert.match(src, /scrollIntoView/, 'a highlight that scrolls out of view is worse than none');
});

test('the arrows do not move the caret as well', () => {
  /* Without preventDefault the caret jumps to either end of the input while the
     highlight moves, which reads as the typed text being eaten. */
  const src = stripComments(listFilterSrc);
  const block = src.slice(src.indexOf("on('keydown', '.lf-q'"));
  const body = block.slice(0, block.indexOf('\n    });') + 8);
  /* The ARROW branch specifically. There is a second preventDefault in the
     Enter branch, so a bare /preventDefault/ passes with the arrow one removed -
     which is the mutation this test exists to catch. */
  assert.match(
    body,
    /e\.preventDefault\(\);\s*var next = down/,
    'the caret would jump to either end while the highlight moves',
  );
});

test('Enter with nothing highlighted runs the search instead of guessing', () => {
  /* The empty state promises "press Enter to search anyway", and someone typing
     a partial name usually means it. Auto-picking the first row would put a
     customer on the filter that nobody chose. */
  const src = stripComments(listFilterSrc);
  const block = src.slice(src.indexOf("on('keydown', '.lf-q'"));
  const body = block.slice(0, block.indexOf('\n    });') + 8);
  assert.match(body, /if \(i < 0\) return;/, 'Enter must fall through when no row is chosen');
});

test('mouse and keyboard share one highlight', () => {
  /* Two treatments would light two rows at once the moment a hand touches the
     mouse mid-arrow-key, and Enter takes the one the cursor is NOT on. */
  assert.match(
    listFilterSrc,
    /on\('mouseenter', '\.lf-pick-row'/,
    'hovering must move the keyboard highlight, not add a second one',
  );
  const hover = cssRule('.lf-pick-row:hover,', 'lf-pick-row {');
  assert.ok(hover, 'the hover rule is not grouped with the active one');
  assert.match(listFilterSrc, /addClass\('is-active'\)/, 'nothing ever marks a row active');
  assert.match(css, /\.lf-pick-row\.is-active/, 'the keyboard highlight has no styling at all');
  assert.match(css, /\[data-theme\] \.lf-pick-row\.is-active/, 'and none on a dark theme');
});

/*
 * What is TYPED and what is APPLIED are different things.
 *
 * A term below MIN_SEARCH is deliberately never sent - one character matches
 * nearly every row, the most expensive query for the least useful answer. But
 * the character is in the input, and state.search follows the input so the box
 * renders what was typed. Two live bugs came from not separating them.
 */
test('one typed character does not count as an active filter', () => {
  /* The Filter button would say "1 filter" over a list nothing had filtered. */
  const applied = blockAt(listFilterSrc, '_applied: function (st) {');
  assert.match(applied, /MIN_SEARCH \|\| 2/, 'an unset minimum would silently disable search entirely');
  const count = blockAt(listFilterSrc, 'activeCount: function (key) {');
  assert.match(
    count,
    /if \(PosnicPro\.listFilter\._applied\(st\)\) n\+\+/,
    'counting st.search directly counts a filter that was never applied',
  );
});

test('another trigger cannot smuggle a sub-minimum term into the request', () => {
  /* Type one letter, then click a status chip: the reload carried "A" along and
     applied the search the debounce had just refused to run. */
  const params = blockAt(listFilterSrc, 'params: function (key) {');
  assert.match(params, /var term = PosnicPro\.listFilter\._applied\(st\)/, 'params must ask what is applied');
  assert.ok(!/out\.search = st\.search/.test(params), 'sending the raw typed value is the bug');
});

test('an exact match is applied whatever its length', () => {
  /* The minimum exists because a one-letter FRAGMENT scans every row; an
     anchored exact match is index-served at any length. Picking a name from the
     list sets exact, so a customer called "K" must still filter - otherwise a
     deliberate pick silently does nothing. */
  const applied = blockAt(listFilterSrc, '_applied: function (st) {');
  assert.match(applied, /if \(st\.exact\) return t;/, 'a picked short name would be dropped');
  assert.ok(
    applied.indexOf('if (st.exact) return t;') < applied.indexOf('MIN_SEARCH'),
    'the exact bypass must come before the length test, or it never runs',
  );
});

test('changing the search field with no term does not reload the list', () => {
  /* Field and Exact MODIFY a search rather than being one. With no term in
     force params() omits them, so the request would be byte-identical to the
     one already on screen - a round trip per dropdown change for a list that
     cannot move. */
  const src = stripComments(listFilterSrc);
  const at = src.indexOf("on('change', '.lf-field,.lf-exact-cb'");
  assert.notStrictEqual(at, -1, 'the field handler is gone');
  const body = src.slice(at, src.indexOf('\n    });', at));
  assert.match(body, /if \(!LF\._applied\(st\)\) \{/, 'it reloads even when nothing is in force');
  assert.match(body, /LF\.paintButton\(key\);/, 'the button must still repaint');
});

test('the skip is decided AFTER the state is updated', () => {
  /* Ticking Exact can bring a below-minimum term INTO force, so the very
     action that makes a reload necessary is one of the two this guard would
     otherwise skip. */
  const src = stripComments(listFilterSrc);
  const at = src.indexOf("on('change', '.lf-field,.lf-exact-cb'");
  const body = src.slice(at, src.indexOf('\n    });', at));
  assert.ok(
    body.indexOf('st.exact =') < body.indexOf('_applied(st)'),
    'checking before the update reads the previous value of exact',
  );
});
