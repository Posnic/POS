'use strict';

/* Prevent automatic system sleep only while kitchen printing is active.
 * The screen may turn off and lock normally. This cannot prevent forced sleep,
 * Windows logout, or a USB extender/device from losing its connection.
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
function start(enabled = false) {
  try {
    const held = setKitchenPrinting(enabled);
    const watched = watch();
    return { held, watched };
  } catch (err) {
    console.warn('[power] did not start:', err && err.message);
    return { held: false, watched: false };
  }
}

function setKitchenPrinting(enabled) {
  if (enabled === true) return keepAwake();
  allowSleep();
  return false;
}

function stop() {
  try {
    allowSleep();
  } catch (err) {
    /* ignored */
  }
}

module.exports = {
  setKitchenPrinting,
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
