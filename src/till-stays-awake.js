'use strict';

/*
 * A TILL THAT IS ASLEEP IS A TILL THAT IS NOT PRINTING.
 *
 * Owner: "desktop app system got logged out or screen lock, then also our app
 * should keep wake."
 *
 * THE FAILURE, WHICH NEEDS NO QUEUE TO HURT
 *
 * Windows sleeps an idle machine. A restaurant till is idle for long stretches
 * between services, and the moment it sleeps the kitchen stops receiving
 * tickets and handsets stop reaching it - while the screen still says Posnic
 * and nothing anywhere reports a fault. The waiter presses send, the phone says
 * sent, and no paper comes out. Nobody finds out until somebody walks to the
 * printer.
 *
 * Two separate things are needed and they are routinely confused:
 *
 *   SLEEP is the machine suspending. It stops the process, the network and the
 *   printer. That is what powerSaveBlocker prevents.
 *
 *   THE LOCK SCREEN is not sleep. A locked Windows session keeps running
 *   everything, and printing continues. So locking the till is fine and should
 *   be encouraged - it is LOGGING OUT that kills it, because the session ends.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not keep the machine awake for ever. A till blocked from sleeping
 * around the clock runs hotter, wears its disk, and takes Windows updates at
 * whatever hour it likes. The block is held while the shop is trading and
 * released when it is not, which is the honest version of "keep awake".
 *
 * And it never blocks the DISPLAY from turning off, only the system from
 * suspending. A kitchen screen that cannot blank is a kitchen screen that burns
 * in.
 *
 * NOTHING HERE MAY THROW. Every one of these APIs is optional in a way the
 * documentation does not admit: powerSaveBlocker is absent under some remote
 * sessions, and powerMonitor emits nothing on a machine with no ACPI. A till
 * must start and sell whatever this module manages to do.
 */

/* Required lazily so the module loads and can be tested outside Electron. */
function electron() {
  try {
    return require('electron');
  } catch (e) {
    return null;
  }
}

let blockerId = null;
let watching = false;
const onResume = new Set();

/**
 * Stop the machine suspending while the shop is trading.
 *
 * 'prevent-app-suspension', NOT 'prevent-display-sleep': the screen may still
 * blank, and should. Only the system is held awake.
 */
function keepAwake() {
  const e = electron();
  if (!e || !e.powerSaveBlocker) return false;
  try {
    if (blockerId !== null && e.powerSaveBlocker.isStarted(blockerId)) return true;
    blockerId = e.powerSaveBlocker.start('prevent-app-suspension');
    console.log('[power] the till will not sleep while it is trading');
    return true;
  } catch (err) {
    console.warn('[power] could not hold the machine awake:', err && err.message);
    blockerId = null;
    return false;
  }
}

/** Let it sleep again. Called when the shop stops trading, and on shutdown. */
function allowSleep() {
  const e = electron();
  if (!e || !e.powerSaveBlocker || blockerId === null) return false;
  try {
    if (e.powerSaveBlocker.isStarted(blockerId)) e.powerSaveBlocker.stop(blockerId);
  } catch (err) {
    /* Releasing a block that is already gone is not a problem. */
  }
  blockerId = null;
  return true;
}

/** Is the machine currently being held awake? */
function isAwakeHeld() {
  const e = electron();
  if (!e || !e.powerSaveBlocker || blockerId === null) return false;
  try {
    return e.powerSaveBlocker.isStarted(blockerId);
  } catch (err) {
    return false;
  }
}

/**
 * Do this the moment the machine wakes, rather than at the next timer.
 *
 * A till that has been asleep for two hours wakes with a queue behind it, and
 * the poll that would collect it is on a thirty second timer that did not run
 * while it was suspended. Thirty seconds is a long time to stand at a pass with
 * no ticket, and the first thing a cook does is print it again by hand - which
 * is how a wake-up turns into a duplicate.
 *
 * Registered rather than called directly, so the printing code owns what
 * "drain" means and this module owns only the timing.
 */
function whenWokenUp(fn) {
  if (typeof fn === 'function') onResume.add(fn);
  return () => onResume.delete(fn);
}

/**
 * Listen for the machine suspending and resuming.
 *
 * Safe to call repeatedly. 'resume' is the one that matters; 'suspend' is
 * logged because a shop asking "why did the kitchen go quiet at 3pm" deserves
 * an answer in its own log rather than a shrug.
 */
function watch() {
  const e = electron();
  if (!e || !e.powerMonitor || watching) return false;
  watching = true;
  try {
    e.powerMonitor.on('suspend', () => {
      console.warn('[power] the machine is suspending - nothing will print until it wakes');
    });

    e.powerMonitor.on('resume', () => {
      console.log('[power] awake again, collecting anything that arrived');
      for (const fn of onResume) {
        try {
          const r = fn();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch (err) {
          /* One listener failing must not stop the others: the whole point of
             this moment is that everything catches up at once. */
          console.warn('[power] a wake-up task failed:', err && err.message);
        }
      }
    });

    /*
     * Locking is NOT sleeping and must not be treated as it. Logged only, so
     * that when a shop reports "it stopped when I locked it" there is a line
     * saying the session kept running and the cause is elsewhere.
     */
    e.powerMonitor.on('lock-screen', () => {
      console.log('[power] screen locked - the till keeps running and keeps printing');
    });

    return true;
  } catch (err) {
    console.warn('[power] power events unavailable:', err && err.message);
    watching = false;
    return false;
  }
}

/** Everything, wrapped, for one call at startup. Never throws. */
function start() {
  try {
    const held = keepAwake();
    const watched = watch();
    return { held, watched };
  } catch (err) {
    console.warn('[power] did not start:', err && err.message);
    return { held: false, watched: false };
  }
}

function stop() {
  try {
    allowSleep();
  } catch (err) {
    /* ignored */
  }
}

module.exports = {
  keepAwake,
  allowSleep,
  isAwakeHeld,
  whenWokenUp,
  watch,
  start,
  stop,
  /* For tests, which need to see the registered wake-up tasks. */
  _onResume: onResume,
};
