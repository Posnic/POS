const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
/* Windows uses SumatraPDF via pdf-to-printer; everything else uses CUPS.
   This used to call pdf-to-printer directly, which is Windows-only, so a
   kitchen ticket falling back to PDF printing on a Mac or Linux till failed
   silently - caught, reported, and nothing printed. */
const { printPdfFile } = require('./print-pdf');
const { hardenPrintWindow } = require('./print-window-guard');
const { normalizeTargets, pageSizeFor } = require('./printer-targets');

/*
 * Where our own API is listening, right now.
 *
 * Read inside the function, never at module load. main.js sets PORT while it
 * starts up, so a const evaluated when this file is first required captures
 * the fallback instead - the mistake that has already cost three separate
 * outages in this codebase.
 *
 * 5555 is the pre-derived-ports default and is kept only as a last resort for
 * a development run where nothing set PORT.
 */
function kotApiUrl() {
  const port = Number(process.env.PORT) || 5555;
  return `http://127.0.0.1:${port}/api`;
}

/*
 * How often to poll when nothing has happened.
 *
 * This used to be five seconds because polling was the only way a ticket could
 * ever reach the printer. Sales now announce themselves the moment they are
 * saved, so this is only the net that catches what the event missed - a ticket
 * written while the app was starting, or one whose print failed. Thirty seconds
 * is frequent enough to recover an order and quiet enough to stop hammering the
 * API all day.
 */
const KOT_FALLBACK_POLL_MS = 30000;

class KOTManager {
  constructor() {
    this.pollingTimer = null;
    this.config = null;
    this.isPolling = false;
    this.lastPollTime = null;
    this.lastPollStatus = null;

    // Daily KOT counter (resets at midnight)
    this.kotCounterDate = null;
    this.kotCounter = 0;
    this.kotSlotMapping = {};

    // Dedup: track printed job hashes
    this.printedJobs = new Set();

    /*
     * The API is require()d into this same process, so a sale that needs a
     * kitchen ticket can say so directly instead of us asking every few
     * seconds. See api/src/helpers/kot-notify.js for why `process` is the bus.
     *
     * The poll underneath stays, slowed down: it is also what recovers a ticket
     * that failed to print, or one saved while the app was starting. Losing an
     * order is worse than printing it a little late, so the safety net stays.
     */
    this._kotNudgeTimer = null;
    this._onKotCreated = (payload) => this._onKotEvent(payload);
    try { process.on('posnic:kot-created', this._onKotCreated); } catch (e) { /* never fatal */ }

    const base = this._getWritablePath();
    this.configPath = path.join(base, 'kot-config.json');
    this.statePath  = path.join(base, 'kot-state.json');
    this.logsDir    = path.join(base, 'kot-logs');
    this._ensureLogsDir();

    this._loadState();
  }

  _getWritablePath() {
    try { return app.getPath('userData'); } catch (e) { return __dirname; }
  }

  _getLocalIp() {
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
      }
    } catch (e) { /* ignore */ }
    return '127.0.0.1';
  }

  // ─── Log helpers ─────────────────────────────────────────────────────────

  _ensureLogsDir() {
    try { if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true }); } catch (e) { /* ignore */ }
  }

  _getLogPath(date) {
    return path.join(this.logsDir, `kot-logs-${date}.json`);
  }

  _appendLog(entry) {
    try {
      const date    = new Date(entry.time).toISOString().slice(0, 10);
      const logPath = this._getLogPath(date);
      let   logs    = [];
      /* Read first rather than asking whether it exists: the answer can stop
         being true before the read, and an absent log is the ordinary case on
         the first ticket of the day. */
      try { logs = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) { logs = []; }
      logs.push(entry);
      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
    } catch (e) { console.error('[KOT] Failed to write log:', e.message); }
  }

  getLogs(date) {
    try {
      const logPath = this._getLogPath(date);
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    } catch (e) { /* no log for that day, or it went away mid-read */ }
    return [];
  }

  deleteLog(date, logId) {
    try {
      const logPath = this._getLogPath(date);
      let logs;
      try {
        logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      } catch (e) {
        /* ENOENT is "no log for that day", which is the message this always
           gave; anything else is a real read failure and says so. */
        if (e && e.code === 'ENOENT') return { success: false, error: 'Log file not found' };
        throw e;
      }
      logs = logs.filter((l) => l.id !== logId);
      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async _waitForPrintPage(webContents) {
    await webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        } else {
          window.addEventListener('load', () => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }, { once: true });
        }
      })
    `);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  _sendPrintJob(printWindow, printOpts) {
    return new Promise((resolve) => {
      printWindow.webContents.print(printOpts, (success, reason) => {
        resolve({ success, reason: reason || '' });
      });
    });
  }

  async _printViaPdfFallback(printWindow, deviceName) {
    const tmpPdf = path.join(
      app.getPath('temp'),
      `posnic-kot-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
    );

    try {
      const pdfBuffer = await printWindow.webContents.printToPDF({
        printBackground: true,
        marginsType: 1
      });
      fs.writeFileSync(tmpPdf, pdfBuffer);

      const pdfOptions = {};
      if (deviceName) pdfOptions.printer = deviceName;

      await printPdfFile(tmpPdf, pdfOptions);
      console.log(`[KOT] Printed via PDF fallback -> ${deviceName || 'default printer'}`);
      return { success: true, reason: '' };
    } catch (error) {
      console.error(`[KOT] PDF print fallback failed (${deviceName}):`, error.message);
      return { success: false, reason: error.message || 'PDF print fallback failed' };
    } finally {
      try {
        if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
      } catch (_) {}
    }
  }

  async _printWithSystemDefaultFallback(printWindow) {
    console.warn('[KOT] Retrying with Windows default printer');

    let result = await this._sendPrintJob(printWindow, {
      silent: true,
      printBackground: true,
      margins: { marginType: 'none' }
    });

    if (!result.success) {
      console.warn('[KOT] Windows default Electron print failed, retrying default PDF fallback:', result.reason || 'unknown');
      result = await this._printViaPdfFallback(printWindow, '');
    }

    return result;
  }

  async _printToDeviceWithFallback(printWindow, deviceName, pageSizeKey) {
    const baseOptions = {
      silent: true,
      printBackground: true,
      margins: { marginType: 'none' },
      deviceName
    };

    /* The paper this printer is actually loaded with, rather than 80mm for
       everyone. A kitchen on a 58mm roll was being handed an 80mm page and
       relying on the driver to shrink it. */
    let result = await this._sendPrintJob(printWindow, {
      ...baseOptions,
      pageSize: pageSizeFor(pageSizeKey)
    });

    if (!result.success) {
      console.warn(`[KOT] Receipt page size rejected (${deviceName}), retrying with printer defaults:`, result.reason || 'unknown');
      result = await this._sendPrintJob(printWindow, baseOptions);
    }

    if (!result.success) {
      console.warn(`[KOT] Electron print failed (${deviceName}), retrying through PDF fallback:`, result.reason || 'unknown');
      result = await this._printViaPdfFallback(printWindow, deviceName);
    }

    if (!result.success && deviceName) {
      console.warn(`[KOT] Named printer "${deviceName}" failed, falling back to Windows default printer`);
      result = await this._printWithSystemDefaultFallback(printWindow);
    }

    return result;
  }

  async reprint(logEntry) {
    const printerNames = this.config?.printerNames || [];
    if (!printerNames.length) throw new Error('No printers configured. Start KOT polling first.');
    const sale = {
      ...(logEntry._saleData || {}),
      _printKind: logEntry.printKind,
      items:      logEntry.items || []
    };
    return await this.silentPrint(sale, printerNames, true);
  }

  // ─── Config ──────────────────────────────────────────────────────────────

  async loadConfig() {
    let saved = null;
    try {
      if (fs.existsSync(this.configPath)) {
        saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (e) { /* ignore */ }

    const cfg = saved || { branchId: '', printerNames: [] };

    /*
     * Always take the API address from this process, never from the file.
     *
     * The port used to be fixed at 5555 and is now derived per installation,
     * so every saved config written before that change points at a port
     * nothing listens on - and a kitchen printer that quietly stops printing
     * is not something anyone notices until service.
     *
     * The address is not a user setting; it is where our own API happens to be
     * today. Recomputing it means an upgrade, a rename or a second brand on
     * the same machine cannot leave a stale one behind.
     */
    cfg.apiUrl = kotApiUrl();
    return cfg;
  }

  async saveConfig(config) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
      console.error('[KOT] Failed to save config:', e.message);
    }
  }

  // ─── Daily counter state ──────────────────────────────────────────────────

  _loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const s = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        this.kotCounterDate  = s.kotCounterDate  || null;
        this.kotCounter      = s.kotCounter      || 0;
        this.kotSlotMapping  = s.kotSlotMapping  || {};
      }
    } catch (e) { /* ignore */ }
    this._maybeDailyReset();
  }

  _saveState() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({
        kotCounterDate: this.kotCounterDate,
        kotCounter:     this.kotCounter,
        kotSlotMapping: this.kotSlotMapping
      }, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  _maybeDailyReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.kotCounterDate !== today) {
      this.kotCounter     = 0;
      this.kotSlotMapping = {};
      this.kotCounterDate = today;
      this._saveState();
    }
  }

  getDailyKotNumber(printKind, saleId) {
    this._maybeDailyReset();
    const isEdit = printKind === 'edit' || printKind === 'cancel';
    if (isEdit && saleId && this.kotSlotMapping[saleId]) {
      return this.kotSlotMapping[saleId];
    }
    if (saleId && this.kotSlotMapping[saleId]) {
      return this.kotSlotMapping[saleId];
    }
    this.kotCounter += 1;
    if (saleId) this.kotSlotMapping[saleId] = this.kotCounter;
    this._saveState();
    return this.kotCounter;
  }

  // ─── Event driven ─────────────────────────────────────────────────────────

  /**
   * A sale just asked for a kitchen ticket.
   *
   * Debounced rather than printed inline: a table of six sending six courses
   * produces six events in a moment, and each poll already fetches every
   * pending ticket. One pass shortly after the last event prints them all,
   * where six immediate passes would race each other for the same printer.
   *
   * A branch arriving on the event is used when nothing is configured, which is
   * what lets the Branch ID field stop being something a shopkeeper types.
   */
  _onKotEvent(payload = {}) {
    if (!this.isPolling || !this.config) return;

    if (!this.config.branchId && payload.branchId) {
      this.config.branchId = String(payload.branchId);
      console.log('[KOT] branch taken from the sale:', this.config.branchId);
    }

    if (this._kotNudgeTimer) return;
    this._kotNudgeTimer = setTimeout(() => {
      this._kotNudgeTimer = null;
      if (!this.isPolling) return;
      console.log('[KOT] sale event -> printing now (' + (payload.reason || 'created') + ')');
      /* Cancel the scheduled poll so this pass replaces it rather than running
         alongside it and fetching the same tickets twice. */
      if (this.pollingTimer) { clearTimeout(this.pollingTimer); this.pollingTimer = null; }
      this._poll();
    }, 250);
  }

  // ─── Polling lifecycle ────────────────────────────────────────────────────

  async startPolling(config) {
    this.stopPolling();
    this.config    = config;
    this.isPolling = true;
    await this.saveConfig(config);
    console.log('[KOT] Polling started — branch:', config.branchId, '| printers:', config.printerNames);
    this._poll();
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this._kotNudgeTimer) {
      clearTimeout(this._kotNudgeTimer);
      this._kotNudgeTimer = null;
    }
    this.isPolling = false;
    console.log('[KOT] Polling stopped');
  }

  getStatus() {
    return {
      isPolling:      this.isPolling,
      branchId:       this.config?.branchId    || '',
      printerNames:   this.config?.printerNames || [],
      lastPollTime:   this.lastPollTime,
      lastPollStatus: this.lastPollStatus
    };
  }

  // ─── Poll loop ────────────────────────────────────────────────────────────

  async _poll() {
    if (!this.isPolling || !this.config) return;

    // Resolved per poll rather than captured when polling started, so a
    // restart that lands on a different port keeps working.
    const { branchId, printerNames } = this.config;
    const apiUrl = kotApiUrl();

    try {
      console.log('[KOT] Polling server...');

      // The same per-installation key the API expects, set by main.js at
      // startup. Read here rather than at module load, for the same reason the
      // port is.
      const KIOSK_KEY = process.env.KIOSK_API_KEY || '';
      const res  = await fetch(`${apiUrl}/sales/multiKitchenPrint`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'kioskkey': KIOSK_KEY },
        body:    JSON.stringify({ branchId })
      });

      const data  = await res.json();
      this.lastPollTime   = new Date().toLocaleTimeString();
      this.lastPollStatus = 'ok';

      console.log(`[KOT] API status=${data?.status} message="${data?.message}" sales=${Array.isArray(data?.data) ? data.data.length : 'null'}`);

      const sales = Array.isArray(data?.data) ? data.data : [];
      if (sales.length === 0) {
        this.pollingTimer = setTimeout(() => this._poll(), KOT_FALLBACK_POLL_MS);
        return;
      }

      console.log(`[KOT] ${sales.length} pending order(s) to print`);

      const printedSaleIds = [];
      const printedIndexes = {};

      for (const sale of sales) {
        // MongoDB driver returns ObjectId instance — use .toString(), not .$oid
        const saleId = sale?._id?.toString ? sale._id.toString() : String(sale?._id || '');
        if (!saleId) continue;

        const printJobs = Array.isArray(sale?.print_jobs) ? sale.print_jobs : null;

        if (printJobs && printJobs.length > 0) {
          for (const job of printJobs) {
            const jobType  = (job.type || '').toLowerCase();
            const jobItems = Array.isArray(job.items) ? job.items : [];
            const ts       = job.timestamp;
            const tsToken  = ts instanceof Date ? ts.getTime().toString()
                           : (ts?.$date?.$numberLong || String(ts?.$date || ts || ''));
            const raw      = `${saleId}-${jobType}-${tsToken}-${JSON.stringify(jobItems)}`;
            const jobHash  = crypto.createHash('md5').update(raw).digest('hex');
            const jobKey   = `${saleId}:${jobType}:${jobHash}`;

            if (this.printedJobs.has(jobKey)) continue;

            await this.silentPrint(
              { ...sale, _printKind: jobType === 'modified' ? 'edit' : jobType, items: jobItems },
              printerNames
            );
            this.printedJobs.add(jobKey);
          }

          printedSaleIds.push(saleId);
          if (sale.new_last_printed_change_index !== undefined) {
            printedIndexes[saleId] = sale.new_last_printed_change_index;
          }
          continue;
        }

        // Fallback: sale_process-based
        const proc     = (sale.sale_process || '').toUpperCase();
        const isKOT    = proc.includes('KOT');
        const isCancel = proc.includes('CANCEL');
        if (!isKOT && !isCancel) continue;

        const updSrc   = sale.updated_date || sale.updated_at || sale.created_date || sale.created_at || null;
        const dateToken = updSrc instanceof Date ? updSrc.getTime().toString()
                        : (updSrc?.$date?.$numberLong || String(updSrc?.$date || updSrc || ''));
        const rawToken  = `${dateToken}-${sale.table_number||''}-${sale.person_count||''}-${JSON.stringify(sale.items||[])}`;
        const token     = crypto.createHash('md5').update(rawToken).digest('hex');
        const key       = `${isCancel ? 'cancel' : 'kot'}:${saleId}:${token}`;

        if (this.printedJobs.has(key)) continue;

        if (!isCancel) {
          sale._printKind = this.printedJobs.has(`ever:${saleId}`) ? 'edit' : 'new';
          this.printedJobs.add(`ever:${saleId}`);
        } else {
          sale._printKind = 'cancel';
        }

        await this.silentPrint(sale, printerNames);
        this.printedJobs.add(key);
        printedSaleIds.push(saleId);
      }

      if (printedSaleIds.length > 0) {
        await fetch(`${apiUrl}/sales/markKitchenPrinted`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'kioskkey': KIOSK_KEY },
          body:    JSON.stringify({ saleIds: printedSaleIds, printedIndexes })
        });
        console.log(`[KOT] Marked ${printedSaleIds.length} order(s) as printed`);
      }
    } catch (err) {
      console.error('[KOT] Poll error:', err.message);
      this.lastPollStatus = 'error: ' + err.message;
    }

    this.pollingTimer = setTimeout(() => this._poll(), KOT_FALLBACK_POLL_MS);
  }

  // ─── Silent print ─────────────────────────────────────────────────────────

  async silentPrint(sale, printerNames, skipLog = false) {
    const printKind  = (sale._printKind || '').toLowerCase();
    const saleDispId = sale.sales_id || sale.sid || sale.sale_id || '';
    const saleDbId   = sale._id?.toString ? sale._id.toString() : String(sale._id || '');
    const kotNumber  = this.getDailyKotNumber(printKind, saleDispId || saleDbId);

    /*
     * webSecurity stays ON here, unlike the receipt printer in
     * hardware-manager.js.
     *
     * The difference is what the document loads. This one is built by
     * _buildKOTHtml below and is entirely self-contained: inline CSS, a system
     * font, no images, no stylesheet link, nothing fetched. So the page never
     * needs to reach past its own opaque data: origin, and disabling web
     * security would buy nothing while removing a boundary.
     *
     * The receipt path is genuinely different - see the comment there before
     * assuming the two should match. If a logo or an external stylesheet is
     * ever added to a KOT ticket it will silently stop loading here, which is
     * what tests/print-window-hardening.test.js exists to catch.
     */
    const printWindow = new BrowserWindow({
      show: false, width: 302, height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true }
    });

    hardenPrintWindow(printWindow);

    const printerResults = [];

    try {
      const html = this._buildKOTHtml(sale, printKind, kotNumber);
      await printWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      await this._waitForPrintPage(printWindow.webContents);

      /*
       * Each printer carries its own paper and its own copy count now, so a
       * kitchen roll and a pass copy are one configuration rather than two
       * incompatible ones.
       *
       * The name POS-80C used to be rewritten to '' here, which quietly sent
       * the job to the SYSTEM DEFAULT instead of the printer the shop chose.
       * It is the factory name on a great many generic 80mm printers, so any
       * shop that never renamed theirs was printing somewhere else and had no
       * way to tell. If a device name is genuinely unreachable the print fails
       * and says so, which is recoverable; silently printing elsewhere is not.
       */
      const targets = normalizeTargets(
        Array.isArray(printerNames) && printerNames.length
          ? { printers: printerNames }
          : this.config || {},
        '80mm'
      );

      /* Flattened so one entry is one sheet: two copies is two passes through
         the same printer, which is what the driver expects for a roll. */
      const jobs = [];
      for (const t of targets) {
        for (let c = 0; c < t.copies; c += 1) {
          jobs.push({ name: t.name, pageSize: t.pageSize, copy: c + 1, of: t.copies });
        }
      }

      await new Promise((resolve) => {
        let idx = 0;
        const next = async () => {
          const job = jobs[idx];
          const deviceName = job.name;
          const result = await this._printToDeviceWithFallback(printWindow, deviceName, job.pageSize);
          if (!result.success) {
            console.error(`[KOT] Print failed (${deviceName}):`, result.reason);
            printerResults.push({ name: deviceName, status: 'failed', reason: result.reason || 'unknown' });
          } else {
            console.log(`[KOT] Printed -> ${deviceName}`);
            printerResults.push({ name: deviceName, status: 'success' });
          }
          idx++;
          if (idx < jobs.length) next(); else resolve();
        };
        next();
      });
    } finally {
      printWindow.close();
    }

    if (!skipLog) {
      const uid = crypto.randomUUID ? crypto.randomUUID()
                : crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex');
      this._appendLog({
        id:           uid,
        time:         new Date().toISOString(),
        saleDisplayId: String(saleDispId),
        saleDbId,
        table:        String(sale.table_number || sale.tableNo || sale.table || sale.table_no || ''),
        pax:          sale.person_count ?? sale.pax ?? sale.no_of_person ?? '',
        dineType:     sale.dine_type || sale.order_type || '',
        printKind,
        kotNumber,
        deviceIp:     this._getLocalIp(),
        items:        Array.isArray(sale.items) ? sale.items : [],
        printers:     printerResults,
        _saleData: {
          sales_id:     saleDispId,
          table_number: sale.table_number || '',
          person_count: sale.person_count || '',
          dine_type:    sale.dine_type || sale.order_type || '',
          updated_date: sale.updated_date || null,
          created_date: sale.created_date || null,
        }
      });
    }

    return printerResults;
  }

  // ─── HTML builder ─────────────────────────────────────────────────────────

  _esc(s) {
    if (typeof s !== 'string') return String(s ?? '');
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  _fmtDate(raw) {
    if (!raw) return '';
    let d;
    if (raw instanceof Date) {
      d = raw;
    } else if (typeof raw === 'object') {
      if (raw.$date)       return this._fmtDate(raw.$date);
      if (raw.$numberLong) return this._fmtDate(Number(raw.$numberLong));
      return String(raw);
    } else if (/^\d+$/.test(String(raw))) {
      d = new Date(Number(raw));
    } else {
      d = new Date(raw);
    }
    if (isNaN(d)) return String(raw);
    const p = n => String(n).padStart(2,'0');
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${p(d.getDate())}-${p(d.getMonth()+1)}-${d.getFullYear()} ${h}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ap}`;
  }

  _buildKOTHtml(sale, printKind, kotNumber) {
    const isCancelled = printKind === 'cancel';

    /*
     * WHAT THE KITCHEN READS FIRST.
     *
     * Owner, on how a cook actually treats these: "we actually sent as item
     * cancelled even quantity reduced. for labours they dont care mostly.
     * only cancelled they just cancel while doing it. so keep as it is on
     * this. when whole order cancelled then send as Order cancelled instead
     * of item cancelled. one item or two item removal items cancelled okay.
     * plural. quantity reduced is bad for them."
     *
     * So a reduction keeps printing as a cancellation, deliberately: a cook
     * who reads "cancelled" against a line stops making that many, which is
     * the behaviour the kitchen already has. What changes is the difference
     * between losing the whole table's order and losing a line off it, which
     * every ticket used to call the same thing.
     *
     * A whole-order cancel is the only path that stamps sale_process
     * 'cancelled' on the sale (sale.repository.js, updateOrderModel); a line
     * removed or reduced leaves the order open and still says KOT. So the
     * sale itself answers which of the two this is, and the count of lines on
     * THIS ticket decides the plural.
     *
     * "Modified Order" is gone. Owner: "azure asking like new order instead
     * of modified order." A second ticket for the same table is an additional
     * order to the kitchen, not an edit of a sheet they have already cooked
     * from and thrown away.
     */
    const cancelledWholeOrder = /cancel/i.test(String(sale.sale_process || ''));
    const cancelledLines = Array.isArray(sale.items) ? sale.items.length : 0;
    const title = isCancelled
      ? (cancelledWholeOrder
          ? 'Order Cancelled'
          : (cancelledLines > 1 ? 'Items Cancelled' : 'Item Cancelled'))
      : (printKind === 'edit' ? 'Additional Order' : 'New Order');

    const dateText    = this._fmtDate(sale.updated_date || sale.updated_at || sale.created_date || sale.created_at || '');
    const tableNo     = sale.table_number || sale.tableNo || sale.table || sale.table_no || '';
    const personCount = sale.person_count ?? sale.pax ?? sale.no_of_person ?? '';
    const dineType    = sale.dine_type || sale.order_type || '';
    /* Whatever is left to say about where this goes, once the table has had
       its own line. A takeaway has no table and says so rather than printing
       an empty box; a table with no pax count prints nothing extra rather
       than an empty line. */
    const placeParts = [];
    if (!tableNo) placeParts.push('Table: -');
    if (personCount !== '' && personCount !== null && personCount !== undefined) {
      placeParts.push(`Pax: ${personCount}`);
    }
    const placeLine = placeParts.join('   ');
    /* What the customer said about the whole order, and - for a delivery -
       where it is going. Both were on the sale and neither was printed. */
    const orderNote   = String(sale.notes || sale.note || '').trim();
    const deliverTo   = String(sale.fulfilment || '') === 'delivery'
      ? [sale.customer_name, sale.customer_address, sale.customer_phone].filter(Boolean).map(String).join(' / ')
      : '';

    const rawId = sale.sales_id || sale.sid || sale.sale_id || '';
    const saleIdDisplay = rawId ? (String(rawId).toUpperCase().startsWith('SID') ? rawId : 'SID' + rawId) : '';

    let items = [];
    if (Array.isArray(sale.items) && sale.items.length > 0) {
      items = sale.items;
    } else if (printKind === 'edit' && Array.isArray(sale.changes) && sale.changes.length) {
      const last = sale.changes[sale.changes.length - 1];
      items = Array.isArray(last?.items) ? last.items : [];
    }

    const itemsHtml = items.map(it => {
      const name = it.item_name || it.name || it.product_name || it.itemName || '';
      const qty  = it.item_quantity || it.quantity || it.qty || it.item_qty || 1;
      const desc = it.item_description || it.description || it.desc || '';
      return `<div class="ir">
        <div class="im">
          <div class="in ${isCancelled ? 'cx' : ''}">${this._esc(String(name))}</div>
          <div class="iq">x${qty}</div>
        </div>
        ${desc ? `<div class="id">** ${this._esc(String(desc))} **</div>` : ''}
      </div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT</title><style>
html,body{margin:0;padding:0;font-family:"Courier New",monospace;}
body{padding:6px;width:72mm;box-sizing:border-box;}
.c{text-align:center;}
.lt{font-size:18px;font-weight:700;}
.kn{font-size:48px;font-weight:900;text-align:center;margin:8px 0;border:3px solid #000;padding:8px;background:#f5f5f5;}
.ml{font-size:13px;margin:2px 0;text-align:center;font-weight:700;}
/* The table is the second thing a cook needs after what kind of ticket this
   is, and it used to print at the same size as the date, sharing a line with
   the pax count inside square brackets. Owner: "with table number clearly
   mentioned." */
.tb{font-size:26px;font-weight:900;text-align:center;margin:4px 0;letter-spacing:1px;}
.rl{border-top:4px dashed #777;margin:5px 0;}
.fl{border-top:4px dashed #777;margin-top:5px;}
.ir{padding:3px 0;border-top:1px dashed #777;}
.im{display:flex;justify-content:space-between;}
.in{font-weight:800;font-size:15px;text-transform:uppercase;margin-right:4px;}
.in.cx{text-decoration:line-through;}
.iq{font-weight:700;font-size:14px;min-width:24px;text-align:right;}
.id{font-size:11px;font-style:italic;font-weight:700;}
.nt{font-size:12px;font-weight:700;border:1px dashed #000;padding:3px 4px;margin:4px 0;white-space:pre-wrap;}
@media print{@page{size:72mm auto;margin:0;}body{width:72mm;margin:0;padding:0;}}
</style></head><body>
<div class="c"><div class="lt">${this._esc(title)}</div></div>
<div class="kn">#${kotNumber}</div>
<div class="ml">${this._esc(dateText)}</div>
${dineType    ? `<div class="ml">${this._esc(dineType)}</div>` : ''}
${saleIdDisplay ? `<div class="ml">${this._esc(saleIdDisplay)}</div>` : ''}
${tableNo ? `<div class="tb">TABLE ${this._esc(String(tableNo))}</div>` : ''}
${placeLine ? `<div class="ml">${this._esc(placeLine)}</div>` : ''}
${deliverTo ? `<div class="nt">DELIVER TO: ${this._esc(deliverTo)}</div>` : ''}
${orderNote ? `<div class="nt">NOTE: ${this._esc(orderNote)}</div>` : ''}
<div class="rl"></div>
${itemsHtml}
<div class="fl"></div>
</body></html>`;
  }
}

module.exports = KOTManager;
