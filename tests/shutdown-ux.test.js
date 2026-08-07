/*
 * What closing the till looks like, and what reopening it during that looks
 * like.
 *
 * Three separate behaviours, which used to be one:
 *
 *   Closing   - nothing on screen. The shop has finished; the windows go at
 *               once and the database finishes closing out of sight.
 *   Restarting- the screen stays, with the steps, because the till is expected
 *               back and the gap is where people conclude it has crashed.
 *   Updating  - always shown, because turning the machine off during it does
 *               real damage.
 *
 * And the one that was simply broken: closing Posnic and immediately reopening
 * it. The closing process still holds the single-instance lock, so the new one
 * failed to get it and called app.exit(0) - no window, no message. For the ten
 * seconds mongod needs to close its files the icon did nothing at all, and
 * clicking again did nothing again.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const MAIN = read('main.js');
const SPLASH = read('splash.js');
const state = require('../shutdown-state');

// ── The note left for the next launch ───────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-shutdown-'));
}

test('a launch during a shutdown can tell that one is running', () => {
  const dir = tempDir();
  assert.strictEqual(state.findInProgress(dir), null, 'reports a shutdown with no note');

  state.begin(dir);
  const found = state.findInProgress(dir);
  assert.ok(found, 'a shutdown in progress is not detected');
  assert.strictEqual(found.pid, process.pid);

  state.clear(dir);
  assert.strictEqual(state.findInProgress(dir), null, 'a finished shutdown still reports as running');
});

test('a note left by a process that died is ignored, and tidied away', () => {
  /*
   * Force-quit Posnic and no `finally` runs, so the note stays. Believing it
   * would make every future launch wait for a process that is never going to
   * exit - the failure would outlive the crash that caused it.
   *
   * pid 1 exists everywhere and is not us; a pid that cannot exist is what is
   * needed, so this uses one past the maximum.
   */
  const dir = tempDir();
  fs.writeFileSync(
    state.markerPath(dir),
    JSON.stringify({ pid: 0x7ffffffe, startedAt: new Date().toISOString() }),
  );

  assert.strictEqual(state.findInProgress(dir), null, 'a dead process is treated as still closing');
  assert.strictEqual(
    fs.existsSync(state.markerPath(dir)),
    false,
    'the stale note is left behind for the next launch to trip over again',
  );
});

test('and so is one too old to be a real shutdown', () => {
  /* The shutdown is budgeted at 25 seconds and force-exits there. A note older
     than a minute means a reused pid or a wedged process, and waiting on it
     would leave a shop looking at a splash screen instead of a till. */
  const dir = tempDir();
  fs.writeFileSync(
    state.markerPath(dir),
    JSON.stringify({
      pid: process.pid,                                  // alive: this process
      startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    }),
  );

  assert.strictEqual(state.findInProgress(dir), null, 'a five minute old note is believed');
});

test('a corrupt note does not stop the application starting', () => {
  const dir = tempDir();
  fs.writeFileSync(state.markerPath(dir), 'not json at all');
  assert.doesNotThrow(() => state.findInProgress(dir));
  assert.strictEqual(state.findInProgress(dir), null);
});

test('writing the note can fail without failing the shutdown', () => {
  /* It is a courtesy to the next launch, not a step of the shutdown. A
     read-only or missing directory must not throw here. */
  assert.doesNotThrow(() => state.begin(path.join(tempDir(), 'does', 'not', 'exist')));
  assert.doesNotThrow(() => state.clear(path.join(tempDir(), 'does', 'not', 'exist')));
});

// ── Which of the three is happening ─────────────────────────────────────────

test('closing shows nothing; restarting and updating show everything', () => {
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body = handler.slice(0, handler.indexOf('performGracefulShutdown'));

  assert.match(
    body,
    /const showProgress = relaunchAfterQuit \|\| installingOnQuit/,
    'the decision to show a window is not tied to restarting or updating, so a ' +
      'plain close either shows a progress window nobody wants or an update ' +
      'installs with nothing on screen',
  );
  assert.match(
    body,
    /if \(showProgress\)[\s\S]*showShutdown\(require\('electron'\)/,
    'the shutdown window is shown unconditionally',
  );
});

test('a plain close takes the windows away immediately', () => {
  /* Otherwise the main window sits there, unresponsive, for as long as the
     database takes - which is exactly what gets a till force-quit in the
     middle of a checkpoint. */
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const body = handler.slice(0, handler.indexOf('performGracefulShutdown'));

  assert.match(body, /hideAllWindowsForQuit\(\)/, 'nothing hides the windows on a silent close');

  const fn = MAIN.slice(MAIN.indexOf('function hideAllWindowsForQuit'));
  const impl = fn.slice(0, fn.indexOf('\n}'));
  assert.match(impl, /\.hide\(\)/, 'the windows are not hidden');
  assert.match(
    impl,
    /setSkipTaskbar\(true\)/,
    'the taskbar entry stays after the window has gone, so the till still ' +
      'looks open',
  );
  assert.doesNotMatch(
    impl,
    /\.destroy\(\)/,
    'destroying windows here can re-enter the quit path through their close ' +
      'handlers',
  );
});

test('the note is written before the slow part, not after it', () => {
  /* Written afterwards it would cover nothing: the whole point is the ten
     seconds mongod spends closing its files. */
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  const begun = handler.indexOf('shutdownState.begin');
  const slow = handler.indexOf('performGracefulShutdown');

  assert.ok(begun > -1, 'nothing records that a shutdown has started');
  assert.ok(begun < slow, 'the shutdown is recorded only after the slow work has run');
});

test('and cleared however the shutdown ends', () => {
  const handler = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  assert.match(
    handler,
    /finally\(\(\) => \{[\s\S]*shutdownState\.clear/,
    'a completed shutdown leaves its note behind',
  );

  const force = MAIN.slice(MAIN.indexOf('const forceExitTimer'));
  assert.match(
    force.slice(0, force.indexOf('}, SHUTDOWN_TIMEOUTS.total')),
    /shutdownState\.clear/,
    'the force exit leaves a note whose pid the operating system may reuse, ' +
      'which would make the next launch wait on a process that is not Posnic',
  );
});

// ── Reopening while it closes ───────────────────────────────────────────────

test('a launch that cannot take the lock asks why before giving up', () => {
  const guard = MAIN.slice(MAIN.indexOf('if (!hasSingleInstanceLock)'));
  const body = guard.slice(0, guard.indexOf('\n}') + 2);

  assert.match(body, /findInProgress/, 'the launch cannot tell a running till from a closing one');
  assert.match(
    body,
    /if \(!waitingForPreviousShutdown\)[\s\S]*app\.exit\(0\)/,
    'the launch still exits unconditionally, so reopening during a shutdown ' +
      'does nothing and says nothing',
  );
});

test('waiting asks for the lock rather than trusting the pid to be gone', () => {
  /*
   * The old process can be gone a moment before the lock is actually released.
   * Starting on the strength of the pid alone would race, and losing that race
   * means two instances on one database.
   */
  const fn = MAIN.slice(MAIN.indexOf('async function awaitPreviousShutdown'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.match(body, /requestSingleInstanceLock/, 'the lock is never re-requested, so it is never acquired');
  assert.match(body, /showWaitingForPrevious/, 'nothing is shown while waiting');
  assert.match(body, /deadline/, 'the wait has no deadline and could hang the launch forever');
});

test('and gives up rather than running a second instance', () => {
  const ready = MAIN.slice(MAIN.indexOf('if (waitingForPreviousShutdown)'));
  const body = ready.slice(0, ready.indexOf('\n  }') + 4);

  assert.match(
    body,
    /app\.exit\(0\)/,
    'a launch that never gets the lock carries on anyway, which would put two ' +
      'instances on one database',
  );
  assert.match(body, /closeSplash\(\)/, 'the splash is left on screen spinning forever');
});

test('a launch arriving mid-shutdown is not treated as a duplicate', () => {
  /* It is somebody reopening the till, already waiting for this process to
     exit. Focusing windows that are hidden or half torn down fights that. */
  const fn = MAIN.slice(MAIN.indexOf("app.on('second-instance'"));
  const body = fn.slice(0, fn.indexOf('\n  });'));

  assert.match(
    body.slice(0, body.indexOf('focusPrimaryWindow')),
    /if \(shutdownInProgress\)[\s\S]*return;/,
    'a launch during shutdown still triggers a window focus on the instance ' +
      'that is going away',
  );
});

// ── What the screen says while it happens ───────────────────────────────────

test('the progress shown comes from the list that does the work', () => {
  /* Two lists would drift, and a screen that says "closing the database" while
     something else is running is worse than no screen. */
  assert.match(MAIN, /function shutdownSteps\(\)/, 'the shutdown is not a list that can be counted');

  const fn = MAIN.slice(MAIN.indexOf('async function performGracefulShutdown'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /shutdownSteps\(\)/, 'the shutdown does not walk the list');
  assert.match(body, /onProgress\(i, steps\.length/, 'nothing reports which step is running');
});

test('each step is named before it runs, not after', () => {
  /* The step that takes ten seconds should be named while it is taking them. */
  const fn = MAIN.slice(MAIN.indexOf('async function performGracefulShutdown'));
  const loop = fn.slice(fn.indexOf('for (let i = 0'), fn.indexOf('\n}'));
  const announced = loop.indexOf('onProgress');
  const ran = loop.indexOf('await withTimeout');

  assert.ok(announced > -1 && announced < ran, 'the step is announced after it has already finished');
});

test('the steps say what a shopkeeper would call them', () => {
  const fn = MAIN.slice(MAIN.indexOf('function shutdownSteps()'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.match(body, /Saving your data/, 'the long step does not say what it is doing');
  assert.doesNotMatch(
    body,
    /says:\s*'(Bundled MongoDB|API server)/,
    'the internal label is being shown to the shop; those names are for the log',
  );
});

test('the shutdown bar measures something real, unlike the startup one', () => {
  /*
   * Startup has no honest progress - a first run takes forty seconds and a
   * warm one takes two - so its bar moves and claims nothing. The shutdown is
   * a fixed list walked in order, so "4 of 5" is a fact.
   *
   * The startup behaviour has to survive this: it is the reason the animated
   * bar exists at all.
   */
  assert.match(SPLASH, /animation: slide/, 'the indeterminate startup bar is gone');
  assert.match(SPLASH, /\.bar\.steps i/, 'there is no determinate mode for the shutdown');
  assert.match(SPLASH, /function setShutdownProgress/, 'nothing can report a step');
  assert.doesNotMatch(
    SPLASH,
    /\b\d{1,3}%\s*(?:complete|done)/i,
    'a percentage is being claimed as a measure of time remaining',
  );
});

test('drawing the screen can never stop the shutdown', () => {
  /* A till that will not close is worse than one that closes quietly. */
  const fn = MAIN.slice(MAIN.indexOf('async function performGracefulShutdown'));
  const loop = fn.slice(fn.indexOf('for (let i = 0'), fn.indexOf('\n}'));

  assert.match(
    loop,
    /try \{ onProgress\([\s\S]*?\} catch/,
    'the progress callback is not guarded, so an error while drawing would ' +
      'abandon the shutdown partway through - with the database still open',
  );
});

test('and neither can a window that has already gone', () => {
  const fn = SPLASH.slice(SPLASH.indexOf('function setShutdownProgress'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.match(body, /if \(!win\) return/, 'it assumes a splash is on screen');
  assert.match(body, /isDestroyed\(\)/, 'it paints into a window that may be destroyed');
  assert.match(body, /catch/, 'an error mid-paint escapes');
});
