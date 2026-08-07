'use strict';
/*
 * The till's side of the PIN lock.
 *
 * Everything to do with the PIN happens here in the main process, not in the
 * page: the encrypted blob, the key derivation and the attempt limit all sit
 * behind IPC. A renderer can ask to unlock and is given a session or refused -
 * it is never given anything it could use to try faster or to read the blob
 * itself.
 */

const path = require('path');
const { PinLock } = require('./pin-lock');

let _lock = null;

function getLock(app, installSecret) {
  if (!_lock) {
    _lock = new PinLock({
      file: path.join(app.getPath('userData'), 'pin-lock.json'),
      installSecret,
    });
  }
  return _lock;
}

function registerPinLockIPC(rawIpcMain, app, installSecret) {
  /* Guarded: the PIN lock decides whether the till is unlocked, so a frame
     that is not ours must not be able to ask it anything. */
  const ipcMain = require('./ipc-guard').guard(rawIpcMain);
  const lock = getLock(app, installSecret);

  // Who can unlock this till. Safe to show on a lock screen: names only, and
  // only of people who have already signed in here with a password.
  ipcMain.handle('lock:users', () => lock.list());

  ipcMain.handle('lock:is-enrolled', (event, username) => lock.isEnrolled(username));

  /*
   * Remember a user behind a PIN. Only reachable after a password login,
   * because only a password login has a session to hand over.
   */
  ipcMain.handle('lock:enroll', (event, details = {}) => {
    try {
      return lock.enroll(details);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('lock:unlock', (event, details = {}) => {
    try {
      return lock.unlock(details);
    } catch (err) {
      return { success: false, reason: 'error', error: err.message };
    }
  });

  ipcMain.handle('lock:forget', (event, username) => {
    try {
      return lock.forget(username);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('lock:forget-all', () => {
    try {
      return lock.forgetAll();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerPinLockIPC, getLock };
