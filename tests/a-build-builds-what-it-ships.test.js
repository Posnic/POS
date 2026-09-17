'use strict';

/*
 * EVERY WAY OF MAKING AN INSTALLER REBUILDS THE FRONTEND FIRST.
 *
 * `frontend/public/` is a build artifact and it is gitignored. Nothing in the
 * repository holds it, so whatever is on the packaging machine's disk at the
 * moment electron-builder runs is what goes into the exe.
 *
 * Every build variant guards that with a `prebuild:*` step, which npm runs
 * automatically and which calls `prepare:bundle` -> `prepare:frontend`. That
 * script runs the gulp build and then refuses to continue if the artifacts are
 * older than the run, so a stale bundle cannot get past it.
 *
 * `publish` had no such step. One script out of eight, and it is the one that
 * makes the installer customers actually receive.
 *
 * WHAT THAT COST, on 2026-09-17. The exe on a customer machine carried a
 * current main process - the kitchen announcement, the tone, the preload
 * bridge, all correct - and a `dashboard.*.js` built before the renderer half
 * of that feature existed. So the main process sent `posnic:kitchen-call` to a
 * page where nothing was listening, and the kitchen stayed silent. Every file
 * was present on disk; one of them was simply older than the code that needed
 * it. Nothing failed, nothing logged, and the feature looked shipped.
 *
 * This asserts the rule rather than that one script, because the next variant
 * somebody adds will be added the same way the last one was.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

/** Scripts that hand work to electron-builder, whatever they are called. */
const packagers = Object.keys(scripts).filter(
  (name) => /(^|\s|&)electron-builder\b/.test(scripts[name])
);

/**
 * Does making an installer this way rebuild the frontend?
 *
 * Either the script prepares in its own line, or npm runs a `pre` script that
 * does. Both are real answers; what matters is that one of them is true.
 */
function prepares(name) {
  const own = scripts[name] || '';
  const before = scripts['pre' + name] || '';
  return /prepare:bundle|prepare:frontend/.test(own + ' ' + before);
}

test('THERE IS MORE THAN ONE WAY TO MAKE AN INSTALLER', () => {
  /* If this ever finds none, the check below passes by finding nothing, which
     is the failure mode of every test that iterates a list. */
  assert.ok(packagers.length >= 5, `found only ${packagers.length} packaging scripts`);
});

test('AND EVERY ONE OF THEM REBUILDS THE FRONTEND FIRST', () => {
  const blind = packagers.filter((name) => !prepares(name));

  assert.deepStrictEqual(
    blind,
    [],
    `these package whatever frontend/public/ happens to hold: ${blind.join(', ')}. ` +
      'That directory is gitignored build output, so without prepare:bundle the ' +
      'installer can carry a bundle older than the code that needs it - which is ' +
      'how a finished feature ships silent.'
  );
});

test('the preparation is the one that refuses stale artifacts', () => {
  /*
   * Rebuilding is not enough on its own: a gulp build that quietly fails would
   * leave the old bundle in place and packaging would carry on. prepare-frontend
   * compares each artifact's mtime against the start of the run, which is what
   * turns "we ran a build" into "the files are from this build".
   */
  const guard = fs.readFileSync(path.join(ROOT, 'scripts', 'prepare-frontend.js'), 'utf8');

  assert.match(guard, /web artifact is stale/, 'nothing checks the artifacts are fresh');
  assert.match(guard, /mtimeMs/, 'staleness is not measured against the clock');
  assert.match(guard, /dashboard\\\./, 'the dashboard bundle is not among the required artifacts');
});
