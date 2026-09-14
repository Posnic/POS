'use strict';

/*
 * The two copies of the nutrition thresholds must agree, byte for byte.
 *
 * The server derives a dish's health claims when a customer reads the menu.
 * The item screen derives them live while a cook types, because that is how
 * the rule is taught - you type a protein figure and watch "High protein"
 * appear - and a round trip per keystroke is not a thing to build.
 *
 * Two implementations is the ordinary way to get that and the wrong one. They
 * agree the day they are written. Then somebody moves the high-protein line
 * from twenty percent to eighteen on one side, and from then on the item
 * screen promises a badge the menu never shows. Nobody can see that from
 * either screen, and nothing fails.
 *
 * So it is one file, copied. This test is the thing that makes the copy safe.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'api', 'src', 'utils', 'dish-facts.js');
const BROWSER = path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'dish-facts.js');

test('the desktop bundle carries the same thresholds as the server', () => {
  assert.ok(fs.existsSync(BROWSER), 'frontend copy is missing: node scripts/dev/copy-dish-facts.cjs');

  const server = fs.readFileSync(SERVER);
  const browser = fs.readFileSync(BROWSER);

  assert.ok(
    server.equals(browser),
    'dish-facts.js has drifted between api and frontend.\n' +
      'The item screen would promise badges the menu does not show.\n' +
      'Fix: node scripts/dev/copy-dish-facts.cjs'
  );
});

test('the copy really does load in a browser, with no module around it', () => {
  /*
   * Byte-identical is only half of it: the file has to WORK once concatenated
   * into the desktop bundle, where there is no `module` and no `require`. It
   * ends with a UMD tail that falls back to a global, and the failure mode if
   * that tail is ever edited carelessly is a ReferenceError at bundle load -
   * which takes the whole dashboard script with it, not just this feature.
   *
   * So run it the way the browser will: no module in scope, and see that it
   * hangs itself on the root object.
   */
  const source = fs.readFileSync(BROWSER, 'utf8');
  const root = {};
  /* eslint-disable-next-line no-new-func */
  new Function('window', 'module', 'exports', `var globalThis = window; ${source}`)(
    root,
    undefined,
    undefined
  );

  assert.ok(root.PosnicDishFacts, 'the browser copy did not register a global');

  /* And it is the real thing, not an empty object that happens to exist. */
  const earned = root.PosnicDishFacts.claimsFor({ kcal: 280, protein_g: 38 }, []);
  assert.ok(earned.includes('high_protein'));
  assert.deepStrictEqual(root.PosnicDishFacts.claimsFor({}, []), []);
});

test('the bundle actually loads the copy, or the item screen has no preview', () => {
  /*
   * A file in core/ that no page map lists is a file that does not ship. That
   * has happened in this codebase before - a whole animation was written,
   * styled, given a canvas and never loaded - and the symptom here would be
   * an item screen whose badge strip is permanently empty, which reads as
   * "this dish earns nothing" rather than as a missing script.
   */
  const map = fs.readFileSync(path.join(ROOT, 'frontend', 'pages_css_js_map.json'), 'utf8');
  assert.match(map, /static\/script\/js\/core\/dish-facts\.js/);
});
