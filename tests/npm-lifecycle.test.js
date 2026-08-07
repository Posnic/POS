/*
 * What `npm ci` is allowed to do.
 *
 * The first release failed on all three platforms at the Install step, and the
 * reason was a `prepublish` script. It is a deprecated npm lifecycle that still
 * fires on `npm install` and `npm ci`, and it ran the whole bundle preparation:
 * fetching the Visual C++ runtime, building the frontend, unpacking the API
 * runtime, staging the sync agent.
 *
 * On a developer's machine that mostly works, because the artefacts are already
 * there. On a fresh runner it runs *before* the workflow has fetched MongoDB or
 * installed the frontend toolchain, so it cannot succeed - and the failure
 * looks like "npm ci is broken", which sends you looking in the wrong place.
 *
 * `prebuild` does the same work at the right moment: before `npm run build`,
 * after the workflow has fetched what it needs. That one stays.
 *
 * The rule this pins: installing dependencies must not build anything.
 */

const test = require('node:test');
const assert = require('node:assert');

const pkg = require('../package.json');

/* Everything npm runs on its own during an install. `prepublish` is on the list
   despite the name - npm kept it firing on install for backwards compatibility,
   which is exactly the trap. */
const INSTALL_LIFECYCLES = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
];

/* Work that needs artefacts a fresh checkout does not have. */
const BUILD_WORK = /prepare:bundle|prepare:frontend|prepare:api-runtime|prepare:sync-agent|electron-builder|clear:brand-seed|check:mongodb/;

test('no install lifecycle builds anything', () => {
  for (const name of INSTALL_LIFECYCLES) {
    const script = pkg.scripts[name];
    if (!script) continue;

    assert.doesNotMatch(
      script,
      BUILD_WORK,
      `scripts.${name} runs bundle preparation. npm fires it during \`npm ci\`, ` +
        'before a workflow has fetched MongoDB or installed the frontend ' +
        'toolchain, so every platform fails at the install step with an error ' +
        'that reads like a broken lockfile. Put this work in prebuild instead.',
    );
  }
});

test('prepublish specifically is gone', () => {
  /* Named on its own because it is the one that already cost a release, and
     because the name suggests it only runs on `npm publish`. It does not. */
  assert.strictEqual(
    pkg.scripts.prepublish,
    undefined,
    'scripts.prepublish is back. npm runs it on install as well as publish, ' +
      'and this project is not published to npm - so it can only do harm.',
  );
});

test('prebuild still does the preparation', () => {
  /* Removing prepublish is only safe because this exists. */
  assert.ok(pkg.scripts.prebuild, 'prebuild is missing; nothing prepares the bundle before a build');
  assert.match(pkg.scripts.prebuild, /prepare:bundle/, 'prebuild no longer prepares the bundle');
});

test('postinstall stays cheap', () => {
  /* It is allowed to run, so it has to be something that works on a bare
     checkout with no artefacts and no network. */
  const script = pkg.scripts.postinstall;
  if (!script) return;
  assert.doesNotMatch(script, /&&/, 'postinstall chains commands; keep it to one cheap step');
  assert.doesNotMatch(script, BUILD_WORK, 'postinstall does build work');
});
