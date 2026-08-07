'use strict';
/*
 * A note the closing process leaves for the next one.
 *
 * Closing Posnic is not instant. mongod has to flush its journal and checkpoint
 * before it can exit, and until it has, the process is still alive and still
 * holding the single-instance lock.
 *
 * So there is a window - a few seconds, sometimes ten - where the till looks
 * closed and is not. Double-click the icon in that window and the new process
 * fails to take the lock and exits without a word. To the shop, the icon simply
 * stopped working: no window, no error, nothing to report. They click again,
 * and it does it again.
 *
 * That is what this file exists to prevent. The closing process writes a note
 * saying "still going, this is my pid"; a launch that cannot get the lock reads
 * it and knows the difference between "another till is open" - focus it - and
 * "the last one is still closing" - wait, say so, then start.
 *
 * The note is a file rather than anything cleverer because it has to survive
 * the writer being killed. If Posnic is force-quit halfway through, no `finally`
 * runs and no port stays open, but the file is still there - so every reader
 * checks whether the pid is actually alive rather than trusting the file to
 * have been cleaned up.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'shutting-down.json';

function markerPath(userDataDir) {
  return path.join(userDataDir, FILE);
}

/**
 * Say that this process has started closing.
 *
 * Called at the top of the shutdown, before any of the slow work, because the
 * whole point is to cover the slow part.
 */
function begin(userDataDir) {
  try {
    fs.writeFileSync(
      markerPath(userDataDir),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return true;
  } catch (e) {
    /* Nothing here is worth failing a shutdown over. Without the note the next
       launch behaves as it did before this file existed, which is survivable. */
    return false;
  }
}

/** Say that it finished. Safe to call when begin() never ran. */
function clear(userDataDir) {
  try {
    fs.unlinkSync(markerPath(userDataDir));
  } catch (e) {
    /* already gone, or never written */
  }
}

/*
 * Is a process still running?
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. EPERM means it exists and belongs to somebody else, which for this
 * purpose is still "alive" - and on Windows that case is what a process being
 * torn down by the installer looks like.
 */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Is a previous instance still closing?
 *
 * @returns {{pid:number, startedAt:string, ageMs:number}|null}
 *
 * Returns null for a stale note - one whose process is gone, or one old enough
 * that it cannot be a real shutdown any more. Both matter: a note left by a
 * crash would otherwise make every future launch wait for a process that is
 * never going to exit.
 */
function findInProgress(userDataDir, now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(markerPath(userDataDir), 'utf8');
  } catch (e) {
    return null;   // no note: nothing was closing
  }

  let note;
  try {
    note = JSON.parse(raw);
  } catch (e) {
    clear(userDataDir);
    return null;
  }

  if (!isAlive(note.pid)) {
    /* The writer is gone, so whatever it was doing is over. Tidy up so the
       next launch does not have to work this out again. */
    clear(userDataDir);
    return null;
  }

  const ageMs = now - Date.parse(note.startedAt || 0);

  /*
   * A shutdown is budgeted at 25 seconds and force-exits at that point, so a
   * note older than a minute is not a shutdown in progress - it is a pid that
   * was reused, or a process wedged somewhere it will not come back from.
   *
   * Believing it would be the worse failure: the launch would sit waiting for
   * a shutdown that never ends, and the shop would be left with a splash
   * screen instead of a till.
   */
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60_000) {
    return null;
  }

  return { pid: note.pid, startedAt: note.startedAt, ageMs };
}

module.exports = { begin, clear, findInProgress, isAlive, markerPath };
