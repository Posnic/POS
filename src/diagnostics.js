'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const diagnostic = require('./diagnostic-session');
function probe(port) {
  return new Promise(resolve => {
    const started = Date.now(); const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = status => { if (done) return; done = true; socket.destroy(); resolve({ port, status, durationMs: Date.now() - started }); };
    socket.setTimeout(2000); socket.on('connect', () => finish('reachable'));
    socket.on('error', error => finish(error.code || 'unreachable')); socket.on('timeout', () => finish('timeout'));
  });
}
function setup({ ipcMain, hardware, sync, audio }) {
  const pkg = require('../package.json');
  const marker = pkg.posnicDiagnostic || {};
  const service = new diagnostic.DiagnosticSession({ directory: path.join(app.getPath('userData'), 'diagnostics'),
    baseUrl: marker.endpoint || 'https://support.posnic.com',
    build: { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node,
      diagnosticBuild: marker.enabled === true, buildId: marker.buildId || 'standard', sourceCommit: marker.sourceCommit || 'unknown', sourceDirty: marker.sourceDirty, sourceDigest: marker.sourceDigest || 'unknown' },
    providers: {
      system: () => ({ platform: process.platform, arch: process.arch, osRelease: os.release(), totalMemory: os.totalmem(),
        freeMemory: os.freemem(), appMemory: process.memoryUsage().rss, appUptimeSeconds: Math.round(process.uptime()),
        systemUptimeSeconds: Math.round(os.uptime()), cpuCount: os.cpus().length, locale: app.getLocale(),
        disk: fs.statfsSync ? (() => { const d = fs.statfsSync(app.getPath('userData')); return { availableBytes: d.bavail * d.bsize }; })() : null }),
      services: () => Promise.all([probe(Number(process.env.PORT) || 5555), probe(Number(process.env.POSNIC_MONGO_PORT) || 47017)]),
      printers: async () => {
        const manager = hardware();
        if (!manager) return { status: 'not initialized' };
        const printers = await manager.listPrinters();
        const result = await Promise.all(printers.slice(0, 4).map(async p => {
          const item = { name: p.name, displayName: p.displayName, isDefault: p.isDefault, status: p.status };
          if (process.platform === 'win32') {
            try { item.health = await require('./windows-printer-transport').inspect(p.name, {}, false); }
            catch (error) { item.error = diagnostic.redact(error.message); }
          }
          return item;
        }));
        return { printers: result, omitted: Math.max(0, printers.length - result.length) };
      },
      printQueue: () => {
        const q = hardware()?.windowsPrintQueue;
        return { initialized: !!q, jobs: q ? [...q.jobs.values()].slice(-30).map(j => ({ id: j.id, printer: j.printer,
          state: j.state, reason: j.reason, spoolerId: j.spoolerId, retries: j.retries,
          submitted: j.submitted, accepted: j.accepted, observed: j.observed })) : [] };
      },
      printHelper: () => require('./raw-print-service').status(),
      sync: () => ({ running: !!sync()?.child, stopped: !!sync()?.stopped }),
      audio: () => audio?.() || { status: 'not initialized' },
      configuration: () => {
        const p = require('./device-preferences').documentPrintSettings();
        return { sales: p.sales, invoice: p.invoice, quotation: p.quotation };
      },
    } });
  diagnostic.set(service);
  app.on('child-process-gone', (_event, details) => service.record('renderer', { stage: 'child-process-gone', code: String(details.exitCode), message: details.reason }));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_e, details) => service.record('renderer', { stage: 'process-gone', code: String(details.exitCode), message: details.reason }));
    contents.on('did-fail-load', (_e, code, description) => service.record('renderer', { stage: 'load-failed', code: String(code), message: description }));
  });
  let window, preview = null;
  service.setPreview = html => { if (service.holdPrint()) preview = String(html).slice(0, 2 * 1024 * 1024); };
  const trustedPage = pathToFileURL(path.join(__dirname, 'diagnostics.html')).href;
  function local(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedPage) throw Error('Open Support diagnostics to perform this action');
  }
  const localAction = fn => (event, ...args) => { local(event); return fn(...args); };
  ipcMain.handle('diagnostics:state', localAction(() => service.state()));
  ipcMain.handle('diagnostics:start', localAction(async () => { preview = null; service.start(); await service.snapshot(); return service.state(); }));
  ipcMain.handle('diagnostics:stop', localAction(() => { preview = null; return service.stop(); }));
  ipcMain.handle('diagnostics:capture', localAction(value => service.setCapture(value)));
  ipcMain.handle('diagnostics:snapshot', localAction(() => service.snapshot()));
  ipcMain.handle('diagnostics:report', localAction(() => service.id ? service.report() : service.previous()));
  ipcMain.handle('diagnostics:preview', localAction(() => preview));
  ipcMain.handle('diagnostics:connect', localAction(({ code, consent } = {}) => service.connect(code, consent)));
  ipcMain.handle('diagnostics:upload', localAction(() => service.upload()));
  ipcMain.handle('diagnostics:export', localAction(async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Export redacted diagnostic report', defaultPath: 'Posnic-diagnostic-' + (service.id || 'previous') + '.json.gz', filters: [{ name: 'Compressed diagnostic report', extensions: ['json.gz'] }] });
    if (result.canceled) return { canceled: true };
    service.export(result.filePath); return { saved: true };
  }));
  // Renderer telemetry accepts only the structured allowlist, never request bodies.
  ipcMain.handle('diagnostics:event', (_event, type, fields) => { service.record(type, fields); return { recorded: service.active }; });
  function open() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 1040, height: 780, minWidth: 720, title: 'Posnic Support diagnostics',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    // Allow only the sandboxed local srcdoc preview; block links/meta redirects.
    window.webContents.on('will-frame-navigate', event => {
      if (event.isMainFrame || event.url !== 'about:srcdoc') event.preventDefault();
    });
    window.loadFile(path.join(__dirname, 'diagnostics.html'));
    // Closing the visible control ends remote access and capture-only mode.
    window.on('closed', () => { service.stop('window-closed'); preview = null; window = null; });
  }
  app.on('before-quit', () => service.stop('app-closing'));
  if (marker.enabled === true) {
    service.start();
    app.whenReady().then(() => { open(); service.snapshot().catch(() => {}); });
  }
  return { open, service };
}
module.exports = { setup, probe };
