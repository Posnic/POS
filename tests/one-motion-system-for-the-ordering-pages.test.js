'use strict';
/*
 * ONE MOTION SYSTEM, ON BOTH ORDERING PAGES.
 *
 * Owner: "animations not properly organized. you need to see that. i want app
 * like real corporate app, proper mobile app kind of feel in responsive
 * website."
 *
 * He is right, and it was measurable. order.css carried THIRTEEN durations -
 * 70ms, 90ms, 0.12s, 0.15s, 0.2s, 0.22s, 0.25s, 0.28s, 0.3s, 0.32s, 0.4s,
 * 0.5s, 0.9s - in two notations, and `ease` twenty-five times. The menu page
 * had grown its own copy of the same sprawl in an inline stylesheet.
 *
 * No single value was wrong. Together they are why a page feels assembled
 * rather than made: an app reads as native when everything that moves agrees
 * about how long a movement takes.
 *
 * This is the ratchet. It does not care what the numbers ARE - it cares that
 * there is one set of them and that nothing writes its own.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ORDER = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'order.css'), 'utf8');
const MENU = fs.readFileSync(path.join(ROOT, 'menu', 'index.html'), 'utf8');

const DURATIONS = ['--t-press', '--t-quick', '--t-move', '--t-sheet'];
const CURVES = ['--ease-enter', '--ease-exit', '--ease-move', '--ease-spring'];

/** Every `transition:` declaration in a stylesheet, whole, however it wraps. */
function transitions(css) {
  return (css.match(/transition:[^;}]*;/g) || []).map((one) => one.replace(/\s+/g, ' ').trim());
}

/** Every `animation:` shorthand, which is not the same question as a keyframe. */
function animations(css) {
  return (css.match(/animation:[^;}]*;/g) || []).map((one) => one.replace(/\s+/g, ' ').trim());
}

/* ------------------------------------------------------------ the scale */

test('both pages declare the same four durations and the same curves', () => {
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    for (const token of DURATIONS.concat(CURVES)) {
      assert.ok(css.includes(token + ':'), name + ' does not define ' + token);
    }
  }
});

test('the two pages agree on what each duration is', () => {
  /* Two pages of one product that disagree about how long a movement takes
     are two products, and a customer opens both. */
  for (const token of DURATIONS) {
    const inOrder = ORDER.match(new RegExp(token + ':\\s*([^;]+);'));
    const inMenu = MENU.match(new RegExp(token + ':\\s*([^;]+);'));
    assert.ok(inOrder && inMenu, token + ' is missing from one of them');
    assert.strictEqual(inMenu[1].trim(), inOrder[1].trim(), token + ' differs between the pages');
  }
});

/* ------------------------------------------------- and nothing writes its own */

test('no transition on either page writes its own timing', () => {
  /*
   * THE RATCHET. A transition with a number in it is a decision somebody made
   * alone, and ten of those are the thing the owner could see without being
   * able to name.
   */
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    for (const rule of transitions(css)) {
      if (/transition:\s*(none|all)?\s*;/.test(rule)) continue;
      assert.ok(
        !/\d+\s*m?s\b/.test(rule),
        name + ' has a transition with its own duration: ' + rule
      );
      assert.ok(
        !/\bease\b(?!-)/.test(rule),
        name + ' has a transition using the browser default curve: ' + rule
      );
    }
  }
});

test('and no animation does either, unless it loops', () => {
  /*
   * A looping animation is a different thing: a spinner, a breathing orb, a
   * skeleton pulse. Those have their own rhythm and `linear` or `ease-in-out`
   * is right for them, because they never arrive or leave. Everything that
   * happens ONCE is part of the scale.
   */
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    for (const rule of animations(css)) {
      if (/\binfinite\b/.test(rule) || /animation:\s*none/.test(rule)) continue;
      /* `draw` is a stroke being drawn rather than a thing moving, and says so
         where it is written. It still takes a curve from the scale. */
      const drawing = /\bdraw\b/.test(rule);
      assert.ok(
        drawing || !/\d+\.?\d*\s*m?s(?!\s*(both|forwards))/.test(rule.replace(/var\([^)]*\)/g, '')),
        name + ' has a one-off animation with its own duration: ' + rule
      );
      assert.ok(
        !/\bease\b(?!-)/.test(rule),
        name + ' has an animation using the browser default curve: ' + rule
      );
    }
  }
});

/* --------------------------------------------------- the mobile-app feel */

test('a tap does not flash a grey box, and does not wait to be believed', () => {
  /*
   * The two lines that most decide whether a page reads as an app. A mobile
   * browser paints a highlight over whatever a finger lands on and waits
   * about 300ms before accepting a tap is not the start of a zoom. Both are
   * correct for a document and wrong for something being operated.
   */
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    assert.match(css, /-webkit-tap-highlight-color:\s*transparent/, name + ' still flashes on tap');
    assert.match(css, /touch-action:\s*manipulation/, name + ' still waits out the double-tap');
  }
});

test('pinch to zoom is kept on the page, because it is an accessibility feature', () => {
  /*
   * `manipulation` gives up double-tap zoom only. `none` would take the pinch
   * with it, and that is not ours to remove.
   *
   * SCOPED, not global. The hold-to-talk button sets `touch-action: none` and
   * is right to: a press-and-hold control must not have its gesture read as a
   * scroll. So the question is not whether the file contains `none` - it is
   * whether the ROOT does, which would take the zoom away from everything.
   */
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    const root = css.match(/(?:^|\n)\s*html\s*\{([\s\S]*?)\}/);
    assert.ok(root, name + ' has no html rule');
    assert.ok(
      !/touch-action:\s*none/.test(root[1]),
      name + ' took pinch-to-zoom away from the whole page'
    );
    assert.match(root[1], /touch-action:\s*manipulation/, name + ' does not set the page gesture rule');
  }
});

test('a finger gets one answer, everywhere, and it is instant on release', () => {
  /*
   * Fourteen `:active` rules had grown up separately, so a chip sank and a
   * card did not. A finger learns one language on a screen.
   *
   * Instant on the way back up: a release that eases is a button that is
   * still busy after the finger has gone.
   */
  const press = ORDER.match(/\.product-card:active[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(press, 'the shared press response is gone');
  assert.match(press[1], /transform:\s*scale\(0?\.9\d\)/, 'a press no longer answers with contact');
  assert.match(press[1], /transition-duration:\s*0s/, 'the release eases');
});

test('a disabled control does not answer, because answering is a promise', () => {
  assert.match(ORDER, /:disabled:active[\s\S]{0,400}?transform:\s*none/);
});

test('a phone that asked for less motion still gets less', () => {
  /* The scale must not have quietly stepped over the one rule that matters
     more than any of it. */
  for (const [name, css] of [['order.css', ORDER], ['menu/index.html', MENU]]) {
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\)/,
      name + ' stopped honouring reduced motion'
    );
  }
});

test('the voice meter is the one documented exception, and says why', () => {
  /*
   * Six bars whose height is driven from the microphone level. scaleY would
   * keep it off the main thread but needs the bars re-authored and watched
   * while it is done - a meter smoothed wrongly reads as a microphone that is
   * not listening. Left alone on purpose, and the reason is in the file so
   * the next person does not "fix" it blind.
   */
  const rule = ORDER.match(/\.voice-wave i \{([\s\S]*?)\}/);
  assert.ok(rule, 'the voice meter rule is gone');
  assert.match(rule[1], /HEIGHT, and deliberately/, 'the exception lost its reason');
  assert.match(rule[1], /transition:\s*height var\(--t-press\)/, 'even the exception takes its timing from the scale');
});
