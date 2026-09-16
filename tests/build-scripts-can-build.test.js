/*
 * A BUILD SCRIPT THAT CANNOT BUILD.
 *
 * `build:quick` set ELECTRON_BUILDER_COMPRESSION_LEVEL=fast. app-builder-lib
 * takes a single digit 0-9 there and throws on anything else, so that script
 * could never produce an installer - it packaged the whole app, signed every
 * binary, and then died at the archive step with
 *
 *   ELECTRON_BUILDER_COMPRESSION_LEVEL must be a single digit 0-9, got: "fast"
 *
 * after about two minutes of looking exactly like a build in progress. Worse,
 * run through a pipe (`npm run build:quick | tail`) the shell reports the exit
 * code of `tail`, so it looks like it SUCCEEDED and leaves whatever was in
 * dist/ from the last real build sitting there with an old timestamp. That is
 * how a stale installer gets handed to somebody for testing.
 *
 * The same family as the dead selectors and the dead switches: a thing that
 * was written, committed, and called by nobody who checked what came out.
 *
 * So this asserts the two facts that made it unrunnable, for every build
 * script rather than the one that happened to be wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const pkg = require('../package.json');
const scripts = pkg.scripts || {};

/** Every script that ends up invoking electron-builder. */
const buildScripts = Object.entries(scripts).filter(([, body]) =>
  /electron-builder/.test(String(body))
);

test('there are build scripts to check at all', () => {
  /* An assertion over an empty list passes for ever. */
  assert.ok(buildScripts.length >= 4, `expected the platform build scripts, found ${buildScripts.length}`);
});

test('a compression level is a digit, because that is all electron-builder takes', () => {
  for (const [name, body] of buildScripts) {
    const asked = String(body).match(/ELECTRON_BUILDER_COMPRESSION_LEVEL=(\S+)/);
    if (!asked) continue;
    assert.match(
      asked[1],
      /^[0-9]$/,
      `${name} passes "${asked[1]}", and app-builder-lib throws on anything but 0-9 - ` +
        'the script packages the whole app and then dies at the archive step'
    );
  }
});

test('and a script that sets an env var has cross-env to set it with', () => {
  /* `FOO=bar electron-builder` is shell syntax that cmd.exe does not have, and
     these are run on Windows more often than anywhere else. */
  for (const [name, body] of buildScripts) {
    const text = String(body);
    if (!/[A-Z_]+=\S+\s/.test(text)) continue;
    assert.match(text, /cross-env/, `${name} sets an env var without cross-env, which cmd.exe cannot do`);
  }
});

test('cross-env is actually installed, or every one of them dies on the first word', () => {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const usesCrossEnv = buildScripts.some(([, body]) => /cross-env/.test(String(body)));
  if (!usesCrossEnv) return;
  assert.ok(deps['cross-env'], 'a build script calls cross-env and nothing depends on it');
  assert.ok(
    require('fs').existsSync(path.join(__dirname, '..', 'node_modules', 'cross-env')),
    'cross-env is depended on but not installed'
  );
});
