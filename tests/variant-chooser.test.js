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
  // Entering the panel has to cancel that pending close.
  assert.match(pop, /if \(inPop\(e\.target\)\) \{ \w+\.cancelTimers\(\); return; \}/);
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
