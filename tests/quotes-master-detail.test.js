const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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

/* The balanced { ... } that opens at or after `marker`, marker included. */
function blockAt(source, marker) {
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `not found in source: ${marker}`);
  const open = source.indexOf('{', start);
  assert.notStrictEqual(open, -1, `no block opens after: ${marker}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        assert.ok(i > start, 'block ends before it begins');
        return source.slice(start, i + 1);
      }
    }
  }
  assert.fail(`unbalanced block after: ${marker}`);
}

/* sales.js defines showDetails twice - sales history has one too - so every
   lookup starts from the quotes namespace rather than the top of the file.
   An unanchored marker here would silently test the wrong module. */
const quotesNamespace = blockAt(salesSource, 'PosnicPro.quotes = {');

/* The declarations of the first CSS rule whose selector text contains `sel`. */
function cssRule(sel, fromMarker) {
  /* Several selectors appear first inside a GROUPED rule (".. > #list_card,
     .. > #view_card {"), so a bare indexOf would return that rule's
     declarations instead of the one being asked about. fromMarker moves the
     search past it - the same anchoring hazard as the JS lookups above. */
  const from = fromMarker ? css.indexOf(fromMarker) : 0;
  assert.notStrictEqual(from, -1, `anchor not found in css: ${fromMarker}`);
  const at = css.indexOf(sel, from);
  assert.notStrictEqual(at, -1, `no CSS rule mentions: ${sel}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.ok(close > open, `unbalanced CSS rule for: ${sel}`);
  return css.slice(open + 1, close);
}

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

  const rail = cssRule('#quotes_new .contentbar.quotes-split > #quotes_list_card {');
  assert.match(rail, /border-right:\s*1px/, 'the rail carries the only line between the panes');
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
  const active = cssRule('.quotes-split #quotes_list_rows tr.quotes-row.is-active {');
  // the pane's ground, so the two read as one surface
  assert.match(active, /background:\s*#fff/i, 'the active row must share the pane background');

  const connector = cssRule(
    '.quotes-split #quotes_list_rows tr.quotes-row.is-active td:last-child::after {',
  );
  assert.match(connector, /right:\s*-1px/, 'the connector must sit ON the divider');
  assert.match(connector, /background:\s*#fff/i, 'it paints the divider out with the pane ground');

  // and the list itself is recessed, or there is nothing for white to stand against
  const rail = cssRule('#quotes_new .contentbar.quotes-split > #quotes_list_card { background');
  assert.match(rail, /#f6f8fa/i, 'the list needs a recessed ground');
});

test('the rail has no side padding, or the selection cannot reach the divider', () => {
  const body = cssRule('#quotes_new .contentbar.quotes-split > #quotes_list_card > .card-body {');
  assert.match(body, /padding:\s*0\s*;/, 'full-bleed rows are what make the join possible');
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
