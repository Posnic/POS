'use strict';

/*
 * A KITCHEN IS NOT THE PLACE TO FIND OUT THE SOUND DOES NOT WORK.
 *
 * On 2026-09-17 a shop had a correct build installed and heard nothing. The
 * repository was green throughout, and it was right to be: every source file
 * was correct. What was wrong was the INSTALLER, which carried a page bundle
 * built before the code that page was supposed to contain.
 *
 * No test in this repository can see that, because the bundle is gitignored
 * build output. So `scripts/check-installed-app.js` looks at an installed app
 * instead and walks the whole chain, and this pins what it walks.
 *
 * Five links, and breaking any one is silence with no error anywhere:
 *
 *   1. the main process can compose and synthesise
 *   2. the bridge carries it to a page
 *   3. a page is listening                    <- the one that broke
 *   4. the browser may play a data: sound
 *   5. somebody turned it on
 *
 * A checker that quietly stopped testing link 3 would be worse than none: it
 * would say "Ready" about the exact failure it exists to catch.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECKER = path.join(ROOT, 'scripts', 'check-installed-app.js');
const source = fs.readFileSync(CHECKER, 'utf8');

test('IT WALKS EVERY LINK IN THE CHAIN', () => {
  const links = [
    ['src/kitchen-call.js', 'the main process composes the announcement'],
    ['kitchen-announce', 'the switches can be read'],
    ['posnic:kitchen-call', 'the bridge carries it to a page'],
    ['autoplay-policy', 'audio is allowed without a user gesture'],
    ['kitchenCall', 'a page is listening'],
    ['speechSynthesis', 'that page can speak'],
    ['media-src', 'the browser may play a generated sound'],
    ['kitchen-announce.json', 'this machine is switched on'],
  ];

  const unchecked = links.filter(([token]) => !source.includes(token)).map(([, what]) => what);

  assert.deepStrictEqual(
    unchecked,
    [],
    `the installed-app checker no longer verifies: ${unchecked.join(', ')}. ` +
      'A checker that says Ready about a link it stopped testing is worse than no checker.'
  );
});

test('IT LOOKS AT THE BUNDLE THAT IS SERVED, not the source beside it', () => {
  /*
   * The trap that made this necessary. The installer contained
   * frontend/static/script/js/core/kitchen-call.js, correct and current, as an
   * unbuilt source file sitting next to a dashboard bundle that did not
   * contain it. Checking for the source file would have reported everything
   * fine.
   */
  assert.match(source, /dashboard\\\.\[0-9a-f\]\+\\\.js|dashboard\./, 'it does not resolve the served bundle');
  assert.match(source, /localhost:5555/, 'it never asks the running app for the page');
  assert.ok(
    !/static\/script\/js\/core\/kitchen-call\.js/.test(source),
    'it checks the source file beside the bundle, which is exactly the thing that lied'
  );
});

test('it is read only, because it runs against a shop machine', () => {
  /*
   * This is pointed at a till in a working restaurant, often while service is
   * on. A diagnostic that writes is a diagnostic somebody is right to refuse
   * to run, and then it never gets run.
   */
  const writes = ['writeFileSync', 'unlinkSync', 'rmSync', 'mkdirSync', 'appendFileSync'];
  const found = writes.filter((call) => source.includes(call));

  assert.deepStrictEqual(found, [], `it writes to the machine it is inspecting: ${found.join(', ')}`);
});

test('and it can be run without knowing where anything is', () => {
  /* Whoever runs this is diagnosing a silent kitchen, not reading a script. */
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

  assert.ok(scripts['check:installed'], 'there is no npm script for it');
  assert.match(source, /LOCALAPPDATA/, 'it cannot find a default installation by itself');
});
