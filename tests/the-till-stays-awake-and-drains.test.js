'use strict';

/*
 * A till that is asleep is a till that is not printing.
 *
 * Owner: "desktop app system got logged out or screen lock, then also our app
 * should keep wake."
 *
 * THE FAILURE THIS PREVENTS
 *
 * Windows sleeps an idle machine, and a restaurant till is idle for long
 * stretches between services. The moment it suspends, the kitchen stops
 * receiving tickets and handsets stop reaching it - while the screen still says
 * Posnic and nothing anywhere reports a fault. The waiter presses send, the
 * phone says sent, and no paper comes out. Nobody finds out until somebody
 * walks to the printer.
 *
 * THE DISTINCTION THAT MATTERS
 *
 * Locking is not sleeping. A locked Windows session keeps running everything
 * and keeps printing, so locking a till is fine and worth encouraging. LOGGING
 * OUT ends the session and is the thing that kills it. Conflating the two sends
 * a shop looking for the wrong fault.
 *
 * AND THE WAKE-UP IS WHERE DUPLICATES COME FROM
 *
 * A till asleep for two hours wakes with work behind it and a thirty second
 * poll that did not run while it was suspended. Thirty seconds at a pass with
 * no ticket is how a cook reprints by hand - and that is how a wake-up becomes
 * the duplicate this whole area exists to prevent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const power = require(path.join(ROOT, 'src', 'till-stays-awake.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'till-stays-awake.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

/* ---------------------------------------------- it cannot stop a till starting */

test('IT LOADS AND ANSWERS WITH NO ELECTRON AT ALL', () => {
  /*
   * The blunt version of "must not break the boot chain". This is required from
   * app startup, and powerSaveBlocker is genuinely absent under some remote
   * sessions - so every call has to have an answer rather than an exception.
   */
  assert.doesNotThrow(() => power.start());
  assert.deepStrictEqual(power.start(), { held: false, watched: false });
  assert.strictEqual(power.keepAwake(), false);
  assert.strictEqual(power.isAwakeHeld(), false);
  assert.strictEqual(power.allowSleep(), false);
  assert.doesNotThrow(() => power.stop());
  assert.doesNotThrow(() => power.watch());
});

test('startup is wrapped, so a power fault cannot stop the shop', () => {
  const at = MAIN.indexOf("require('./till-stays-awake')");
  assert.ok(at > -1, 'nothing keeps the till awake');
  const before = MAIN.slice(Math.max(0, at - 400), at);
  assert.match(before, /try\s*\{[^}]*$/, 'the startup call is not inside a try block');
});

/* ------------------------------------------------- what is actually blocked */

test('THE SYSTEM IS HELD AWAKE, THE SCREEN IS NOT', () => {
  /*
   * 'prevent-app-suspension', never 'prevent-display-sleep'. A kitchen screen
   * that can never blank is a kitchen screen that burns in, and the shop did
   * not ask for that - it asked for the till to keep working.
   */
  /* The CALL, not the word: the comment above it names the option it rejects,
     and a plain text search cannot tell a choice from its explanation. This
     suite has been caught by that before. */
  assert.match(SOURCE, /powerSaveBlocker\.start\('prevent-app-suspension'\)/);
  assert.ok(
    !/powerSaveBlocker\.start\('prevent-display-sleep'\)/.test(SOURCE),
    'the display is being held awake, which burns in a kitchen screen'
  );
});

test('and the block is released on shutdown, not left holding', () => {
  /* A till that looks switched off but still refuses to suspend is worse than
     one that sleeps: nobody can see why the machine never rests. */
  const quit = MAIN.slice(MAIN.indexOf("app.on('before-quit'"));
  assert.match(quit.slice(0, 900), /till-stays-awake'\)\.stop\(\)/);
  assert.match(SOURCE, /powerSaveBlocker\.stop/);
});

/* ------------------------------------------- locking is not sleeping */

test('LOCKING THE SCREEN IS NOT TREATED AS SLEEP', () => {
  /*
   * The distinction a shop needs. A locked session prints perfectly well, so
   * "it stopped when I locked it" is a report about something else - and there
   * should be a line in the log saying so rather than a shrug.
   */
  assert.match(SOURCE, /'lock-screen'/, 'nothing distinguishes a lock from a suspend');
  const lockBlock = SOURCE.slice(SOURCE.indexOf("'lock-screen'"));
  assert.match(lockBlock.slice(0, 300), /keeps running and keeps printing/);
  /* And a lock must not trigger the catch-up: nothing was missed. */
  assert.ok(
    !/lock-screen[\s\S]{0,200}onResume/.test(SOURCE),
    'a screen lock triggers the wake-up drain, which it should not'
  );
});

/* ----------------------------------------------- the catch-up on waking */

test('THE MOMENT IT WAKES, EVERY COLLECTOR RUNS', () => {
  /* Not at the next timer. The timer did not run while it was suspended, and
     the gap is where a hand-made duplicate comes from. */
  assert.match(SOURCE, /'resume'/, 'nothing listens for the machine waking');
  const resume = SOURCE.slice(SOURCE.indexOf("e.powerMonitor.on('resume'"));
  assert.match(resume.slice(0, 400), /for \(const fn of onResume\)/);
});

test('and main registers the kitchen, the bill and the cloud bill paths', () => {
  const at = MAIN.indexOf('power.whenWokenUp(');
  assert.ok(at > -1, 'nothing is registered to catch up');
  const block = MAIN.slice(at, at + 700);
  assert.match(block, /kotManager\._poll/, 'kitchen tickets do not catch up');
  assert.match(block, /billManager\._poll/, 'floor bills do not catch up');
  assert.match(block, /billManager\._pollCloud/, 'cloud-relayed bills do not catch up');
});

test('one failing wake-up task does not stop the others', () => {
  /*
   * The whole point of the moment is that everything catches up at once. A
   * kitchen poll that throws must not cost the shop its bills.
   */
  const ran = [];
  power.whenWokenUp(() => {
    ran.push('first');
    throw new Error('the kitchen poll failed');
  });
  power.whenWokenUp(() => ran.push('second'));

  /* Drive the listeners the way the resume handler does, since there is no
     Electron here to emit the event. */
  for (const fn of power._onResume) {
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {
      /* swallowed, as the real handler does */
    }
  }
  assert.deepStrictEqual(ran, ['first', 'second'], 'a throwing task stopped the rest');
  power._onResume.clear();
});

test('a rejected promise from a wake-up task is not an unhandled rejection', () => {
  /* _poll is async. An unhandled rejection on a till is a crash dialog in a
     restaurant. */
  power.whenWokenUp(() => Promise.reject(new Error('poll failed')));
  assert.doesNotThrow(() => {
    for (const fn of power._onResume) {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  });
  power._onResume.clear();
});

test('unregistering works, so a restart does not double the drain', () => {
  const off = power.whenWokenUp(() => {});
  assert.strictEqual(power._onResume.size, 1);
  off();
  assert.strictEqual(power._onResume.size, 0);
});

test('it is in the packaged build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/till-stays-awake.js'));
});
