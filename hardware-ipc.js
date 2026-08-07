const { ipcMain: rawIpcMain, app, dialog, BrowserWindow } = require('electron');
/*
 * Every handler below is registered through the guard, which refuses a message
 * from any frame that is not one of this application's own pages. See
 * ipc-guard.js for what counts as one.
 */
const ipcMain = require('./ipc-guard').guard(rawIpcMain);
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EssaeWeightReader, ESSAE_DEFAULTS } = require('./essae-weight-reader');

// Network scale settings live beside the other app data so a shop keeps its
// configuration across updates.
let _essaeReader = null;
function essaeConfigPath() {
  return path.join(app.getPath('userData'), 'essae-scale.json');
}
function loadEssaeConfig() {
  try { return { ...ESSAE_DEFAULTS, ...JSON.parse(fs.readFileSync(essaeConfigPath(), 'utf8')) }; }
  catch { return { ...ESSAE_DEFAULTS }; }
}
function saveEssaeConfig(config) {
  try { fs.writeFileSync(essaeConfigPath(), JSON.stringify(config, null, 2)); }
  catch (err) { console.warn('[EssaeScale] could not save config:', err.message); }
}
function getEssaeReader() {
  if (!_essaeReader) _essaeReader = new EssaeWeightReader(loadEssaeConfig());
  return _essaeReader;
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      candidates.push({ name, address: iface.address });
    }
  }

  if (!candidates.length) {
    return '127.0.0.1';
  }

  // Score IPs so we prefer real LAN addresses over host-only / link-local
  function score(ip) {
    if (ip.startsWith('10.')) return 100; // common Wi-Fi/LAN (10.x.x.x)
    if (ip.startsWith('192.168.56.')) return 10; // VirtualBox host-only (de-prioritize)
    if (ip.startsWith('192.168.')) return 90; // other 192.168.x.x

    const parts = ip.split('.');
    if (parts[0] === '172') {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return 80; // 172.16.0.0/12 private range
    }

    if (ip.startsWith('169.254.')) return 1; // link-local, avoid if possible

    return 50; // anything else
  }

  candidates.sort((a, b) => score(b.address) - score(a.address));
  return candidates[0].address || '127.0.0.1';
}

let _ipcSetupDone = false;

// Hardware Manager IPC Handlers
function setupHardwareIPC(hardwareManager, kotManager) {
  if (_ipcSetupDone) {
    console.log('Hardware IPC handlers already registered, skipping duplicate call');
    return;
  }
  _ipcSetupDone = true;
  
  // Serial Port Handlers
  ipcMain.handle('hardware:scan-ports', async (event, enableSimulation = false) => {
    return await hardwareManager.scanSerialPorts(enableSimulation);
  });

  ipcMain.handle('hardware:connect-port', async (event, portPath, isMock = false) => {
    return await hardwareManager.connectPort(portPath, isMock);
  });

  ipcMain.handle('hardware:disconnect-port', async () => {
    return await hardwareManager.disconnectPort();
  });

  ipcMain.handle('hardware:get-status', () => {
    return hardwareManager.getConnectionStatus();
  });

  ipcMain.handle('hardware:broadcast-weight', () => {
    hardwareManager.broadcastLastWeight();
    return { success: true };
  });

  // Essae network scale (TCP/IP). Settings persist so a shop configures its
  // scale once; defaults match the device's factory address.
  ipcMain.handle('essae:connect', async (event, options = {}) => {
    try {
      const reader = getEssaeReader();
      if (options && Object.keys(options).length) {
        reader.configure(options);
      }
      reader.start();
      // Recorded so the scale comes back on its own after a restart. Saved
      // whether or not options came with this call: connecting with the
      // address already stored is still a shop saying "use this scale".
      saveEssaeConfig({ ...reader.getConfig(), enabled: true });
      return { success: true, status: reader.status() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('essae:disconnect', () => {
    if (_essaeReader) _essaeReader.stop();
    // Stays off across restarts, or auto-start would undo the disconnect the
    // next time the app opened.
    saveEssaeConfig({ ...loadEssaeConfig(), enabled: false });
    return { success: true };
  });

  ipcMain.handle('essae:status', () => getEssaeReader().status());

  ipcMain.handle('essae:save-config', (event, options = {}) => {
    const config = getEssaeReader().configure(options);
    saveEssaeConfig(config);
    return { success: true, config };
  });

  // Printer Handlers
  ipcMain.handle('printer:list', async () => {
    return await hardwareManager.listPrinters();
  });

  ipcMain.handle('printer:get-default', async () => {
    return await hardwareManager.getDefaultPrinter();
  });

  ipcMain.handle('printer:get-config', async () => {
    const defaultPrinter = await hardwareManager.getDefaultPrinter();
    const paperSize = preferences['paper_size'] || '3inch';
    return {
      printerName: defaultPrinter ? defaultPrinter.name : '',
      paperSize: paperSize
    };
  });

  /*
   * Print a receipt as ESC/POS rather than as a page.
   *
   * The browser keeps printing HTML, because its print dialog scales the page
   * to fit and that has worked for years. A silent print has no dialog and no
   * scaling, so the desktop app builds the receipt as characters and control
   * codes instead - the printer's own language, where a line either fits in 48
   * columns or it does not, and that is decidable before anything reaches the
   * paper.
   */
  ipcMain.handle('printer:print-receipt', async (event, sale, options = {}) => {
    try {
      const { renderSale } = require('./escpos-receipt');
      const bytes = renderSale(sale || {}, {
        paperWidth: options.paperWidth || '80',
        openDrawer: !!options.openDrawer,
        drawerPin: options.drawerPin,
        cut: options.cut !== false,
      });
      return await hardwareManager.sendRawToPrinter(
        options.printerName, bytes, options.docName || 'Posnic Receipt');
    } catch (err) {
      console.error('[Print] receipt render failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  /*
   * A report on a roll, as ESC/POS.
   *
   * The renderer lives here rather than in the page because the page cannot
   * require it - and because the shape of a report is data, not markup. The
   * caller declares its sections and this decides how they land on the paper.
   */
  ipcMain.handle('printer:print-report', async (event, doc, options = {}) => {
    try {
      const { renderReport } = require('./escpos-report');
      const bytes = renderReport(doc || {}, {
        paperWidth: options.paperWidth || '80',
        cut: options.cut !== false,
      });
      return await hardwareManager.sendRawToPrinter(
        options.printerName, bytes, options.docName || 'Posnic Report');
    } catch (err) {
      console.error('[Print] report render failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:print', async (event, htmlContent, options) => {
    return await hardwareManager.printHTML(htmlContent, options);
  });

  // Preferences Handlers (file-based persistence)
  const _prefsPath = path.join(app.getPath('userData'), 'preferences.json');

  function _loadPrefs() {
    try {
      if (fs.existsSync(_prefsPath)) {
        return JSON.parse(fs.readFileSync(_prefsPath, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return {};
  }

  function _savePrefs(prefs) {
    try {
      fs.writeFileSync(_prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  const preferences = _loadPrefs();

  /*
   * Bring the shop's hardware back up by itself.
   *
   * Hardware Manager has always saved the chosen scale port, and the Essae
   * network scale has always saved its address - but nothing read either back
   * at startup. So every restart of the app left the till with no scale until
   * somebody went into Hardware Manager and pressed Connect, which is what a
   * shop describes as the weight machine "not working".
   *
   * Deferred a moment so a scale that is slow to enumerate over USB has
   * appeared before the first attempt, and failure is quiet: the till has to
   * open whether or not a scale is plugged in.
   */
  setTimeout(() => {
    const savedScale = preferences['hardware.weightMachine'];
    if (savedScale && savedScale.port) {
      hardwareManager.autoConnectSaved(savedScale).catch((err) =>
        console.warn('[Scale] auto-connect failed:', err.message));
    }

    const essaeConfig = loadEssaeConfig();
    if (essaeConfig && essaeConfig.enabled) {
      try {
        getEssaeReader().start();
        console.log('[EssaeScale] started from saved configuration');
      } catch (err) {
        console.warn('[EssaeScale] auto-start failed:', err.message);
      }
    }
  }, 3000);

  ipcMain.handle('preferences:get', (event, key) => {
    return preferences[key] ?? null;
  });

  ipcMain.handle('preferences:set', (event, key, value) => {
    preferences[key] = value;
    _savePrefs(preferences);
    if (key === 'mobile.maxDevices' && global.mobileTracker) {
      global.mobileTracker.maxDevices = Math.max(1, parseInt(value, 10) || 6);
    }
    return { success: true };
  });

  // ── Mobile Device Persistence ─────────────────────────
  const _mobileDevicesPath = path.join(app.getPath('userData'), 'mobile-devices.json');
  const _blockedIPsPath    = path.join(app.getPath('userData'), 'blocked-ips.json');

  function _loadPersistedDevices() {
    try {
      if (fs.existsSync(_mobileDevicesPath)) return JSON.parse(fs.readFileSync(_mobileDevicesPath, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
  }

  function _loadBlockedIPs() {
    try {
      if (fs.existsSync(_blockedIPsPath)) {
        const arr = JSON.parse(fs.readFileSync(_blockedIPsPath, 'utf8'));
        return new Set(Array.isArray(arr) ? arr : []);
      }
    } catch (e) { /* ignore */ }
    return new Set();
  }

  function _savePersistedDevices() {
    try {
      fs.writeFileSync(_mobileDevicesPath, JSON.stringify(global.mobileTracker?.devices || {}, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  function _saveBlockedIPs() {
    try {
      const arr = [...(global.mobileTracker?.blockedIPs || [])];
      fs.writeFileSync(_blockedIPsPath, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  // Ensure tracker is always initialized with persisted data
  const _savedMaxDevices = Math.max(1, parseInt(preferences['mobile.maxDevices'], 10) || 6);
  if (!global.mobileTracker) {
    global.mobileTracker = { devices: _loadPersistedDevices(), loginLogs: [], blockedIPs: _loadBlockedIPs(), maxDevices: _savedMaxDevices };
  } else {
    if (!global.mobileTracker.blockedIPs) global.mobileTracker.blockedIPs = _loadBlockedIPs();
    global.mobileTracker.maxDevices = _savedMaxDevices;
    if (!global.mobileTracker.devices || !Object.keys(global.mobileTracker.devices).length) {
      global.mobileTracker.devices = { ...global.mobileTracker.devices, ..._loadPersistedDevices() };
    }
  }

  // Mobile Device Connection Handlers
  //
  // The port is read here rather than fixed at 5555: it is derived per
  // installation now, so the address handed to a phone was one nothing
  // listened on and every attempt to pair simply timed out.
  ipcMain.handle('mobile:get-info', () => {
    const ip = getLocalIP();
    const port = Number(process.env.PORT) || 5555;
    return { localIP: ip, port, apiUrl: `http://${ip}:${port}`, appUrl: `http://${ip}:${port}` };
  });

  /*
   * The Table Order APK handlers stood here.
   *
   * They served builds/mobile/POSNICPRO-TO.apk, an 8.3MB Capacitor build of the
   * table-ordering app - marked variant "debug" and versionName "unknown" in its
   * own manifest. A debug APK is signed with a keystore that is public by
   * design, so it was never something to hand to a shop, and the feature is not
   * in use. Removed with the binary rather than left pointing at a file that is
   * no longer shipped.
   */

  ipcMain.handle('mobile:get-devices', () => {
    const devices = Object.values(global.mobileTracker?.devices || {})
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    _savePersistedDevices();
    return devices;
  });

  ipcMain.handle('mobile:get-logs', () => {
    return global.mobileTracker?.loginLogs || [];
  });

  ipcMain.handle('mobile:block-device', (event, ip) => {
    if (global.mobileTracker) {
      if (!global.mobileTracker.blockedIPs) global.mobileTracker.blockedIPs = new Set();
      global.mobileTracker.blockedIPs.add(ip);
      delete global.mobileTracker.devices[ip]; // evict from slot so a new device can fill it
      _saveBlockedIPs();
      _savePersistedDevices();
    }
    return { success: true };
  });

  ipcMain.handle('mobile:remove-device', (event, ip) => {
    if (global.mobileTracker) {
      delete global.mobileTracker.devices[ip];
      _savePersistedDevices();
    }
    return { success: true };
  });

  ipcMain.handle('mobile:get-blocked', () => {
    return [...(global.mobileTracker?.blockedIPs || [])];
  });

  ipcMain.handle('mobile:unblock-device', (event, ip) => {
    if (global.mobileTracker?.blockedIPs) {
      global.mobileTracker.blockedIPs.delete(ip);
      delete global.mobileTracker.devices[ip]; // ensure fresh re-registration on reconnect (limit check applies)
      _saveBlockedIPs();
      _savePersistedDevices();
    }
    return { success: true };
  });

  ipcMain.handle('mobile:clear', () => {
    if (global.mobileTracker) {
      global.mobileTracker.devices = {};
      global.mobileTracker.loginLogs = [];
      // Note: blockedIPs intentionally NOT cleared here
      _savePersistedDevices();
    }
    return { success: true };
  });

  // Printer set-default (saves to preferences)
  ipcMain.handle('printer:set-default', (event, printerName) => {
    preferences['defaultPrinter'] = printerName;
    _savePrefs(preferences);
    return { success: true };
  });

  // ── Cash Drawer Handlers ─────────────────────────────
  ipcMain.handle('cashDrawer:load-config', () => {
    return hardwareManager.loadCashDrawerConfig();
  });

  ipcMain.handle('cashDrawer:save-config', (event, config) => {
    return hardwareManager.saveCashDrawerConfig(config);
  });

  ipcMain.handle('cashDrawer:open-via-printer', async (event, printerName, pin) => {
    return await hardwareManager.openCashDrawerViaPrinter(printerName, Number(pin) || 0);
  });

  // ── KOT Handlers ─────────────────────────────────────
  ipcMain.handle('kot:get-config', async () => {
    if (!kotManager) {
      return { branchId: '', printerNames: [], apiUrl: `http://127.0.0.1:${Number(process.env.PORT) || 5555}/api` };
    }
    return await kotManager.loadConfig();
  });

  ipcMain.handle('kot:start-polling', async (event, config) => {
    if (!kotManager) return { success: false, error: 'KOT manager not initialized' };
    await kotManager.startPolling(config);
    return { success: true };
  });

  ipcMain.handle('kot:stop-polling', () => {
    if (!kotManager) return { success: false, error: 'KOT manager not initialized' };
    kotManager.stopPolling();
    return { success: true };
  });

  ipcMain.handle('kot:get-status', () => {
    if (!kotManager) return { isPolling: false };
    return kotManager.getStatus();
  });

  ipcMain.handle('kot:get-logs', (event, date) => {
    if (!kotManager) return [];
    return kotManager.getLogs(date);
  });

  ipcMain.handle('kot:delete-log', (event, date, logId) => {
    if (!kotManager) return { success: false, error: 'KOT manager not initialized' };
    return kotManager.deleteLog(date, logId);
  });

  ipcMain.handle('kot:reprint', async (event, logEntry) => {
    if (!kotManager) return { success: false, error: 'KOT manager not initialized' };
    return await kotManager.reprint(logEntry);
  });

  console.log('Hardware IPC handlers registered');
}

module.exports = { setupHardwareIPC };
