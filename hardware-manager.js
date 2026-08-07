const { SerialPort } = require('serialport');
const { ScaleReader } = require('./scale-parser');
const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { print: printPdf } = require('pdf-to-printer');
const { hardenPrintWindow } = require('./print-window-guard');

class HardwareManager {
  constructor() {
    this.currentPort = null;
    this.lastData = '';
    this.lastWeight = 0;
    this.mainWindow = null;
    // Cash drawer
    this.cashDrawerPort = null;
    this.cashDrawerConfigPath = null;
    console.log('HardwareManager initialized');
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  broadcastLastWeight() {
    const weightData = {
      raw: `Last weight: ${this.lastWeight}`,
      weight: this.lastWeight,
      timestamp: new Date().toISOString(),
      isValid: true
    };
    
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('usb-data', weightData);
      }
    });
  }

  async scanSerialPorts(enableSimulation = false) {
    try {
      const ports = await SerialPort.list();
      console.log(`Found ${ports.length} serial ports`);

      // If no real ports and simulation enabled, return mock ports
      if (ports.length === 0 && enableSimulation) {
        console.log('No real ports found, returning mock ports for simulation');
        return [
          {
            path: 'COM1',
            manufacturer: 'Mock Scale Manufacturer',
            serialNumber: 'MOCK001',
            pnpId: 'MOCK\\VID_1234&PID_5678',
            locationId: '1-1',
            productId: '5678',
            vendorId: '1234',
            isMock: true
          },
          {
            path: 'COM3',
            manufacturer: 'Mock USB Device',
            serialNumber: 'MOCK002',
            pnpId: 'MOCK\\VID_ABCD&PID_EF01',
            locationId: '2-1',
            productId: 'EF01',
            vendorId: 'ABCD',
            isMock: true
          }
        ];
      }

      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        pnpId: port.pnpId,
        locationId: port.locationId,
        productId: port.productId,
        vendorId: port.vendorId,
        isMock: false
      }));
    } catch (error) {
      console.error('Failed to scan serial ports:', error);
      return [];
    }
  }

  /*
   * Retry a dropped scale, backing off so a scale that is simply switched off
   * does not spin the port open every second all day. Caps at half a minute,
   * which is well inside the time it takes someone to plug a cable back in.
   */
  scheduleReconnect(portPath) {
    if (this.reconnectTimer) return;
    this.reconnectAttempt = (this.reconnectAttempt || 0) + 1;
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt - 1));

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.deliberateDisconnect) return;
      if (this.currentPort && this.currentPort.isOpen) return;

      const result = await this.connectPort(portPath).catch((err) => ({
        success: false, error: err.message,
      }));
      if (result && result.success) {
        console.log('[Scale] reconnected to', portPath);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('port-error', '');
        }
      } else {
        this.scheduleReconnect(portPath);
      }
    }, delay);
    // The retry must never be the reason an idle app stays awake.
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  /*
   * Reopen the scale the shop last chose, at startup.
   *
   * Hardware Manager has always saved the port "for auto-reconnect on next
   * startup" - but nothing ever read it back, so every restart of the app left
   * the till with no scale until someone reconnected it by hand.
   */
  async autoConnectSaved(saved) {
    if (!saved || !saved.port) return { success: false, error: 'no saved scale' };
    console.log('[Scale] reopening saved port', saved.port);
    const result = await this.connectPort(saved.port, !!saved.isMock).catch((err) => ({
      success: false, error: err.message,
    }));
    if (!result || !result.success) {
      // Not an error worth a dialog: the scale may simply not be plugged in
      // yet. Keep retrying quietly, and the till works without it meanwhile.
      console.warn('[Scale] saved port not available:', result && result.error);
      this.scheduleReconnect(saved.port);
    }
    return result;
  }

  async connectPort(portPath, isMock = false) {
    // Mock connection for simulation
    if (isMock) {
      console.log('Connecting to mock port:', portPath);
      this.currentPort = {
        path: portPath,
        isOpen: true,
        isMock: true
      };
      
      // Start simulating weight data
      this.mockInterval = setInterval(() => {
        const weight = (Math.random() * 10 + 0.5).toFixed(2); // Random weight between 0.5 and 10.5 kg
        const weightData = {
          raw: `+${weight} kg`,
          weight: parseFloat(weight),
          timestamp: new Date().toISOString(),
          isValid: true,
          isMock: true
        };
        
        const allWindows = BrowserWindow.getAllWindows();
        allWindows.forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('usb-data', weightData);
          }
        });
      }, 1000); // Send data every second
      
      return { success: true };
    }

    // Real connection
    if (this.currentPort && this.currentPort.isOpen) {
      try {
        this.currentPort.close();
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error('Error closing existing port:', e);
      }
    }

    try {
      // Scales vary: 9600 8-N-1 is the common default, but 7-E-1 and other
      // baud rates are used often enough that they must be selectable.
      const serialOpts = (typeof isMock === 'object' && isMock) ? isMock : {};
      this.currentPort = new SerialPort({
        path: portPath,
        baudRate: Number(serialOpts.baudRate) || 9600,
        dataBits: Number(serialOpts.dataBits) || 8,
        stopBits: Number(serialOpts.stopBits) || 1,
        parity: serialOpts.parity || 'none',
        lock: true
      });

      // Raw bytes, not lines: scales differ on delimiters (CR only, STX/ETX,
      // or none at all), so the reader does the framing. See scale-parser.js.
      this.scaleReader = new ScaleReader();

      const broadcast = (weightData) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('usb-data', weightData);
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (win !== this.mainWindow && !win.isDestroyed()) {
            win.webContents.send('usb-data', weightData);
          }
        }
      };

      this.scaleReader.on('weight', ({ kg, stable, raw, how }) => {
        const changed = Math.abs(kg - this.lastWeight) > 0.001;
        if (!changed && !stable) return;
        this.lastWeight = kg;
        this.lastWeightStable = stable;
        broadcast({
          raw,
          weight: kg,
          stable,                       // safe to bill only when true
          parsedBy: how,
          timestamp: new Date().toISOString(),
          isValid: true,
        });
      });

      this.scaleReader.on('empty', () => {
        this.lastWeight = 0;
        this.lastWeightStable = true;
      });

      this.currentPort.on('data', (chunk) => this.scaleReader.push(chunk));

      this.currentPort.on('open', () => {
        console.log('Port opened:', portPath);
        this.scaleReader.startIdleWatch();
      });

      this.currentPort.on('error', (err) => {
        console.error('Serial Port Error:', err);
        if (this.mainWindow) {
          this.mainWindow.webContents.send('port-error', err.message);
        }
      });

      /*
       * Come back after the cable does.
       *
       * A scale on a counter gets knocked, unplugged by the cleaner, or power
       * cycled, and its USB serial port disappears with it. Nothing here
       * listened for that, so the port stayed shut until somebody opened
       * Hardware Manager and pressed Connect again - which is why a shop
       * reports the scale "not working" when the app is running perfectly
       * well and simply has no port open.
       *
       * A deliberate disconnect is remembered so it is not immediately undone.
       */
      this.currentPort.on('close', () => {
        if (this.deliberateDisconnect) {
          this.deliberateDisconnect = false;
          return;
        }
        console.warn('[Scale] port closed unexpectedly, will retry:', portPath);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('port-error',
            'Scale disconnected. Reconnecting automatically.');
        }
        this.scheduleReconnect(portPath);
      });

      // A connection that came up clears any retry that was still pending.
      this.reconnectAttempt = 0;
      return { success: true };
    } catch (err) {
      console.error('Failed to open port:', err);
      
      let errorMessage = err.message;
      if (err.message.includes('Access denied') || err.message.includes('EACCES')) {
        errorMessage = `Port ${portPath} is in use by another application. Please close any other programs using this port and try again.`;
      } else if (err.message.includes('ENOENT') || err.message.includes('cannot open')) {
        errorMessage = `Port ${portPath} not found. The device may have been disconnected.`;
      }
      
      return { success: false, error: errorMessage };
    }
  }

  async disconnectPort() {
    // Someone asked for this, so the close handler must not treat it as a
    // dropped cable and reopen the port behind them.
    this.deliberateDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;

    if (this.currentPort && this.currentPort.isOpen) {
      // Handle mock connection
      if (this.mockInterval) {
        clearInterval(this.mockInterval);
        this.mockInterval = null;
      }
      
      if (!this.currentPort.isMock) {
        this.currentPort.close();
      }

      if (this.scaleReader) {
        this.scaleReader.stopIdleWatch();   // otherwise the timer outlives the port
        this.scaleReader.reset();
      }
      this.currentPort = null;
      this.lastData = '';
      this.lastWeight = 0;
      this.lastWeightStable = false;
      console.log('Port disconnected');
      return { success: true };
    }
    return { success: false, error: 'No port open' };
  }

  isConnected() {
    return this.currentPort !== null && this.currentPort.isOpen;
  }

  getConnectionStatus() {
    if (this.isConnected() && this.currentPort) {
      return { 
        connected: true, 
        port: this.currentPort.path 
      };
    }
    return { connected: false };
  }

  async listPrinters() {
    try {
      const { webContents } = require('electron');
      
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
          this.mainWindow = allWindows[0];
        } else {
          console.warn('No window available for printer listing');
          return [];
        }
      }
      
      let printers;
      if (typeof this.mainWindow.webContents.getPrintersAsync === 'function') {
        printers = await this.mainWindow.webContents.getPrintersAsync();
      } else {
        printers = this.mainWindow.webContents.getPrinters();
      }
      console.log(`Found ${printers.length} printers`);
      
      const result = printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        description: printer.description || '',
        status: printer.status || 0,
        isDefault: printer.isDefault || false,
        options: {
          name: printer.name,
          description: printer.description,
          status: printer.status,
          isDefault: printer.isDefault
        }
      }));
      
      return result;
    } catch (error) {
      console.error('Failed to list printers:', error);
      return [];
    }
  }

  async _resolvePrinterName(printerName) {
    if (!printerName) return '';

    const requested = String(printerName).trim();
    if (!requested) return '';
    if (requested.toUpperCase() === 'POS-80C') {
      console.warn('Ignoring stale POS-80C printer fallback; using Windows default printer');
      return '';
    }

    const printers = await this.listPrinters();
    const normalized = requested.toLowerCase();
    const match = printers.find((printer) =>
      String(printer.name || '').toLowerCase() === normalized ||
      String(printer.displayName || '').toLowerCase() === normalized
    );

    if (!match) {
      const available = printers.map(p => p.displayName || p.name).filter(Boolean).join(', ');
      throw new Error(`Printer not found: ${requested}${available ? `. Available printers: ${available}` : ''}`);
    }

    return match.name;
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
      printWindow.webContents.print(printOpts, (success, errorType) => {
        resolve({ success, error: errorType || '' });
      });
    });
  }

  async _printViaPdfFallback(printWindow, deviceName, options = {}) {
    const tmpPdf = path.join(
      app.getPath('temp'),
      `posnic-print-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
    );

    try {
      const pdfBuffer = await printWindow.webContents.printToPDF({
        printBackground: true,
        marginsType: 1
      });
      fs.writeFileSync(tmpPdf, pdfBuffer);

      await this._printPdfFile(tmpPdf, {
        printer: deviceName,
        copies: parseInt(options.copies, 10) || 1,
      });
      console.log('Print job sent successfully via PDF fallback');
      return { success: true };
    } catch (error) {
      console.error('PDF print fallback failed:', error.message);
      return { success: false, error: error.message || 'PDF print fallback failed' };
    } finally {
      try {
        if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
      } catch (_) {}
    }
  }

  async _printWithSystemDefaultFallback(printWindow, options = {}) {
    console.warn('Retrying print with Windows default printer');

    let result = await this._sendPrintJob(printWindow, {
      silent: options.silent !== false,
      printBackground: true,
      margins: { marginType: 'none' },
      copies: Math.max(1, parseInt(options.copies, 10) || 1)
    });

    if (!result.success) {
      console.warn('Windows default Electron print failed, retrying default PDF fallback:', result.error || 'unknown');
      result = await this._printViaPdfFallback(printWindow, '', options);
    }

    return result;
  }

  /*
   * Decide where the print window will load the document from.
   *
   * Preferred: the local API, at http://127.0.0.1:<port>/print/<token>. The
   * page is then same-origin with print.css and the shop's logo, so nothing is
   * cross-origin and the window runs with web security on.
   *
   * Fallback: the document inline as a data: URL, which is what this always did.
   * That origin is opaque and cannot fetch the stylesheet, so the window needs
   * web security off. It is used only when the API is not there to serve from -
   * during startup, or in a build where the store did not ship.
   *
   * Chosen before the window is created, because webPreferences cannot be
   * changed afterwards.
   */
  _resolvePrintRoute(htmlContent) {
    const inline = {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
      secure: false,
      how: 'inline data: URL',
    };

    const port = Number(process.env.PORT);
    if (!port) return inline;

    try {
      /* Packaged, this sits in resources/ beside the API that serves it -
         both sides need the same instance, so it cannot live in the asar.
         See tests/credential-store-packaging.test.js for the same pattern. */
      const store = require(
        app.isPackaged
          ? require('path').join(process.resourcesPath, 'print-document-store')
          : './print-document-store'
      );
      const token = store.put(htmlContent);
      return {
        url: `http://127.0.0.1:${port}/print/${token}`,
        secure: true,
        how: 'local print route',
      };
    } catch (e) {
      console.warn('[Print] falling back to the inline document:', e.message);
      return inline;
    }
  }

  async printHTML(htmlContent, options = {}) {
    try {
      // Paper size dimensions in microns (1mm = 1000 microns)
      // Window width in pixels at 96dpi: px = mm / 25.4 * 96
      const paperSizes = {
        '50mm':  { width: 50000,  height: 1000000, windowWidth: 189 },
        '58mm':  { width: 58000,  height: 1000000, windowWidth: 220 },
        '80mm':  { width: 80000,  height: 1000000, windowWidth: 302 },
        '100mm': { width: 100000, height: 1000000, windowWidth: 378 },
        'a4':    { width: 210000, height: 297000,  windowWidth: 794 },
        'a5':    { width: 148000, height: 210000,  windowWidth: 559 },
        'letter':{ width: 216000, height: 279000,  windowWidth: 816 }
      };

      // Get pageSize from options or default to 80mm (3inch)
      const sizeKey = (options.pageSize || '80mm').toLowerCase();
      const pageSize = paperSizes[sizeKey] || paperSizes['80mm'];

      /*
       * Where the document is going to be loaded from, decided before the
       * window exists - because webSecurity cannot be changed afterwards.
       *
       * The invoice markup links print.css and the shop's logo from the local
       * API. Loaded as a data: URL the page has an opaque origin, which may not
       * fetch either, so that path needs web security off; served from the API
       * the page is same-origin with both, and needs no exception at all.
       *
       * The second is the real fix and is preferred. The first stays as a
       * fallback, because a shop that cannot print cannot trade, and "the
       * printing path is more secure now" is no comfort at a till with a queue.
       */
      const route = this._resolvePrintRoute(htmlContent);

      const printWindow = new BrowserWindow({
        show: false,
        width: pageSize.windowWidth,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          /* True whenever the document is served from the local origin. Only
             the data: fallback needs the exception. */
          webSecurity: route.secure
        }
      });

      hardenPrintWindow(printWindow);

      const deviceName = await this._resolvePrinterName(options.printerName);

      try {
        await printWindow.loadURL(route.url);
      } catch (loadError) {
        /* The local route was reachable a moment ago and is not now. Rather
           than fail the job, fall back to the document itself - the window was
           created with web security matching the route we chose, so this only
           costs the stylesheet, not the print. */
        if (route.secure) {
          console.warn('[Print] local print route failed, using the inline document:', loadError.message);
          await printWindow.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
          );
        } else {
          throw loadError;
        }
      }
      await this._waitForPrintPage(printWindow.webContents);

      const printOpts = {
        silent: options.silent !== false,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: pageSize,
        copies: Math.max(1, parseInt(options.copies, 10) || 1)
      };

      if (deviceName) {
        printOpts.deviceName = deviceName;
      }

      let result = await this._sendPrintJob(printWindow, printOpts);

      if (!result.success) {
        console.warn('Print failed with receipt page size, retrying with printer defaults:', result.error || 'unknown');
        const fallbackOpts = {
          silent: printOpts.silent,
          printBackground: true,
          margins: { marginType: 'none' },
          copies: printOpts.copies
        };
        if (deviceName) fallbackOpts.deviceName = deviceName;
        result = await this._sendPrintJob(printWindow, fallbackOpts);
      }

      if (!result.success) {
        console.warn('Electron print failed, retrying through PDF fallback:', result.error || 'unknown');
        result = await this._printViaPdfFallback(printWindow, deviceName, options);
      }

      if (!result.success && deviceName) {
        console.warn(`Named printer "${deviceName}" failed, falling back to Windows default printer`);
        result = await this._printWithSystemDefaultFallback(printWindow, options);
      }

      setTimeout(() => {
        if (!printWindow.isDestroyed()) printWindow.close();
      }, 100);

      if (result.success) {
        console.log('Print job sent successfully');
        return { success: true };
      }

      console.error('Print failed:', result.error || 'Print job failed');
      return { success: false, error: result.error || 'Print job failed' };
    } catch (error) {
      console.error('Failed to print:', error);
      return { success: false, error: error.message };
    }
  }

  async getDefaultPrinter() {
    try {
      const printers = await this.listPrinters();
      const defaultPrinter = printers.find(p => p.isDefault);
      if (defaultPrinter) {
        console.log('Default printer:', defaultPrinter.name);
        return defaultPrinter;
      }
      console.warn('No default printer found');
      return printers.length > 0 ? printers[0] : null;
    } catch (error) {
      console.error('Failed to get default printer:', error);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // CASH DRAWER
  // ─────────────────────────────────────────────

  _getConfigPath() {
    if (!this.cashDrawerConfigPath) {
      const base = app.getPath('userData');
      this.cashDrawerConfigPath = path.join(base, 'cash-drawer-config.json');
    }
    return this.cashDrawerConfigPath;
  }

  loadCashDrawerConfig() {
    try {
      const cfgPath = this._getConfigPath();
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch (e) {
      console.warn('[CashDrawer] Could not load config:', e.message);
    }
    return {
      method: 'serial',     // 'serial' | 'printer'
      port: '',
      baudRate: 9600,
      pin: 0,               // 0 = pin2, 1 = pin5
      printerName: '',
      autoOpenOnSale: false
    };
  }

  saveCashDrawerConfig(config) {
    try {
      fs.writeFileSync(this._getConfigPath(), JSON.stringify(config, null, 2));
      return { success: true };
    } catch (e) {
      console.error('[CashDrawer] Could not save config:', e.message);
      return { success: false, error: e.message };
    }
  }

  async connectCashDrawer(portPath, baudRate = 9600) {
    // Close previous port if open
    if (this.cashDrawerPort && this.cashDrawerPort.isOpen) {
      try { this.cashDrawerPort.close(); } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
    }
    try {
      this.cashDrawerPort = new SerialPort({ path: portPath, baudRate: Number(baudRate), lock: true });
      await new Promise((resolve, reject) => {
        this.cashDrawerPort.on('open', resolve);
        this.cashDrawerPort.on('error', reject);
        setTimeout(resolve, 2000); // fallback
      });
      console.log(`[CashDrawer] Connected to ${portPath} @ ${baudRate}`);
      return { success: true, port: portPath };
    } catch (err) {
      console.error('[CashDrawer] Connect failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async disconnectCashDrawer() {
    if (this.cashDrawerPort && this.cashDrawerPort.isOpen) {
      try {
        this.cashDrawerPort.close();
        this.cashDrawerPort = null;
        console.log('[CashDrawer] Disconnected');
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    this.cashDrawerPort = null;
    return { success: true };
  }

  getCashDrawerStatus() {
    const connected = !!(this.cashDrawerPort && this.cashDrawerPort.isOpen);
    return { connected, port: connected ? this.cashDrawerPort.path : null };
  }

  // Build ESC/POS open-drawer byte sequence
  // ESC p m t1 t2  (m=pin, t1=on-time×2ms, t2=off-time×2ms)
  _drawerCommand(pin = 0) {
    return Buffer.from([0x1b, 0x70, pin & 0x01, 0x19, 0xfa]);
  }

  async openCashDrawer(pin = 0) {
    if (!this.cashDrawerPort || !this.cashDrawerPort.isOpen) {
      return { success: false, error: 'Cash drawer not connected. Please connect first.' };
    }
    return new Promise((resolve) => {
      const cmd = this._drawerCommand(pin);
      this.cashDrawerPort.write(cmd, (err) => {
        if (err) {
          console.error('[CashDrawer] Write error:', err.message);
          resolve({ success: false, error: err.message });
        } else {
          this.cashDrawerPort.drain(() => {
            console.log(`[CashDrawer] Opened (pin ${pin === 0 ? 2 : 5})`);
            resolve({ success: true });
          });
        }
      });
    });
  }

  /*
   * The winspool RAW passthrough, as a PowerShell script.
   *
   * Kept in one place because two callers need it and a second copy would
   * drift. The marshalling is fiddly - DOCINFO has to reach StartDocPrinter as
   * an IntPtr, not a struct - and getting it wrong fails silently by printing
   * nothing at all.
   */
  _rawPrintScript(safePrinter, safeBin, docName) {
    return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPTStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPTStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPTStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr h, int lvl, IntPtr pDocInfo);
    [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
    [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safeBin}')
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$hPrinter = [IntPtr]::Zero
$di = New-Object RawPrint+DOCINFO
$di.pDocName = '${docName}'
$di.pDataType = 'RAW'
$diPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal([System.Runtime.InteropServices.Marshal]::SizeOf($di))
[System.Runtime.InteropServices.Marshal]::StructureToPtr($di, $diPtr, $false)
try {
    if ([RawPrint]::OpenPrinter('${safePrinter}', [ref]$hPrinter, [IntPtr]::Zero)) {
        $docId = [RawPrint]::StartDocPrinter($hPrinter, 1, $diPtr)
        if ($docId -gt 0) {
            [RawPrint]::StartPagePrinter($hPrinter) | Out-Null
            $w = 0
            [RawPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$w) | Out-Null
            [RawPrint]::EndPagePrinter($hPrinter) | Out-Null
            [RawPrint]::EndDocPrinter($hPrinter) | Out-Null
            [RawPrint]::ClosePrinter($hPrinter) | Out-Null
            Write-Output 'OK'
        } else {
            [RawPrint]::ClosePrinter($hPrinter) | Out-Null
            Write-Error "StartDocPrinter failed (docId=$docId)"; exit 1
        }
    } else {
        Write-Error 'Cannot open printer: ${safePrinter}'; exit 1
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($diPtr)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
`;
  }

  /*
   * Send bytes to a printer untouched.
   *
   * The same winspool RAW path the cash drawer already proved, lifted out so
   * receipts can use it too. RAW means the spooler hands the bytes to the
   * device without a driver rendering anything, which is the only way ESC/POS
   * reaches the printer intact.
   *
   * Works for USB, network and local queues without needing the printer
   * shared, which the alternatives all require.
   */
  async sendRawToPrinter(printerName, buffer, docName = 'Posnic Receipt') {
    if (!printerName) return { success: false, error: 'No printer chosen' };
    if (!buffer || !buffer.length) return { success: false, error: 'Nothing to print' };

    /*
     * Windows spools RAW through winspool; everything else goes through CUPS.
     *
     * This method was PowerShell and nothing else, so on macOS and Linux every
     * receipt failed with a message about a command the machine does not have.
     * `lp -o raw` is the same idea in CUPS terms: hand the bytes to the device
     * with no driver rendering anything, which is the only way ESC/POS arrives
     * intact. CUPS is installed by default on macOS and on any Linux desktop
     * that can already see a printer.
     */
    if (process.platform !== 'win32') {
      return this._sendRawViaCups(printerName, buffer, docName);
    }

    try {
      const stamp = Date.now();
      const tmpBin = path.join(app.getPath('temp'), `posnic_raw_${stamp}.bin`);
      const tmpPs1 = path.join(app.getPath('temp'), `posnic_raw_${stamp}.ps1`);
      fs.writeFileSync(tmpBin, buffer);

      const safePrinter = String(printerName).replace(/'/g, "''");
      const safeBin = tmpBin.replace(/\\/g, '\\\\');
      const safeDoc = String(docName).replace(/'/g, "''");

      fs.writeFileSync(tmpPs1, this._rawPrintScript(safePrinter, safeBin, safeDoc), 'utf8');
      const out = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`,
        { timeout: 20000 }
      ).toString().trim();

      // Best effort: a receipt already printed should not fail because a
      // temporary file could not be removed.
      try { fs.unlinkSync(tmpBin); fs.unlinkSync(tmpPs1); } catch (e) { /* ignore */ }

      if (out.includes('OK')) return { success: true, bytes: buffer.length };
      return { success: false, error: 'The spooler did not confirm the job' };
    } catch (err) {
      console.error('[Print] raw send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /*
   * The same job on macOS and Linux.
   *
   * `-o raw` is the part that matters: without it CUPS runs the bytes through
   * a filter that tries to interpret them as text, and an ESC/POS receipt
   * comes out as pages of control characters.
   *
   * execFile rather than a shell string, so a printer name with a space or a
   * quote in it is an argument and not something the shell gets to read.
   */
  _sendRawViaCups(printerName, buffer, docName) {
    const tmpBin = path.join(
      app.getPath('temp'),
      `posnic_raw_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`,
    );

    try {
      fs.writeFileSync(tmpBin, buffer);
      const { execFileSync } = require('child_process');
      execFileSync(
        'lp',
        ['-d', String(printerName), '-o', 'raw', '-t', String(docName || 'Posnic Receipt'), tmpBin],
        { timeout: 20000 },
      );
      return { success: true, bytes: buffer.length };
    } catch (err) {
      /* ENOENT means CUPS is not installed at all, which is worth saying
         plainly rather than reporting as a printer fault. */
      const missing = err && (err.code === 'ENOENT' || /not found/i.test(err.message || ''));
      console.error('[Print] raw send via CUPS failed:', err.message);
      return {
        success: false,
        error: missing
          ? 'CUPS printing is not available on this computer (the "lp" command is missing)'
          : err.message,
      };
    } finally {
      try { fs.unlinkSync(tmpBin); } catch (e) { /* a printed receipt must not fail on cleanup */ }
    }
  }

  /*
   * Send a PDF to a printer, whatever the machine is.
   *
   * pdf-to-printer bundles SumatraPDF-3.4.6-32.exe and has no platform branch
   * of its own - it is a Windows library. Calling it on macOS or Linux was the
   * second way printing failed there, after the raw path above.
   */
  async _printPdfFile(file, { printer, copies = 1 } = {}) {
    if (process.platform === 'win32') {
      const opts = { silent: true, copies: Math.max(1, copies), scale: 'fit' };
      if (printer) opts.printer = printer;
      await printPdf(file, opts);
      return;
    }

    const { execFile } = require('child_process');
    const args = [];
    if (printer) args.push('-d', String(printer));
    args.push('-n', String(Math.max(1, copies)), file);

    await new Promise((resolve, reject) => {
      execFile('lp', args, { timeout: 30000 }, (err) => {
        if (!err) return resolve();
        reject(err.code === 'ENOENT'
          ? new Error('CUPS printing is not available on this computer (the "lp" command is missing)')
          : err);
      });
    });
  }

  async openCashDrawerViaPrinter(printerName, pin = 0) {
    /*
     * A drawer kick is raw ESC/POS bytes sent to the receipt printer, which is
     * exactly what sendRawToPrinter does - so off Windows it goes through the
     * same CUPS path rather than repeating it. The PowerShell below stays for
     * Windows, where it is the proven route.
     */
    if (process.platform !== 'win32') {
      const result = this._sendRawViaCups(printerName, this._drawerCommand(pin), 'Posnic Cash Drawer');
      return result.success
        ? { success: true }
        : { success: false, error: result.error };
    }

    try {
      const cmd = this._drawerCommand(pin);
      const tmpBin = path.join(app.getPath('temp'), 'drawer_open.bin');
      const tmpPs1 = path.join(app.getPath('temp'), 'drawer_open.ps1');
      fs.writeFileSync(tmpBin, cmd);

      // Use Windows winspool API via PowerShell to send raw ESC/POS bytes
      // Works for USB, network, and local printers without requiring printer sharing
      const safePrinter = printerName.replace(/'/g, "''");
      const safeBin = tmpBin.replace(/\\/g, '\\\\');

      // Marshal struct to IntPtr for StartDocPrinter (correct approach)
      const psContent = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPTStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPTStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPTStr)]
        public string pDataType;
    }
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
    [DllImport("winspool.Drv")]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet=CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr h, int lvl, IntPtr pDocInfo);
    [DllImport("winspool.Drv")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")]
    public static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
    [DllImport("winspool.Drv")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv")]
    public static extern bool EndDocPrinter(IntPtr h);
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safeBin}')
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$hPrinter = [IntPtr]::Zero
$di = New-Object RawPrint+DOCINFO
$di.pDocName = 'CashDrawer'
$di.pDataType = 'RAW'
$diPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal([System.Runtime.InteropServices.Marshal]::SizeOf($di))
[System.Runtime.InteropServices.Marshal]::StructureToPtr($di, $diPtr, $false)
try {
    if ([RawPrint]::OpenPrinter('${safePrinter}', [ref]$hPrinter, [IntPtr]::Zero)) {
        $docId = [RawPrint]::StartDocPrinter($hPrinter, 1, $diPtr)
        if ($docId -gt 0) {
            [RawPrint]::StartPagePrinter($hPrinter) | Out-Null
            $w = 0
            [RawPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$w) | Out-Null
            [RawPrint]::EndPagePrinter($hPrinter) | Out-Null
            [RawPrint]::EndDocPrinter($hPrinter) | Out-Null
            [RawPrint]::ClosePrinter($hPrinter) | Out-Null
            Write-Output 'OK'
        } else {
            [RawPrint]::ClosePrinter($hPrinter) | Out-Null
            Write-Error "StartDocPrinter failed (docId=$docId)"; exit 1
        }
    } else {
        Write-Error 'Cannot open printer: ${safePrinter}'; exit 1
    }
} finally {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($diPtr)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
`;

      fs.writeFileSync(tmpPs1, psContent, 'utf8');
      const out = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`,
        { timeout: 10000 }
      ).toString().trim();

      if (out.includes('OK')) {
        console.log(`[CashDrawer] Opened via printer "${printerName}" (pin ${pin === 0 ? 2 : 5})`);
        return { success: true };
      }
      return { success: false, error: 'PowerShell winspool did not confirm success' };
    } catch (err) {
      console.error('[CashDrawer] Via-printer open failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async _openDrawerViaElectronPrint(printerName, pin = 0) {
    try {
      const pinHex = pin === 0 ? '\\x1B\\x70\\x00\\x19\\xFA' : '\\x1B\\x70\\x01\\x19\\xFA';
      const html = `<html><body>
        <script>
          document.write(String.fromCharCode(0x1B,0x70,${pin},0x19,0xFA));
        <\/script>
      </body></html>`;
      const result = await this.printHTML(html, { printerName, silent: true });
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = { HardwareManager };
