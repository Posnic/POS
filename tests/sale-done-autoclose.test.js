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

test('intent stops the countdown - a click, a key, a tap. Nothing less.', () => {
  /*
   * THE THIRD DEFINITION, this time the owner's own: "if click anywhere then
   * cancel that close otherwise just close it." Hover-anywhere cancelled on
   * the frame the panel appeared; movement-over-a-threshold then held the
   * card forever on every sale after the first ("sales auto close stuff also
   * only first time only") - the hand travelling back from Complete crossed
   * the threshold before the countdown was ever seen.
   */
  const at = salesJs.indexOf('saleDoneTimer.hold()');
  assert.notStrictEqual(at, -1, 'nothing calls hold()');

  for (const evt of ['mousedown', 'touchstart', 'focusin', 'keydown']) {
    assert.ok(salesJs.includes(evt), `nothing cancels the countdown on ${evt}`);
  }
});

test('presence and MOVEMENT do not stop the countdown', () => {
  /*
   * Both retired definitions must stay retired: no hover hold, no movement
   * hold. Either one coming back is the never-closes bug wearing its old
   * clothes.
   */
  assert.doesNotMatch(salesJs, /'mousemove', '#newsalespage'/,
    'the movement hold is back - the card will never close after the first sale');
  assert.doesNotMatch(salesJs, /'mouseenter',\s*'#newsalespage/,
    'the hover hold is back - the card will never close at all');
});

test('the two action buttons are not a hold - the close X closes into a new sale', () => {
  /* "dont ignore close button close. if user click close button then it
     needs to close and new sale." A hold on the X would swallow the one
     click that most clearly means "done". */
  const closer = blockAt(salesJs, "$(document).on('click', '.infobar-tender-close'");
  assert.match(closer, /is\(':visible'\)/);
  assert.match(closer, /saleDoneTimer\.stop\(\)/);
  assert.match(closer, /sale-done-primary'\)\.get\(0\)/);
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

test('the countdown is ONE line along the top, paced by the timer', () => {
  /* Owner: "whole box animation going. instead top side itself enough
     instead of all 4 sides." The ring around the card is gone; a single
     top-edge bar shrinks over the same seconds the timer counts. CSS runs
     it (is-closing starts the keyframe, the variable paces it), so
     cancelling is removing one class - nothing to unwind. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /--sale-done-secs/, 'the bar is not paced by the timer');
  assert.ok(!/getTotalLength/.test(fn), 'the perimeter ring is back');
  assert.match(css, /\.sale-done-card::before/);
  assert.match(css, /sale-done-countdown var\(--sale-done-secs/);
  assert.match(css, /@keyframes sale-done-countdown/);
});

test('reduced motion means the card does not close itself at all', () => {
  /* The bar is the only warning this card gives. Hiding it but keeping the
     close would make the panel vanish with no notice - the exact surprise
     the bar exists to prevent. */
  const fn = blockAt(salesJs, 'start: function');
  assert.match(fn, /prefers-reduced-motion/, 'reduced motion is not considered');
  const at = fn.indexOf('prefers-reduced-motion');
  assert.match(fn.slice(at, at + 200), /return/, 'reduced motion does not stop the auto-close');
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.sale-done-card\.is-closing::before \{ animation: none/,
    'the bar still animates for reduced motion',
  );
});

test('the bar cannot swallow a click and only runs while counting', () => {
  const bar = cssRule('.sale-done-card::before');
  assert.match(bar, /pointer-events:\s*none/);
  /* the animation is bound to is-closing, so a cancelled timer shows no bar */
  assert.match(css, /\.sale-done-card\.is-closing::before \{\s*animation: sale-done-countdown/);
});

test('a held card says so, rather than leaving the cashier guessing', () => {
  assert.ok(html.includes('sale-done-hint'), 'no hint element exists');
  assert.match(cssRule('.sale-done-card.is-held .sale-done-hint'), /display:\s*block/);
  assert.match(cssRule('.sale-done-hint'), /display:\s*none/);
});

test('one announcement per sale - the card, never a toast on top of it', () => {
  /* "after sales complete i see two notification... sometime it might block
     some action like close from mobile." The toast sat exactly over the
     card's close button on a phone. Errors still toast - the card never
     shows for those. */
  const at = salesJs.indexOf("balance_view') === 'true')) {");
  assert.ok(at > -1, 'the toast is unconditional again');
  const around = salesJs.slice(at - 400, at + 120);
  assert.match(around, /response\.type === 'success'/);
});
