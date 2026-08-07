/**
 * Update Integration
 *
 * Wires UpdateService into the Electron main process via IPC.
 * UpdateService already broadcasts events to all open windows itself,
 * so no mainWindow reference is needed here.
 */

const { ipcMain: rawIpcMain } = require('electron');
/*
 * Every handler below is registered through the guard, which refuses a message
 * from any frame that is not one of this application's own pages. See
 * ipc-guard.js for what counts as one.
 */
const ipcMain = require('./ipc-guard').guard(rawIpcMain);
const UpdateService = require('./update-service');

let _svc = null;

function setupUpdateIPC(options = {}) {
  if (_svc) return _svc; // guard against double-init
  _svc = new UpdateService(options);

  // ── IPC handlers ────────────────────────────────────────────────────────

  ipcMain.handle('update:get-status', () => _svc.getStatus());

  ipcMain.handle('update:check', async () => {
    try { return await _svc.checkForUpdates(); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('update:download', async () => {
    try { return await _svc.downloadUpdate(); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('update:install', async () => {
    try { return await _svc.quitAndInstall(); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('update:config-get', () => ({
    success: true, config: _svc.loadConfig()
  }));

  ipcMain.handle('update:config-save', (_e, patch) => _svc.saveConfig(patch));

  /*
   * update:save-token and update:has-token are gone.
   *
   * They let the Updates window ask a shopkeeper for a GitHub token so the
   * updater could reach a private repository. Releases are public, so the token
   * bought nothing; it asked for a credential no shop has; and it wrote that
   * credential to disk in plain text. See update-service.js for the full
   * reasoning. A private channel, if ever needed, belongs in a separate build.
   */

  /*
   * Going back.
   *
   * Rolling back was reachable only from a menu item most shopkeepers will
   * never open, which is the wrong place for the one thing you want at the
   * moment an update has gone wrong. It belongs beside the button that applied
   * the update.
   *
   * Deliberately a pointer move and a restart rather than a download: the
   * machine most likely to need this is the one that cannot reach us. It
   * touches application files only - sales, items, customers and settings are
   * not part of the versioned set.
   */
  ipcMain.handle('update:revert-status', () => {
    try {
      const updater = options.assetUpdater;
      if (!updater) return { success: true, available: false, reason: 'not-configured' };
      const status = updater.status();
      return {
        success: true,
        available: Boolean(status.active && status.previous),
        active: status.active || null,
        previous: status.previous || null,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('update:revert', () => {
    try {
      const updater = options.assetUpdater;
      if (!updater) return { success: false, error: 'Reverting is not available in this build.' };

      const status = updater.status();
      if (!status.active || !status.previous) {
        return { success: false, error: 'This installation is running the version it was installed with.' };
      }

      const result = updater.revert();
      if (!result.ok) return { success: false, error: result.reason || 'unknown' };

      /* Restart so the reverted files are the ones loaded. Scheduled after the
         reply so the window is not asking a process that has already gone. */
      const { app } = require('electron');
      setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
      return { success: true, revertedTo: status.previous };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Start auto-check on startup ──────────────────────────────────────────
  _svc.startAutoCheck();

  return _svc;
}

module.exports = { setupUpdateIPC };
