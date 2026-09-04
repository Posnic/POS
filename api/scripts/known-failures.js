#!/usr/bin/env node
'use strict';
/*
 * Run only the quarantined suites, and say where they stand.
 *
 * `npm test` runs the curated suite - everything except jest.known-failures.js -
 * so a contributor's first command succeeds and any new breakage still fails it.
 * That is only honest if the debt stays easy to look at, which is what this is.
 *
 * A shell-substitution one-liner in package.json was tried first and silently
 * ran the whole suite on Windows, where npm scripts go through cmd.exe and
 * $(...) is not substitution but a literal. It reported 197 suites and looked
 * like it had worked.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const suites = require(path.join(__dirname, '..', 'jest.known-failures.js'));

if (!suites.length) {
  console.log('\n  Nothing is quarantined. The list is empty.\n');
  process.exit(0);
}

console.log(`\n  ${suites.length} quarantined suite(s). These are excluded from`);
console.log('  `npm test` and from CI, and this is what they do today:\n');

/*
 * Jest's own entry point, run with this node.
 *
 * Going through npx meant spawning a .cmd shim on Windows, which produced no
 * output at all here - the command appeared to succeed and printed nothing.
 * Resolving the binary and running it directly removes the shell from the
 * middle of it.
 */
const jestBin = require.resolve('jest/bin/jest', {
  paths: [path.join(__dirname, '..')],
});

const result = spawnSync(
  process.execPath,
  [jestBin, ...suites, '--forceExit'],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') },
);

/*
 * Exit 0 whichever way it goes.
 *
 * These are known to fail; that is the definition of the list. Reporting that
 * as a failure would make this command useless in any script, and it is meant
 * to be read rather than gated on.
 */
process.exit(result.error ? 1 : 0);
