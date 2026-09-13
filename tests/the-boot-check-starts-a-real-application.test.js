/*
 * THE BOOT CHECK MUST START AN APPLICATION, NOT A COPY OF NODE.
 *
 * `scripts/check-app-boots.js` exists to prove the packaged app starts. It
 * spent two builds reporting that it did not, and it was wrong both times:
 *
 *   Assertion failed: (isolate_data->snapshot_data()) != nullptr
 *     at node::CreateEnvironment, environment.cc:462
 *
 * Electron tests whether ELECTRON_RUN_AS_NODE is PRESENT, not what it says.
 * The workflow set it to "" to clear it, which on Windows defines it - so
 * Posnic.exe started as plain Node, aborted with 134 before it could log a
 * word, and the check blamed the application.
 *
 * A check that fails when the thing it checks is fine is worse than no check:
 * it costs a build to disbelieve, and the next person disbelieves it sooner.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'check-app-boots.js'), 'utf8');
const BETA = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'beta.yml'), 'utf8');

test('the child is spawned without ELECTRON_RUN_AS_NODE', () => {
  assert.match(SCRIPT, /delete\s+childEnv\.ELECTRON_RUN_AS_NODE/,
    'the variable is not removed, so a leaked one runs the app as plain Node');
  assert.match(SCRIPT, /env:\s*childEnv/, 'the cleaned environment is built and then not used');
});

test('the workflow does not define it as empty, which defines it', () => {
  /*
   * The exact line that caused this. Empty is not absent, and a reader who
   * has not met that distinction will write it again.
   */
  assert.ok(
    !/ELECTRON_RUN_AS_NODE:\s*(""|''|\s*$)/m.test(
      BETA.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    ),
    'beta.yml sets ELECTRON_RUN_AS_NODE, which makes the packaged app run as Node'
  );
});

test('the failure path prints what the application said', () => {
  /*
   * The first two failures reported an exit code and nothing else, on a runner
   * that is deleted a minute later. One round trip per line of evidence.
   */
  assert.match(SCRIPT, /stdio: \['ignore', 'pipe', 'pipe'\]/, 'the crash output is thrown away');
  assert.match(SCRIPT, /What it printed before it stopped/, 'what it printed is never shown');
});

test('the diagnostic itself cannot crash before it reports', () => {
  /*
   * `die` runs for failures that happen before the spawn - no packaged
   * application, for one - and `typeof` on a `let` that has not been reached
   * THROWS rather than answering "undefined". Both helpers it uses are
   * declared above it or hoisted.
   */
  const dieAt = SCRIPT.indexOf('function die(');
  const saidAt = SCRIPT.indexOf('let said =');
  assert.ok(dieAt > -1, 'die is gone');
  assert.ok(saidAt > -1 && saidAt < dieAt, 'die reads `said` before it exists');
  assert.match(SCRIPT, /function newLogLines\(\)/,
    'newLogLines is a const arrow declared after die, which cannot be called from it');
});

test('the check is still wired into the build', () => {
  /* A check nobody runs is a check that is not there. */
  assert.match(BETA, /node scripts\/check-app-boots\.js/, 'the build no longer starts the app');
});
