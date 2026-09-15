#!/usr/bin/env node
'use strict';

/*
 * EVERY CHECK CI RUNS, ON THIS MACHINE.
 *
 * Owner: "better run all ci stuff inside commit. github bill came around 200
 * usd" and then, on scope: "deploy stuff is okay. other check only i said."
 *
 * So this is the CHECK half of .github/workflows/ci.yml and nothing else. The
 * deploys, the releases and the packaging of an installer stay where they are:
 * they need secrets, signing keys and three operating systems, and none of
 * that belongs on a laptop.
 *
 * WHAT IT IS FOR. Run before pushing - `npm run check` by hand, or let the
 * pre-push hook run it - and a push stops failing for something that was
 * visible in ninety seconds. Whether the minutes it saves are billed or not,
 * the round trip through a queue to be told about a lint error is the slowest
 * way to learn anything.
 *
 * WHAT IT IS NOT. A replacement for the checks on the pull request. Those are
 * the gate on merging and they run on a clean machine with a clean checkout,
 * which is the only way to catch "it works here" - a file never committed, a
 * dependency installed globally, a stale build left in a folder. This runs the
 * same commands against the tree in front of you, which is a different and
 * weaker question, deliberately.
 *
 * SPEED. The slow suites are skipped unless asked for, because a check nobody
 * waits for is a check nobody runs:
 *
 *   npm run check           the fast ones - about a minute
 *   npm run check -- --all  everything, including the database suite
 *   npm run check -- --list what would run, and nothing else
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

const args = process.argv.slice(2);
const wantsAll = args.includes('--all');
const listOnly = args.includes('--list');

/*
 * Each check names the CI job it stands for, so a failure here and a red tick
 * on a pull request are recognisably the same thing.
 */
const CHECKS = [
  {
    job: 'Human attribution guard',
    cwd: ROOT,
    command: ['npm', 'run', 'check:attribution'],
    slow: false,
  },
  {
    job: 'Lint and formatting (ESLint)',
    cwd: API,
    command: ['npx', 'eslint', 'src', 'tests'],
    slow: false,
  },
  {
    job: 'Lint and formatting (Prettier)',
    cwd: API,
    command: ['npm', 'run', 'format:check'],
    slow: false,
  },
  {
    job: 'API docs are current',
    cwd: API,
    command: ['npm', 'run', 'docs:check'],
    slow: false,
  },
  {
    job: 'Packaging checks (every required module is packaged)',
    cwd: ROOT,
    command: ['node', 'scripts/check-packaged-modules.js'],
    slow: false,
  },
  {
    job: 'Packaging checks (no runtime require on a dev package)',
    cwd: ROOT,
    command: ['node', 'scripts/check-runtime-deps.js'],
    slow: false,
  },
  {
    job: 'Packaging checks (every required package is declared)',
    cwd: ROOT,
    command: ['node', 'scripts/check-declared-deps.js'],
    slow: false,
  },
  {
    job: 'Desktop tests',
    cwd: ROOT,
    command: ['npm', 'test'],
    /*
     * SKIPPED WITHOUT THE BUILT PAGES, rather than failed.
     *
     * Three of these need what CI builds first (`npm run build:assets` in
     * frontend/): the rollback drill releases the real artifact, and a layout
     * test reads compiled CSS. A working copy does not have those, so on a
     * laptop they fail for a reason that has nothing to do with the change
     * being pushed - which would make this hook fail every time, and a hook
     * that always fails is one everybody bypasses.
     */
    needs: () => fs.existsSync(path.join(ROOT, 'frontend', 'public', 'assets')),
    missing: 'the built pages. cd frontend && npm ci && npm run build:assets',
    slow: false,
  },
  {
    job: 'API unit tests',
    cwd: API,
    command: ['npx', 'jest', '-c', 'jest.ci.config.js', '--ci', '--forceExit', '--silent'],
    /*
     * Minutes, not seconds, and it downloads a MongoDB the first time. Worth
     * having before a push that touches the API, not before every push.
     */
    slow: true,
  },
  {
    job: 'REST API against a real database',
    cwd: API,
    command: ['npx', 'jest', 'tests/api', '--ci', '--forceExit', '--runInBand', '--silent'],
    slow: true,
  },
  {
    job: 'No secrets in history',
    cwd: ROOT,
    command: ['node', 'scripts/scan-git-history.js'],
    /* Walks every blob ever committed. Genuinely slow, and it can only fail on
       something already pushed, so it is not what stands between you and a
       push. */
    slow: true,
  },
];

const wanted = CHECKS.filter((check) => wantsAll || !check.slow);

if (listOnly) {
  console.log(wantsAll ? 'Every check:' : 'The fast checks (--all adds the rest):');
  for (const check of wanted) console.log(`  ${check.job}`);
  process.exit(0);
}

if (!fs.existsSync(path.join(API, 'node_modules'))) {
  console.error('api/node_modules is missing. Run `npm ci` in api/ first.');
  process.exit(1);
}

const started = Date.now();
const failed = [];

const skipped = [];

for (const check of wanted) {
  const label = check.job;

  /*
   * A check whose prerequisite is missing is SKIPPED, not failed. A hook that
   * always fails is a hook everybody bypasses, and then none of the other
   * checks run either. The pull request runs it properly on a clean machine.
   */
  if (check.needs && !check.needs()) {
    skipped.push(`${label} - needs ${check.missing}`);
    process.stdout.write(`\n○ ${label} (skipped)\n`);
    continue;
  }

  process.stdout.write(`\n▶ ${label}\n`);
  /*
   * ONE STRING, THROUGH A SHELL. `npm` and `npx` are batch files on Windows and
   * Node refuses to spawn a .cmd without a shell; passing an argument ARRAY
   * with `shell: true` is what Node warns about, because those arguments get
   * concatenated rather than escaped. Joining them here is the shape that
   * needs neither - and every command in this file is a literal, with nothing
   * from outside in it.
   */
  const out = spawnSync(check.command.join(' '), {
    cwd: check.cwd,
    stdio: 'inherit',
    shell: true,
  });
  if (out.status !== 0) failed.push(label);
}

const seconds = Math.round((Date.now() - started) / 1000);

if (failed.length) {
  console.error(`\n${failed.length} check(s) failed in ${seconds}s:`);
  for (const name of failed) console.error(`  ${name}`);
  console.error('\nThese are the same commands the pull request runs.');
  process.exit(1);
}

for (const note of skipped) console.log(`○ skipped: ${note}`);

console.log(
  `\nAll ${wanted.length - skipped.length} check(s) passed in ${seconds}s.` +
    (wantsAll ? '' : ' Slow suites skipped; `npm run check -- --all` runs them too.')
);
