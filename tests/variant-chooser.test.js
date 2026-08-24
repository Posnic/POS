/*
 * Choosing a size on the sale screen.
 *
 * Owner: "when sales item choose variant choose it opens in center of the page,
 * move movement is bit taking time, better show near to item or attached to
 * item on hover might better. we can reduce the click. make sure we handled for
 * touch screen users too."
 *
 * WHY THIS FILE IS MOSTLY ABOUT TOUCH
 *
 * The visible half of this change - a panel beside the tile instead of one in
 * the middle of the screen - is the half that cannot break quietly. Somebody
 * would see it.
 *
 * The half that CAN break quietly is the pointer handling. A touch screen has
 * no hover, so browsers fake one: a single tap emits pointerover, mouseover and
 * click at the same coordinates. Bind hover-to-open and click-to-add naively
 * and a tap opens the list under the finger and then lets the synthesised click
 * choose a row - adding a size nobody picked. On a developer's mouse-driven
 * machine that is invisible; at a counter it is a wrong item on a customer's
 * bill, and the cashier gets the blame.
 *
 * So the assertions below are about pointerType, the touch guard, and the
 * timers - each one mutation-verified.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rawJs = fs.readFileSync(
  path.join(ROOT, 'frontend/static/script/js/modules/js/sales.js'), 'utf8');
const rawCss = fs.readFileSync(
  path.join(ROOT, 'frontend/static/style/css/custom.css'), 'utf8');

/* Prose naming a guard reads exactly like the guard, and this repo has shipped
   two tests that passed against their own explanatory comment. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const js = strip(rawJs);
const css = strip(rawCss);

/* Name-bounded, never brace-matched: this object holds arrow defaults and
   destructured parameters, and counting braces through them returns a few
   characters rather than the block. */
function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a > -1, `${from} not found`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `${to} not found after ${from}`);
  return source.slice(a, b);
}

const pop = between(js, 'variantPop: {', 'openVariantPicker: function');
const cssBlock = (() => {
  const at = rawCss.indexOf('.variant-pop {');
  assert.notStrictEqual(at, -1, 'the variant panel has no styles');
  const next = rawCss.indexOf('/* ====', at);
  return strip(rawCss.slice(at, next === -1 ? rawCss.length : next));
})();

test('the panel is anchored to the tile, not to the middle of the screen', () => {
  /* The whole complaint: "it opens in center of the page, move movement is bit
     taking time". A modal is a backdrop, a fade and a panel 400px from the
     thing that was tapped. */
  assert.ok(!js.includes('variant_picker_modal'),
    'the centre-page modal is still being built');
  assert.match(pop, /getBoundingClientRect\(\)/);
  assert.match(cssBlock, /position: fixed/);
});

test('the panel is placed in viewport coordinates, so the grid cannot clip it', () => {
  /*
   * position:absolute inside the grid is clipped by the same overflow rule
   * that makes the grid scroll, so the bottom row of tiles would open a list
   * nobody can see - and it looks correct everywhere else.
   */
  assert.match(cssBlock, /position: fixed/);
  assert.ok(!/position:\s*absolute/.test(cssBlock),
    'an absolutely-positioned panel is clipped by the grid');
});

test('hover opens for a mouse and never for a finger', () => {
  /*
   * pointerType is the entire difference between a mouse saying "show me this"
   * and a touch screen synthesising a hover it does not have. mouseenter does
   * not carry it, which is why this listens for pointerover.
   */
  assert.match(pop, /addEventListener\('pointerover'/);
  assert.match(pop, /if \(e\.pointerType !== 'mouse'\) \{ return; \}/);
});

test('a tap cannot let its own synthesised click choose a row', () => {
  /*
   * The failure: tap the tile, the panel opens under the finger, and the click
   * that follows the same tap lands on whichever row is there. A random size
   * is added to a real sale and nothing looks wrong.
   */
  assert.match(pop, /TOUCH_GUARD/);
  assert.match(pop, /_byTouch && Date\.now\(\) - \w+\._openedAt < \w+\.TOUCH_GUARD/);
  assert.match(pop, /return;/);
});

test('a mouse is never made to wait for the touch guard', () => {
  /* The guard is conditioned on _byTouch. Applied unconditionally it would
     swallow the fast click of somebody who hovered and chose in one motion -
     which is the interaction this whole change exists to enable. */
  const guard = between(pop, 'TOUCH_GUARD', 'pickVariant');
  assert.match(guard, /_byTouch &&/);
});

test('the panel survives the trip from tile to panel', () => {
  /*
   * Without a close delay the panel shuts in the few pixels of gap between the
   * tile and itself, and the list can never be reached with a mouse at all.
   */
  assert.match(pop, /CLOSE_DELAY: \d+/);
  assert.match(pop, /_closeTimer = setTimeout\(/);
  /* Entering the panel has to cancel that pending close - matched across the
     whole branch rather than as one line, because that branch grew a second
     job (previewing a colour on hover) and a single-line pattern would have
     failed for a reason that has nothing to do with what this test is about. */
  const enter = between(pop, 'if (inPop(e.target))', 'var tile = tileOf');
  assert.match(enter, /\w+\.cancelTimers\(\);/);
  assert.match(enter, /return;/);
});

test('sweeping across a shelf of tiles does not strobe panels open', () => {
  assert.match(pop, /OPEN_DELAY: \d+/);
  assert.match(pop, /_openTimer = setTimeout\(/);
});

test('re-tapping an open tile does not toggle the list shut', () => {
  /*
   * Somebody reaching for a size and clipping the tile on the way would
   * otherwise lose the list they were aiming at - and then blame the till.
   */
  assert.match(pop, /if \(\w+\._gid === groupId && \w+\.isOpen\(\)\)/);
  assert.match(pop, /\w+\.place\(\);\s*\n\s*return;/);
});

test('the panel follows its tile when anything moves', () => {
  /* Placed in viewport coordinates, so a scroll leaves it hanging over the
     wrong tile unless it is repositioned. scroll does not bubble, hence
     capture. */
  assert.match(pop, /addEventListener\('scroll', \w+, true\)/);
  assert.match(pop, /addEventListener\('resize', \w+\)/);
});

test('the panel does not outlive the grid it belongs to', () => {
  /*
   * It lives on <body>, so removing #item-lists does not take it with it. A
   * category change would leave a list of sizes floating over a shelf that no
   * longer holds them, and tapping one would add an item not on screen.
   */
  const render = between(js, "$('#item-lists').remove()", 'sale-tile-grid');
  const before = js.slice(Math.max(0, js.indexOf("$('#item-lists').remove()") - 400),
    js.indexOf("$('#item-lists').remove()"));
  assert.ok(/variantPop\.close\(\)/.test(before) || /variantPop\.close\(\)/.test(render),
    'the panel is not closed when the grid is rebuilt');
});

test('the tile can be reached and opened without a mouse', () => {
  /*
   * The tile is a div. A div does not turn Enter into a click the way a button
   * does, so without this the tiles are reachable by Tab and do nothing when
   * you get there - which reads as a dead control, not as a missing feature.
   */
  assert.match(js, /class="wsk-cp wsk-variant cbutton--effect-novak" tabindex="0"/);
  assert.match(pop, /e\.key === 'Enter' \|\| e\.keyCode === 13/);
  assert.match(pop, /e\.key === 'Escape' \|\| e\.keyCode === 27/);
});

test('closing with Escape puts focus back on the tile', () => {
  /*
   * Focus otherwise lands on <body> and the next Tab restarts from the top of
   * the page. The tile has to be held BEFORE close(), which clears it.
   */
  const esc = between(pop, "e.key === 'Escape'", 'var row =');
  assert.match(esc, /var from = \w+\._tile;/);
  assert.match(esc, /\w+\.close\(\);/);
  assert.match(esc, /from\.focus\(\)/);
});

test('the group id is data on the tile, not parsed back out of an onclick', () => {
  /* Reading it out of the onclick string works until the first product name
     with an apostrophe in it. */
  assert.match(js, /data-variant-group="/);
  assert.match(pop, /getAttribute\('data-variant-group'\)/);
});

test('rows are a thumb, not a cursor', () => {
  /* Six sizes in list-group rows is six targets a finger cannot tell apart. */
  const row = between(cssBlock, '.variant-pop .vp-row {', '.variant-pop .vp-row:last-child');
  assert.match(row, /min-height: 44px/);
});

test('there is a way out that is not hover', () => {
  /* A hover-only panel with no dismiss is a trap on a till with no keyboard. */
  assert.match(pop, /vp-close/);
  assert.match(cssBlock, /\.vp-close/);
});

test('the panel takes its colours from the theme', () => {
  /*
   * It sits on top of the sale screen - the screen somebody stares at all day -
   * and a white card over a dark till is the complaint that started the theme
   * work in the first place.
   */
  assert.match(cssBlock, /background: var\(--theme-card-bg/);
  assert.match(cssBlock, /color: var\(--theme-text-primary/);
  assert.match(cssBlock, /border: 1px solid var\(--theme-border-color/);

  const literals = cssBlock.match(/(?:^|[^-\w])(?:background|color|border-color):\s*#[0-9a-fA-F]{3,8}/gm) || [];
  assert.deepStrictEqual(literals, [],
    `the panel must not hard-code colours: ${literals.join(', ')}`);
});

test('keyboard focus stays visible', () => {
  /* :hover and :focus share a rule that clears the outline. Clearing it
     without putting something back is how a till stops being usable without a
     mouse, and it looks perfectly fine to whoever did it. */
  assert.match(cssBlock, /\.vp-row:focus-visible/);
  assert.match(cssBlock, /box-shadow: inset 0 0 0 2px var\(--theme-primary-color/);
});

test('an item with none left is shown, not hidden', () => {
  /* A missing row reads as a product that was never set up. The shop decides
     whether to sell it; the till's job is to say what the number is. */
  assert.match(pop, /qty <= 0 \? 'none left'/);
  assert.match(pop, /vp-stock-out/);
  assert.match(cssBlock, /\.vp-stock-out/);
});

/*
 * ============================================================
 * MATRIX FAMILIES: colour AND size
 *
 * Owner: "i see products with variant on hover list the variant list. hope you
 * take care of if product had matrix variant. so we might think like sub menu."
 *
 * A one-axis family is six sizes. A two-axis family is six sizes TIMES five
 * colours, and a flat list of thirty rows in a panel is not a chooser, it is a
 * wall. Worse, the list is sorted by a compound string, so "Red / L" sits
 * between "Red / M" and "Red / S" - the sizes of one colour are not even
 * together.
 *
 * THE PART THAT COULD BE SILENTLY WRONG is the parsing. Both axes are packed
 * into one string by the item form - variant_axis is "Colour / Size",
 * variant_value is "Red / L" - and that separator is legal INSIDE a value. A
 * colour genuinely called "Black / White" splits into three parts, and a
 * confident misreading files sizes under colours that do not exist. Nothing
 * would error; the shop would just see a chooser that is quietly nonsense.
 * ============================================================
 */
const matrix = between(js, 'analyse: function (rows)', 'open: function (groupId');

test('two axes are recovered from the one string that carries them', () => {
  assert.match(matrix, /variant_axis/);
  assert.match(matrix, /split\(' \/ '\)/);
  assert.match(matrix, /axes\.length !== 2/);
});

test('a value containing the separator refuses rather than guesses', () => {
  /*
   * The whole reason this is written as a refusal. "Black / White" in a
   * two-axis family splits into three parts, and there is no way to tell which
   * separator was the axis boundary. Falling back to the flat list is never
   * wrong, only long - and "correct but less clever" is the only safe direction
   * when the alternative is a chooser that lies.
   */
  assert.match(matrix, /if \(parts\.length !== 2\) \{ return flat; \}/);
  assert.match(matrix, /if \(!first \|\| !second\) \{ return flat; \}/);
});

test('every value must parse, not just the first', () => {
  /* Sampling one row and trusting the rest is how a family with one awkward
     colour renders half a matrix. */
  assert.match(matrix, /for \(var i = 0; i < rows\.length; i\+\+\)/);
});

test('a matrix of one column falls back to the flat list', () => {
  /* Two columns with one entry each is more taps than a plain list, not fewer,
     and it is what a one-axis family looks like if it happens to carry a
     two-part label. */
  assert.match(matrix, /if \(groups\.length < 2\) \{ return flat; \}/);
});

test('the columns are derived from the rows, so a sparse matrix just works', () => {
  /*
   * If Red was only ever stocked in S and M, Red shows S and M. Listing every
   * theoretical combination would offer sizes that exist as no item at all, and
   * choosing one could only fail.
   */
  assert.match(matrix, /index\[first\]\.members\.push/);
  assert.ok(!/for[\s\S]{0,200}axes\[1\]\.forEach/.test(matrix),
    'the second column must not be enumerated independently of the rows');
});

test('the sub-menu is docked, and both levels are on screen at once', () => {
  const html = between(js, 'matrixHtml: function', 'selectAxis: function');
  assert.match(html, /vp-col-axis/);
  assert.match(html, /vp-col-leaf/);
  // Each column says which axis it is, or they are just two unlabelled lists.
  assert.match(html, /shape\.axes\[0\]/);
  assert.match(html, /shape\.axes\[1\]/);
  // The first value is selected on open, so the second column is never empty.
  assert.match(html, /shape\.groups\[0\]\.members/);
  assert.match(html, /i === 0 \? ' is-active' : ''/);
});

test('the leaf rows are rendered in one place for both shapes', () => {
  /*
   * One axis or two, the bottom of the tree is a real item with a price, a
   * stock figure and an id. Two renderers would drift, and the way they drift
   * is that one of them stops showing stock.
   */
  const leaf = between(js, 'leafRows: function', 'matrixHtml: function');
  assert.match(leaf, /vp-stock/);
  assert.match(leaf, /data-item-id/);
  const calls = (js.match(/\.leafRows\(/g) || []).length;
  assert.ok(calls >= 3, `leafRows should serve both shapes and the repaint, found ${calls} calls`);
});

test('choosing a colour is not blocked by the touch guard', () => {
  /*
   * The guard exists because a tap on the tile synthesises a click a moment
   * later, and honouring that on a LEAF would add a random size to a real sale.
   * A colour adds nothing and can be undone by choosing another, so guarding it
   * would only mean the first tap after opening does nothing - which reads as a
   * dead panel. Guard the destructive action, not the navigation.
   */
  const sel = between(js, 'selectAxis: function', 'open: function (groupId');
  assert.ok(!/TOUCH_GUARD/.test(sel), 'selecting an axis must not be behind the touch guard');
});

test('a colour can be chosen by hover and by tap', () => {
  /*
   * Two separate paths, and they are asserted separately on purpose.
   *
   * Hover is the fast path for a mouse. Tap is the ONLY path on a touch screen,
   * which has no hover to read intent from at all - so a till with a touch
   * screen and no click handler has a first column that cannot be used, and
   * every matrix product becomes unsellable from the grid.
   *
   * Checking that the selector appears SOMEWHERE passed with the click handler
   * deleted, because the hover handler mentions it too. Found by mutation.
   */
  const hover = between(pop, "if (e.pointerType !== 'mouse')", 'var tile = tileOf');
  assert.match(hover, /selectAxis/);

  const tap = between(pop, 'var axis = e.target && e.target.closest', 'var row = e.target');
  assert.match(tap, /closest\('#variant_pop \.vp-axis'\)/);
  assert.match(tap, /\w+\.selectAxis\(axis\.getAttribute\('data-axis-value'\)\)/);
});

test('the panel stays attached when the second column changes height', () => {
  /* One colour having more sizes than another changes the panel's height, and
     it is positioned against a tile it must stay joined to. */
  const sel = between(js, 'selectAxis: function', 'open: function (groupId');
  assert.match(sel, /\w+\.place\(\);/);
});

test('the matrix columns cannot squeeze each other off the edge', () => {
  const col = between(cssBlock, '.variant-pop .vp-col {', '.variant-pop .vp-col-axis');
  assert.match(col, /min-width: 0/);
  // And they stack rather than shrink on a narrow screen.
  assert.match(cssBlock, /@media \(max-width: 420px\)[\s\S]*?flex-direction: column/);
});

test('the first level is a thumb target too', () => {
  const axis = between(cssBlock, '.variant-pop .vp-axis {', '.variant-pop .vp-axis:last-child');
  assert.match(axis, /min-height: 44px/);
});

/*
 * The parser, actually run.
 *
 * Everything above checks that the guards are WRITTEN. This runs the function
 * against the data shapes a real shop produces, because a regex confirming that
 * `parts.length !== 2` appears in the file says nothing about whether the split
 * is done on the right string.
 *
 * `analyse` is lifted out of sales.js and evaluated on its own. It touches
 * nothing outside itself - no jQuery, no PosnicPro, no DOM - which is what
 * makes that possible, and is worth keeping true.
 */
const analyse = (() => {
  const start = rawJs.indexOf('analyse: function (rows) {');
  assert.notStrictEqual(start, -1, 'analyse is gone');
  const end = rawJs.indexOf('\n        },', start);
  assert.ok(end > start, 'analyse has no end');
  const body = rawJs.slice(start + 'analyse: function (rows) {'.length, end);
  // eslint-disable-next-line no-new-func
  return new Function('rows', body);
})();

const item = (axis, value, extra) => Object.assign(
  { variant_axis: axis, variant_value: value, id: value, selling_price: 1 }, extra || {});

test('a one-axis family is not a matrix', () => {
  const out = analyse([item('Size', 'S'), item('Size', 'M'), item('Size', 'L')]);
  assert.strictEqual(out.matrix, false);
});

test('a two-axis family groups by the first axis', () => {
  const out = analyse([
    item('Colour / Size', 'Red / S'),
    item('Colour / Size', 'Red / M'),
    item('Colour / Size', 'Blue / S'),
    item('Colour / Size', 'Blue / L'),
  ]);
  assert.strictEqual(out.matrix, true);
  assert.deepStrictEqual(out.axes, ['Colour', 'Size']);
  assert.deepStrictEqual(out.groups.map((g) => g.value), ['Red', 'Blue']);
  assert.deepStrictEqual(out.groups[0].members.map((m) => m.label), ['S', 'M']);
  /* Sparse on purpose: Blue was never stocked in M. It must show what exists,
     not every combination the axes could theoretically make. */
  assert.deepStrictEqual(out.groups[1].members.map((m) => m.label), ['S', 'L']);
});

test('a colour whose own name contains the separator falls back, not lies', () => {
  /*
   * THE ONE THAT MATTERS. "Black / White / S" splits into three, and there is
   * no way to know which separator was the axis boundary. Guessing the first
   * would file every size under a colour called "Black"; guessing the last
   * would invent a colour called "Black / White" only for the rows that have
   * it. Both are wrong, neither errors, and the shop just sees nonsense.
   */
  const out = analyse([
    item('Colour / Size', 'Black / White / S'),
    item('Colour / Size', 'Red / S'),
  ]);
  assert.strictEqual(out.matrix, false,
    'a value with an extra separator must fall back to the flat list');
});

test('one bad row is enough to fall back, wherever it sits', () => {
  /* Checking only the first row renders half a matrix and half nothing. */
  const rows = [
    item('Colour / Size', 'Red / S'),
    item('Colour / Size', 'Blue / M'),
    item('Colour / Size', 'Green / Navy / L'),
  ];
  assert.strictEqual(analyse(rows).matrix, false);
  assert.strictEqual(analyse(rows.slice().reverse()).matrix, false);
});

test('an empty half is not a valid axis value', () => {
  /* "Red / " is a value somebody half-typed. Rendering a blank row in the size
     column offers something with no name to choose. */
  assert.strictEqual(analyse([
    item('Colour / Size', 'Red / '),
    item('Colour / Size', 'Blue / M'),
  ]).matrix, false);
});

test('a two-part label with only one colour is not worth two columns', () => {
  const out = analyse([
    item('Colour / Size', 'Red / S'),
    item('Colour / Size', 'Red / M'),
  ]);
  assert.strictEqual(out.matrix, false);
});

test('a missing or one-part axis label is a plain list', () => {
  assert.strictEqual(analyse([item('', 'Red / S'), item('', 'Blue / M')]).matrix, false);
  assert.strictEqual(analyse([item('Size', 'S'), item('Size', 'M')]).matrix, false);
  /* Three axes: the form cannot produce them, so a three-part label is a value
     that ate its separator rather than a third dimension. */
  assert.strictEqual(analyse([
    item('Colour / Size / Fit', 'Red / S / Slim'),
    item('Colour / Size / Fit', 'Blue / M / Slim'),
  ]).matrix, false);
});

test('values are trimmed, so " Red / S" and "Red / S " group together', () => {
  const out = analyse([
    item('Colour / Size', 'Red / S'),
    item('Colour / Size', ' Red / M '),
    item('Colour / Size', 'Blue / S'),
  ]);
  assert.strictEqual(out.matrix, true);
  assert.deepStrictEqual(out.groups.map((g) => g.value), ['Red', 'Blue']);
  assert.strictEqual(out.groups[0].members.length, 2);
});

test('a family of one is never a matrix', () => {
  assert.strictEqual(analyse([item('Colour / Size', 'Red / S')]).matrix, false);
  assert.strictEqual(analyse([]).matrix, false);
  assert.strictEqual(analyse(null).matrix, false);
});
