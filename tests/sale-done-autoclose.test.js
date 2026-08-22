const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, cssReader, stripComments } = require('./helpers/source-lookup');

/*
 * The sale-done card closes itself, unless the cashier is using it.
 *
 * Owner ask: "after successfull sales we show sucess message... i see little
 * animation on border reaches corner and then disappear... user no need to
 * click close button or new sales. he have enough time to print or something."
 *
 * The saved click is the small half. The part that has to be right is the
 * CANCELLING: a card that closes as somebody reaches for Print sends them
 * hunting for the sale again in front of a waiting customer, and that one
 * event costs more than the clicks saved across a hundred sales.
 *
 * Comments are stripped before every assertion - prose naming a guard reads
 * exactly like the guard.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const salesJs = stripComments(
  read('frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
);
const html = read('frontend', 'modules', 'sales_write.html');
const css = read('frontend', 'static', 'style', 'css', 'custom.css');
const cssRule = cssReader(css);

const timer = () => blockAt(salesJs, 'PosnicPro.sales.saleDoneTimer = {');

test('attention of any kind stops the countdown', () => {
  /*
   * Four different ways a person shows they are using this card, and a
   * keyboard user reaches a button by focusin where a mouse user arrives by
   * mouseenter. Binding only one of them protects only one kind of cashier.
   */
  /* Located by the call it makes, not by the selector: '#newsalespage'
     appears several times in this file and the first is a .hide(). */
  const at = salesJs.indexOf('saleDoneTimer.hold()');
  assert.notStrictEqual(at, -1, 'nothing calls hold()');
  const start = salesJs.lastIndexOf('$(document).on(', at);
  assert.notStrictEqual(start, -1, 'hold() is not reached from a delegated handler');
  const handler = salesJs.slice(start, at + 30);

  for (const evt of ['mouseenter', 'focusin', 'keydown', 'touchstart']) {
    assert.ok(handler.includes(evt), `nothing cancels the countdown on ${evt}`);
  }
  assert.match(handler, /#newsalespage/, 'the handler is not bound to the sale-done card');
});

test('once stopped it does not start again', () => {
  /* Somebody who engaged with this card gets to leave it when they choose.
     A timer that resumed after the mouse left would close the card while
     they were reading the receipt they just printed. */
  const fn = timer();
  assert.doesNotMatch(
    fn,
    /mouseleave|mouseout|focusout/,
    'the countdown restarts when attention moves away',
  );
  assert.match(blockAt(salesJs, 'hold: function'), /self\.stop\(\)/);
});

test('the countdown is cancelled wherever the card is hidden', () => {
  /* A timer outliving its card fires into a page that has moved on. */
  assert.match(salesJs, /saleDoneTimer\.stop\(\)/, 'nothing stops the timer on hide');
});

test('a second sale cannot leave two timers running', () => {
  /* Two overlapping timers close the card early, which looks exactly like a
     bug and is nearly impossible to reproduce on purpose. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /self\.stop\(\);/, 'start() does not clear an existing countdown');
});

test('the close does not fire into a page that has moved on', () => {
  const fn = blockAt(salesJs, 'start: function');
  assert.match(
    fn,
    /is\(':visible'\)/,
    'the timeout acts without checking the card is still on screen',
  );
});

test('closing reuses the button rather than duplicating what it does', () => {
  /* A second way to start a sale is a second thing to keep in step. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /sale-done-primary/, 'the timeout does not use the New sale control');
});

test('the ring length is measured, not assumed', () => {
  /* The card grows and shrinks with the buttons a shop has switched on, so a
     hard-coded perimeter makes the ring finish early or late - and a
     countdown that disagrees with the clock is worse than none. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /getTotalLength\(\)/);
});

test('reduced motion means the card does not close itself at all', () => {
  /*
   * The ring is the only warning this card gives. Hiding it but keeping the
   * close would make the panel vanish with no notice - the exact surprise the
   * ring exists to prevent.
   */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /prefers-reduced-motion/, 'reduced motion is not considered');
  const at = fn.indexOf('prefers-reduced-motion');
  const after = fn.slice(at, at + 200);
  assert.match(after, /return/, 'reduced motion does not actually stop the auto-close');
  /* Read from the raw stylesheet: ".sale-done-ring" is a prefix of four other
     selectors, and this file has more than one reduced-motion block, so both
     the selector and its surroundings have to be matched exactly. */
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.sale-done-ring \{ display: none; \}/,
    'the ring is not hidden for reduced motion',
  );
});

test('the ring cannot swallow a click meant for a button', () => {
  /* It covers the whole card. Without this it is an invisible sheet over
     New sale and Print. */
  /* With the brace, or this also matches .sale-done-ring-line and friends;
     and from the section marker, because the reduced-motion block declares
     the same selector further down. */
  assert.match(
    cssRule('.sale-done-ring {', '.sale-done-card { position: relative; }'),
    /pointer-events:\s*none/,
  );
});

test('the ring is only visible while the countdown is running', () => {
  /* A full ring on a cancelled timer promises a close that is not coming. */
  assert.match(cssRule('.sale-done-card.is-closing .sale-done-ring-line'), /opacity/);
  assert.match(cssRule('.sale-done-ring-line'), /opacity:\s*0/);
});

test('a held card says so, rather than leaving the cashier guessing', () => {
  assert.ok(html.includes('sale-done-hint'), 'no hint element exists');
  assert.match(cssRule('.sale-done-card.is-held .sale-done-hint'), /display:\s*block/);
  assert.match(cssRule('.sale-done-hint'), /display:\s*none/);
});

test('the ring is hidden from assistive technology', () => {
  /* It carries no information a screen reader could use, and the behaviour it
     describes is announced by the page changing. */
  const at = html.indexOf('sale-done-ring');
  const tag = html.slice(html.lastIndexOf('<svg', at), at + 200);
  assert.match(tag, /aria-hidden="true"/);
});

test('the panel still works with the ring missing', () => {
  /* Decoration for a behaviour must not become a dependency of it. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /el && el\.getTotalLength/, 'a missing ring would throw');
});
