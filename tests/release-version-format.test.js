/*
 * The version string is load-bearing, and the way it fails is silent.
 *
 * update-service.js decides whether a release installs itself or waits for the
 * shop by parsing the version with parseInt. Anything it cannot read is
 * classified 'core', which means it waits on the Updates screen. That is the
 * right default for an unreadable version - but if every version becomes
 * unreadable, every update waits forever and nothing announces that automatic
 * updates have stopped. Tills quietly run last year's build.
 *
 * This matters because release labels may use "R14.X.Y" for shop-facing
 * communication. As a user-facing label that is fine. Put the R in package.json
 * and parseInt('R14')
 * is NaN, so the classifier falls through to 'core' for every release - and the
 * only symptom is that updates stop installing on their own.
 *
 * So: the display name can be anything; the version electron-updater compares
 * has to stay three plain integers.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

/* The same parse update-service.js does, kept deliberately separate so this
   test fails when that logic changes rather than tracking it. */
function readable(version) {
  const parts = String(version || '')
    .split('.')
    .map((n) => parseInt(n, 10));
  return parts.length >= 3 && !parts.some(isNaN);
}

test('the shipped version is three plain integers', () => {
  assert.ok(
    readable(pkg.version),
    `package.json version is "${pkg.version}", which update-service.js cannot ` +
      'parse. Every release would be classified as a core update and wait on ' +
      'the Updates screen instead of installing itself, with nothing to say so.',
  );
});

test('a prefixed version would be unreadable, which is why it must not be used', () => {
  /* Demonstrating the trap rather than describing it, so the reason this test
     exists survives the person who wrote it. */
  assert.ok(!readable('R14.2.0'), 'R14.2.0 is expected to be unparseable');
  assert.ok(!readable('v2.0.0'), 'v2.0.0 is expected to be unparseable');
  assert.ok(readable('14.2.0'));
});

test('an unreadable version still fails safe, not open', () => {
  /* The failure direction matters more than the failure. Waiting for a click is
     recoverable; installing something unclassified is not. */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'update-service.js'), 'utf8');
  const fn = src.slice(src.indexOf('_classify(version)'));
  const body = fn.slice(0, fn.indexOf('\n    }'));

  const guards = body.match(/return 'core';/g) || [];
  assert.ok(
    guards.length >= 2,
    'an unreadable version - either the incoming one or the running one - must ' +
      "classify as 'core' so it waits, rather than defaulting to a quiet install",
  );
  assert.doesNotMatch(
    body,
    /isNaN[\s\S]{0,40}return 'app'/,
    'an unparseable version must never be treated as an application update',
  );
});

test('release tags may carry a prefix; the version inside must not', () => {
  /* Tags are v2.0.0 by convention and that is fine - the tag is not what
     electron-updater compares. This checks the two cannot be confused. */
  const workflow = path.join(ROOT, '.github', 'workflows', 'release.yml');
  if (!fs.existsSync(workflow)) return;

  const src = fs.readFileSync(workflow, 'utf8');
  assert.match(src, /['"]?v\*/, 'release.yml is expected to trigger on v* tags');
  assert.ok(
    readable(pkg.version),
    'the tag may be prefixed, but package.json version must stay numeric',
  );
});
