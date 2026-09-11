'use strict';

/**
 * What the API serves has to be what the deploys ship.
 *
 * THE BUG THIS EXISTS FOR, WHICH RAN FOR THE WHOLE LIFE OF THE FEATURE.
 *
 * `api/app.js` mounts the customer bundles from `path.join(__dirname, '..',
 * 'menu')` and `'../order'`, each behind `fs.existsSync`. Neither deploy
 * workflow ever rsynced those directories - production shipped `api/` alone,
 * develop shipped `api/`, `frontend/public/` and `languages/`.
 *
 * So the guard did what it was written to do and skipped the mount. No error,
 * no warning, nothing in a log. Every `/menu` and every `/order` URL answered
 * 404 on every environment from the day the feature shipped, and a 404 reads
 * as a routing bug rather than a deployment one - which is why it survived
 * review, survived a release, and was found by curling the live site rather
 * than by anything in this suite.
 *
 * The lesson is not "remember the rsync". It is that a directory the code
 * serves and the deploy does not ship is a pair that has to be checked
 * together, in both directions, by something that runs on every pull request.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** The directories app.js mounts as static bundles, read out of the source. */
function servedBundles() {
  const src = read('api', 'app.js');
  const found = new Set();

  /*
   * Only the *_BUNDLE constants.
   *
   * app.js joins __dirname with '..' for other things too - frontend/ among
   * them - and those are served differently or not at all. Matching every such
   * join would have this test demanding the deploys rsync directories nobody
   * asked them to, which is the fastest way to make a check people stop
   * trusting.
   */
  for (const m of src.matchAll(
    /const\s+\w*BUNDLE\s*=\s*path\.join\(__dirname,\s*'\.\.',\s*'([a-z-]+)'\)/g
  )) {
    found.add(m[1]);
  }
  return [...found];
}

const DEPLOYS = [
  { file: '.github/workflows/deploy-api.yml', what: 'production' },
  { file: '.github/workflows/deploy-develop.yml', what: 'develop' },
];

test('app.js still serves the two customer bundles', () => {
  /* Named explicitly so a regression reads as itself. If somebody moves these
     behind a different expression, this fails loudly rather than quietly
     checking nothing. */
  const served = servedBundles();
  assert.ok(served.includes('menu'), 'app.js no longer mounts the menu bundle');
  assert.ok(served.includes('order'), 'app.js no longer mounts the ordering bundle');
});

test('every bundle the API serves is shipped by every deploy', () => {
  const served = servedBundles();
  const gaps = [];

  for (const { file, what } of DEPLOYS) {
    const workflow = read(...file.split('/'));
    for (const bundle of served) {
      /* An rsync SOURCE of `menu/`, not merely the word somewhere in a
         comment - the comments in these files mention both by name. */
      if (!new RegExp(`^\\s*${bundle}/\\s`, 'm').test(workflow)) {
        gaps.push(`${what} does not rsync ${bundle}/`);
      }
    }
  }

  assert.deepStrictEqual(
    gaps,
    [],
    `the API serves directories the deploy never copies, so every URL under them 404s:\n  ${gaps.join('\n  ')}`
  );
});

test('a change to a bundle actually triggers the deploy that ships it', () => {
  /*
   * THE OTHER HALF OF THE SAME BUG.
   *
   * Shipping the directories is not enough if the workflow never runs.
   * deploy-api.yml is filtered to `paths: ["api/**"]`, so a commit touching
   * only menu/ or order/ would pass CI, merge, and never reach a shop - and
   * nothing would appear in Actions to say so, which is quieter than the 404
   * that started this.
   *
   * develop has no paths filter, so it needs no entry here.
   */
  const workflow = read('.github', 'workflows', 'deploy-api.yml');
  const filter = workflow.match(/paths:\s*\[([^\]]*)\]/);
  assert.ok(filter, 'deploy-api.yml has no paths filter to check');

  const missing = servedBundles().filter((b) => !filter[1].includes(`${b}/**`));
  assert.deepStrictEqual(
    missing,
    [],
    `deploy-api.yml does not run for changes to: ${missing.join(', ')}`
  );
});

test('the bundles are in the repository at all', () => {
  /* The other end of the same pair: a deploy that copies a directory nobody
     committed fails at rsync time rather than silently, but it still fails. */
  for (const bundle of servedBundles()) {
    assert.ok(
      fs.existsSync(path.join(ROOT, bundle, 'index.html')),
      `${bundle}/index.html is missing, so there is nothing to serve or ship`
    );
  }
});

test('a missing bundle is logged rather than passed over in silence', () => {
  /*
   * The guard stays - a desktop build that packaged one and not the other
   * should still boot - but it says so. "404 on every customer URL" is not
   * something anybody should have to discover with curl.
   */
  const src = read('api', 'app.js');
  assert.match(
    src,
    /console\.(warn|error)\(\s*`\[bundle\]/,
    'app.js skips a missing bundle without saying anything'
  );
});
