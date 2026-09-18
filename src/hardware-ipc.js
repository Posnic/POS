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

/*
 * The branches this till serves.
 *
 * Module scope rather than inside setupHardwareIPC, because two callers need
 * it now: the Hardware Manager screen offering a list, and the bill poller
 * working out which shop to ask about. Two copies of a Mongo connection and a
 * credentials-file lookup is two places to fix the day either changes.
 */
async function readLocalBranches() {
  let client = null;
  try {
    const { MongoClient } = require('mongodb');
    let uri = `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;
    const credFile = path.join(app.getPath('userData'), '.mongodb-credentials.json');
    if (fs.existsSync(credFile)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (creds.uri) uri = creds.uri;
      } catch (e) { /* fall through to the default */ }
    }
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    /* module_captain_enable rides along because the handset reachability check
       needs it and has no database of its own. It is a settings field on the
       branch document, and the branch document is already open. */
    const rows = await client.db('PosnicPro').collection('branches')
      .find({}, { projection: { branch_name: 1, module_captain_enable: 1 } }).toArray();
    return rows.map((b) => ({
      id: String(b._id),
      name: b.branch_name || String(b._id),
      module_captain_enable: b.module_captain_enable,
    }));
  } catch (e) {
    /* A shop with no database yet is a normal state during setup, not a
       fault. The screen still works; it just cannot offer a list. */
    return [];
  } finally {
    if (client) { try { await client.close(); } catch (e) { /* ignore */ } }
  }
}


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
function setupHardwareIPC(hardwareManager, kotManager, billManager) {
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
  /* Hardware Manager's chooser, and anything else asking a person to pick:
     always the real list, never a remembered one. */
  ipcMain.handle('printer:list', async () => {
    return await hardwareManager.listPrinters({ fresh: true });
  });

  ipcMain.handle('printer:get-default', async () => {
    return await hardwareManager.getDefaultPrinter();
  });

  /* The paper catalogue, so the screen offers exactly what the print layer
     can honour. Sent over IPC rather than copied into the HTML, because two
     lists drift and the one that drifts is the one nobody tests. */
  ipcMain.handle('printer:get-paper-sizes', () => {
    const { PAPER_SIZES, DEFAULT_PAGE_SIZE, MAX_COPIES } = require('./printer-targets');
    return {
      sizes: Object.entries(PAPER_SIZES).map(([key, v]) => ({ key, label: v.label, roll: v.roll })),
      defaultSize: DEFAULT_PAGE_SIZE,
      maxCopies: MAX_COPIES,
    };
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
    /*
     * Every receipt is written down, printed or not.
     *
     * Kitchen tickets have had a day's log with a screen for a long time;
     * receipts had nothing at all. When a customer says their bill never came
     * out there was no way to tell whether the till had tried, which printer
     * it went to, or what the printer said back.
     *
     * TRIED is the half that matters. A receipt that failed is the one
     * somebody is asking about, and a log of successes only is silent at
     * exactly the moment it is needed.
     */
    const startedAt = Date.now();
    const receiptLog = require('./receipt-log');
    try {
      const { renderSale } = require('./escpos-receipt');
      const { normalizeTargets, columnsFor } = require('./printer-targets');

      /*
       * One receipt can now go to several printers, each with its own paper and
       * its own number of copies - a counter roll and a duplicate for the file,
       * or a second copy to the back office.
       *
       * normalizeTargets accepts the old { printerName, paperWidth } this used
       * to take, so the sale screen keeps working untouched while the Hardware
       * Manager starts sending a printers[] list.
       */
      const targets = normalizeTargets(
        options.printers && options.printers.length
          ? { printers: options.printers }
          : { printerName: options.printerName, paperSize: options.paperWidth },
        options.paperWidth
      );

      /*
       * A LOGO THE PAGE WAS NOT ALLOWED TO READ.
       *
       * receipt-data.js prepares the logo in the page, where the image is
       * already decoded and it costs nothing. When the canvas is tainted -
       * a logo served from another origin without CORS headers - it hands
       * over `{ src }` instead of dots, because a page can never read those
       * pixels however it asks.
       *
       * Here there is no origin and no canvas, only Chromium's decoder, so
       * the picture the page was refused is simply a file. Resolved once per
       * paper width rather than per target: two 80mm printers want the same
       * bitmap, and fetching it twice is a second round trip for nothing.
       */
      const logoFor = new Map();
      async function logoDots(paperWidth) {
        if (!sale || !sale.logo || sale.logo.data || !sale.logo.src) {
          return sale ? sale.logo : null;
        }
        if (logoFor.has(paperWidth)) return logoFor.get(paperWidth);

        const { rasterFor } = require('./escpos-logo');
        const { nativeImage, net } = require('electron');
        const raster = await rasterFor(sale.logo.src, paperWidth, {
          decode: (buf) => nativeImage.createFromBuffer(buf),
          readFile: (file) => require('fs').readFileSync(file),
          get: (url, limits) =>
            new Promise((done) => {
              /* Never rejects: a logo is decoration and a receipt is not. */
              let finished = false;
              const settle = (v) => {
                if (!finished) { finished = true; done(v); }
              };
              const timer = setTimeout(() => settle(null), limits.timeout);
              try {
                const req = net.request(url);
                const chunks = [];
                let size = 0;
                req.on('response', (res) => {
                  res.on('data', (c) => {
                    size += c.length;
                    if (size > limits.limit) { req.abort(); settle(null); return; }
                    chunks.push(c);
                  });
                  res.on('end', () => { clearTimeout(timer); settle(Buffer.concat(chunks)); });
                  res.on('error', () => { clearTimeout(timer); settle(null); });
                });
                req.on('error', () => { clearTimeout(timer); settle(null); });
                req.end();
              } catch (e) {
                clearTimeout(timer);
                settle(null);
              }
            }),
        });
        if (!raster) {
          console.warn('[Print] the logo could not be read here either, printing without it');
        }
        logoFor.set(paperWidth, raster);
        return raster;
      }

      const results = [];
      for (const target of targets) {
        /* Rendered per target: an 80mm roll is 48 columns and a 58mm roll is
           32, so the same bytes cannot serve both. Getting this wrong wraps the
           total onto its own line, which looks like a rounding bug on paper. */
        const paperWidth = String(columnsFor(target.pageSize));
        /* eslint-disable-next-line no-await-in-loop -- one fetch, cached
           per paper width, and the loop is serial anyway. */
        const logo = await logoDots(paperWidth);
        const bytes = renderSale({ ...(sale || {}), logo }, {
          paperWidth,
          /* A printer that cannot be taught a glyph spells the currency
             instead. Per machine, like the printer name. */
          symbolGlyphs: options.symbolGlyphs !== false,
          /* The drawer opens once, on the first sheet. Pulsing it per copy
             would have it kick three times for a three-copy receipt. */
          openDrawer: !!options.openDrawer && results.length === 0,
          drawerPin: options.drawerPin,
          cut: options.cut !== false,
        });

        for (let copy = 0; copy < target.copies; copy += 1) {
          const label = (options.docName || 'Posnic Receipt')
            + (target.copies > 1 ? ` (${copy + 1}/${target.copies})` : '');
          /* eslint-disable-next-line no-await-in-loop -- printers are serial
             devices; two jobs sent at once interleave on the same roll. */
          const r = await hardwareManager.sendRawToPrinter(target.name, bytes, label);
          results.push({ printer: target.name || '(default)', copy: copy + 1, sent: bytes.length, ...r });
        }
      }

      /* One failed printer must not report the whole receipt as failed when the
         customer already has their copy, so success means at least one landed
         and the failures are named for the operator. */
      const failed = results.filter((r) => !r.success);
      /*
       * How much actually went down the wire.
       *
       * Hardware Manager's test print says "Sent N bytes", and N came back
       * undefined from the day this handler learned to drive several printers:
       * the old single-printer version answered { success, bytes } and the
       * rewrite answered a summary that forgot to carry it. The one screen
       * whose whole job is to prove the printer works was reporting
       * "Sent undefined bytes".
       */
      const sentBytes = results.reduce((n, r) => n + (r.success ? (r.sent || 0) : 0), 0);

      receiptLog.record({
        kind: options.kind || 'receipt',
        saleId: (sale && (sale.billNo || sale.sales_id || sale.invoice_number)) || '',
        title: (sale && sale.title) || options.docName || 'Receipt',
        total: sale && (sale.total ?? sale.sales_total),
        /* Who asked. The floor bill passes its own; anything else is somebody
           standing at the counter. */
        source: options.source || 'Till',
        ms: Date.now() - startedAt,
        printers: results.map((r) => ({
          name: r.printer,
          copy: r.copy,
          status: r.success ? 'success' : 'failed',
          reason: r.success ? undefined : (r.error || 'unknown'),
          bytes: r.sent,
        })),
      });

      return {
        success: results.some((r) => r.success),
        bytes: sentBytes,
        printed: results.length - failed.length,
        attempted: results.length,
        failures: failed.map((r) => ({ printer: r.printer, error: r.error || 'unknown' })),
        error: failed.length && !results.some((r) => r.success)
          ? (failed[0].error || 'Print failed') : undefined,
      };
    } catch (err) {
      console.error('[Print] receipt render failed:', err.message);
      /*
       * A receipt that never reached a printer is the most important row in
       * the log, not the least. Without this the failures that happen BEFORE
       * any printer is touched - a layout that will not draw, a missing
       * setting - would leave no trace at all and look like the till simply
       * ignored the button.
       */
      receiptLog.record({
        kind: options.kind || 'receipt',
        saleId: (sale && (sale.billNo || sale.sales_id || sale.invoice_number)) || '',
        title: (sale && sale.title) || options.docName || 'Receipt',
        total: sale && (sale.total ?? sale.sales_total),
        source: options.source || 'Till',
        ms: Date.now() - startedAt,
        printers: [{ name: '(never reached a printer)', status: 'failed', reason: err.message }],
      });
      return { success: false, error: err.message };
    }
  });

  /* The day's receipts, for the Hardware Manager screen. */
  ipcMain.handle('receipt:get-logs', (event, date) => require('./receipt-log').forDate(date));

  ipcMain.handle('receipt:delete-log', (event, date, id) => ({
    success: require('./receipt-log').remove(date, id),
  }));

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

  /*
   * A KEY FOR THE CLOUD THAT IS NOT THIS MACHINE'S KIOSK KEY.
   *
   * The first version sent KIOSK_API_KEY to the shop's cloud address, and that
   * key guards every kiosk route on this till's OWN api - the kitchen display,
   * the tablet, the phone ordering routes. Sending it out means a mistyped
   * address, or one compromised server, hands over far more than printing.
   *
   * So the far door gets its own secret, worth exactly one thing: taking print
   * jobs from a shop that has allowed it. Made once, here, where the
   * preferences object already lives - a second writer of that file would drop
   * whatever the first had in memory.
   */
  if (!preferences.cloud_print_key) {
    preferences.cloud_print_key = require('crypto').randomBytes(32).toString('hex');
    _savePrefs(preferences);
    console.log('[BILL] made this till a printing key for the cloud');
  }

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
  /**
   * The branches this installation actually has.
   *
   * Read straight from the local database rather than over HTTP: the branches
   * route sits behind `protect`, and this window has no session to present.
   * Same connection details the cloud data check uses.
   */
  ipcMain.handle('kot:get-branches', async () => readLocalBranches());

  ipcMain.handle('kot:get-config', async () => {
    const fallback = { branchId: '', printerNames: [], apiUrl: `http://127.0.0.1:${Number(process.env.PORT) || 5555}/api` };
    const cfg = kotManager ? await kotManager.loadConfig() : fallback;

    /*
     * Answer the branch question instead of asking it.
     *
     * This screen used to demand a 24 character ObjectId, typed by hand, before
     * a kitchen printer would work - a leftover from Hardware Manager being a
     * separate application that had no way of knowing which shop it served.
     * It runs inside the till now, so it can look.
     *
     * One branch, which is nearly every shop, is chosen outright. Several, and
     * the list is returned so the screen can offer names rather than ids.
     */
    const branches = await readLocalBranches();
    cfg.branches = branches;
    if (!cfg.branchId && branches.length === 1) {
      cfg.branchId = branches[0].id;
      cfg.branchAutoSelected = true;
    }
    return cfg;
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

  /*
   * WHAT THE BILL PRINTER IS DOING, for a person rather than a log file.
   *
   * BillManager has kept this since it was written and nothing ever asked for
   * it, so when a bill did not come out the answer lived in a console window
   * nobody has open on a shop floor. "It is not printing" and "no receipt
   * printer is set on this till" are the same sentence to a shopkeeper until
   * something tells them apart.
   */
  ipcMain.handle('bill:get-status', () => {
    if (!billManager) return { isPolling: false };
    return billManager.getStatus();
  });

  /*
   * A PERSON ANSWERING "DID THIS BILL PRINT?".
   *
   * The queue parks a job in `needs_attention` when the till that took it went
   * quiet - it may be on paper, it may not, and only somebody standing at the
   * printer knows. That question had been asked with nowhere to answer it
   * since the queue was written.
   *
   * `printed` closes it. Anything else puts it back on the queue, which is the
   * only retry this design allows: a deliberate one, by somebody who has
   * looked.
   */
  /*
   * WHAT THE SHADOW QUEUE HAS BEEN SEEING.
   *
   * The kitchen prints through the old path; beside it the queue records what
   * IT believes should print and prints nothing, so the two can be compared
   * before anything is cut over. That comparison had no way out of the
   * database until now.
   *
   * Asked through the bill poller because it already holds the address and
   * the key for this shop's server, and this is the same conversation.
   */
  ipcMain.handle('kot:shadow-summary', async (_event, days) => {
    if (!billManager) return null;
    return billManager.shadowSummary(days);
  });

  ipcMain.handle('bill:answer-waiting', async (_event, id, printed) => {
    if (!billManager) return { ok: false, error: 'printing is not running on this till' };
    return billManager.answerWaiting(id, printed === true);
  });

  /*
   * THIS COMPUTER'S PRINTING KEY, so it can be pasted into the shop.
   *
   * A key of its own, NOT this machine's kiosk key: that one guards every
   * kiosk route on this till and is worth far more than printing. Made at
   * startup above and shown on screen so the shopkeeper can allow it in their
   * shop - see api/src/models/print-till.model.js for why the key travels from
   * the till rather than a server secret travelling into a browser.
   *
   * ipcMain.handle THROWS on a duplicate channel, and this was registered
   * twice by a patch that ran twice. Everything after it in this function -
   * the KOT log handlers, reprint, the scale - never registered at all.
   */
  ipcMain.handle('bill:get-printing-key', () => preferences.cloud_print_key || '');

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

  /*
   * Is Windows letting handsets reach this till?
   *
   * The startup check asks once and can be dismissed for good, which is right
   * for a shop that does not use handsets and wrong for the shop standing at
   * the counter wondering why a phone stopped finding the till. This is the
   * screen they open when that happens, so the answer belongs here too.
   */
  const handsetVerdict = async () => {
    const handsets = require('./handset-reachability');
    const result = await handsets.check({
      exePath: process.execPath,
      port: Number(process.env.PORT) || 5555,
      lanIp: getLocalIP(),
    });
    /* The sentence is built here rather than in the window: explain() lives
       beside the rule that produced the verdict, and a screen that writes its
       own wording is a screen that drifts from it. */
    return { ...result, message: handsets.explain(result) };
  };

  ipcMain.handle('handsets:check', async () => handsetVerdict());

  /*
   * Adding the rule, which needs an administrator, so Windows prompts.
   *
   * The verdict afterwards comes from looking again rather than from assuming
   * the command worked: a cancelled elevation prompt and a successful one look
   * identical from here otherwise.
   */
  ipcMain.handle('handsets:allow', async () => {
    const handsets = require('./handset-reachability');
    const applied = await handsets.applyFix({ exePath: process.execPath });
    if (!applied.ok) return { ok: false, error: applied.error || 'Windows did not grant permission' };
    return { ok: true, result: await handsetVerdict() };
  });

  /*
   * THE KITCHEN SCREEN.
   *
   * Which display, how far away, how big the panel - all per machine, like the
   * printer, and for the same reason: two tills in one shop have different
   * things plugged into them. They live beside the printer choice in
   * preferences.json.
   */
  ipcMain.handle('kitchen-screen:list', () => {
    const screens = require('./kitchen-screen');
    return { ok: true, displays: screens.displays(), defaults: screens.DEFAULTS };
  });

  ipcMain.handle('kitchen-screen:configure', (event, displayId, patch = {}) => {
    const screens = require('./kitchen-screen');
    const result = screens.configure(displayId, patch);
    /* Push straight away so a font or distance change is visible on the wall
       while somebody is still standing in front of it. */
    if (result.ok) screens.push(displayId);
    return { ...result, displays: screens.displays() };
  });

  /*
   * Put the real thing on the real screen, at the real size, with a sample
   * service on it.
   *
   * The only place "can the cook read this?" can be answered is standing where
   * the cook stands. A number on the till is a different room.
   */
  ipcMain.handle('kitchen-screen:preview', (event, displayId, on = true) => {
    const screens = require('./kitchen-screen');
    if (!on) {
      if (!screens.configFor(displayId).enabled) screens.close(displayId);
      else screens.push(displayId);
      return { ok: true };
    }
    screens.open(displayId);
    /* ready fires when the page has loaded; this covers a window already open. */
    setTimeout(() => screens.push(displayId, { setupMode: true }), 400);
    return { ok: true };
  });

  /* The page says it has loaded and asks for its content. */
  ipcMain.handle('kitchen-screen:ready', (event, displayId) => {
    const screens = require('./kitchen-screen');
    const setup = !screens.configFor(displayId).enabled;
    screens.push(displayId, { setupMode: setup });
    return { ok: true };
  });

  console.log('Hardware IPC handlers registered');
}

module.exports = { setupHardwareIPC, readLocalBranches };
