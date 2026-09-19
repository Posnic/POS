'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const core = read('frontend/static/script/js/core/PosnicPro.js');
const pdf = Buffer.from('%PDF-1.4\nsynthetic test document\n%%EOF');

function page(api, userAgent = 'Electron') {
  const alerts = [], opened = [], outputs = [], saved = [], sent = [];
  const box = {
    Uint8Array, Promise, navigator: { userAgent },
    window: { electronAPI: api, open: (...args) => { opened.push(args); return {}; } },
    PosnicPro: { alert: (...args) => alerts.push(args), i18n: { t: (_key, fallback) => fallback } },
  };
  const helper = core.slice(core.indexOf('    printPdfDocument: function'), core.indexOf('    reportExport: {'));
  box.PosnicPro.printPdfDocument = vm.runInNewContext('({' + helper + '}).printPdfDocument', box);
  const doc = {
    output: (kind) => { outputs.push(kind); return kind === 'arraybuffer' ? Uint8Array.from(pdf).buffer : 'blob:synthetic'; },
    autoPrint: () => sent.push('autoPrint'), save: (name) => saved.push(name),
  };
  return { ...box, box, doc, alerts, opened, outputs, saved, sent };
}

test('invoice, quote and PDF report print actions send the exact PDF to the desktop bridge', async () => {
  const sent = [];
  const p = page({ printer: { printPdf: async (bytes) => { sent.push(Buffer.from(bytes)); return { success: true }; } } });
  const sources = [
    ['invoices', read('frontend/static/script/js/modules/js/invoices.js'), 'printNow: function', '    print: function', '_withDoc'],
    ['quotes', read('frontend/static/script/js/modules/js/sales.js'), 'printNow: function', '    print: function', '_withQuoteDoc'],
    ['reportExport', core, 'printPdf: function (elId, meta)', '        _download: function', '_withPdf'],
  ];
  const pending = [];
  const helper = p.PosnicPro.printPdfDocument;
  p.PosnicPro.printPdfDocument = (...args) => { const result = helper(...args); pending.push(result); return result; };
  for (const [name, source, start, end, builder] of sources) {
    const at = source.indexOf(start);
    assert.ok(at >= 0);
    const method = vm.runInNewContext('({' + source.slice(at, source.indexOf(end, at)) + '})', p.box);
    p.PosnicPro[name] = { _current: {}, [builder]: (...args) => args.at(-1)(p.doc) };
    Object.values(method)[0]('report', { filename: 'report' });
  }
  await Promise.all(pending);
  assert.equal(sent.length, 3);
  sent.forEach((bytes) => assert.deepEqual(bytes, pdf));
  assert.deepEqual(p.opened, []);
  assert.deepEqual(p.alerts, []);
  assert.deepEqual(p.sent, [], 'desktop PDFs must not embed a second automatic print action');
});

test('a desktop print failure is reported without opening a popup or printing again', async () => {
  for (const printPdf of [async () => ({ success: false }), async () => { throw new Error('offline'); }]) {
    const p = page({ printer: { printPdf } });
    await p.PosnicPro.printPdfDocument(p.doc, 'invoice', 'Allow pop-ups');
    assert.equal(p.alerts.length, 1);
    assert.equal(p.alerts[0][0], 'error');
    assert.doesNotMatch(p.alerts[0][1], /pop-up/);
    assert.deepEqual(p.opened, []);
    assert.deepEqual(p.saved, []);
  }
});

test('cancelling desktop printing is quiet', async () => {
  const p = page({ printer: { printPdf: async () => ({ cancelled: true }) } });
  await p.PosnicPro.printPdfDocument(p.doc, 'invoice');
  assert.deepEqual(p.alerts, []);
  assert.deepEqual(p.opened, []);
});

test('older desktop versions download the PDF instead of asking to allow popups', async () => {
  for (const api of [undefined, { printer: {} }]) {
    const p = page(api);
    await p.PosnicPro.printPdfDocument(p.doc, 'INV-42');
    assert.deepEqual(p.saved, ['INV-42.pdf']);
    assert.equal(p.alerts[0][0], 'info');
    assert.match(p.alerts[0][1], /Update the desktop app/);
    assert.deepEqual(p.opened, []);
  }
});

test('normal browser printing retains its PDF print action and blocked-popup message', async () => {
  const p = page(undefined, 'Chrome');
  await p.PosnicPro.printPdfDocument(p.doc, 'invoice', 'Allow browser pop-ups');
  assert.deepEqual(p.outputs, ['bloburl']);
  assert.deepEqual(p.sent, ['autoPrint']);
  assert.deepEqual(p.opened, [['blob:synthetic', '_blank']]);
  assert.deepEqual(p.alerts, []);
  p.window.open = () => null;
  await p.PosnicPro.printPdfDocument(p.doc, 'invoice', 'Allow browser pop-ups');
  assert.deepEqual(p.alerts, [['warning', 'Allow browser pop-ups']]);
});

function desktop(t, platform, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-pdf-test-'));
  t.after(() => fs.rmdirSync(dir));
  const native = [], windows = [];
  class PrintWindow extends EventEmitter {
    constructor(config) {
      super(); this.config = config; windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => { this.popup = handler; };
      this.webContents.print = (settings, done) => {
        this.settings = settings;
        done(options.result !== false, options.reason);
      };
    }
    async loadFile(file) {
      this.bytes = fs.readFileSync(file);
      if (options.loadError) throw new Error('PDF could not load');
      if (options.closeEarly) this.destroy();
    }
    show() { this.shown = true; }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const box = {
    Buffer, Uint8Array, process: { platform }, module: { exports: {} },
    require: (name) => {
      if (name === 'electron') return { app: { getPath: () => dir }, BrowserWindow: PrintWindow };
      if (name === 'pdf-to-printer') return { print: async (file, settings) => {
        native.push({ bytes: fs.readFileSync(file), settings });
        if (options.nativeError) throw new Error('Print service unavailable');
      } };
      return require(name);
    },
  };
  vm.runInNewContext(read('src/print-pdf.js'), box);
  return { print: box.module.exports.printPdfDocument, dir, native, windows };
}

test('Windows opens the native PDF printer chooser without selecting the receipt printer', async (t) => {
  const d = desktop(t, 'win32');
  const result = await d.print(pdf);
  assert.equal(result.success, true);
  assert.equal(d.native.length, 1);
  assert.deepEqual(d.native[0].bytes, pdf);
  assert.equal(d.native[0].settings.printDialog, true);
  assert.equal(d.native[0].settings.scale, 'noscale');
  assert.equal(d.native[0].settings.printer, undefined);
  assert.equal(d.windows.length, 0);
  assert.deepEqual(fs.readdirSync(d.dir), []);
});

test('PDF validation refuses paths, URLs, non-PDF content and oversized documents before printing', async (t) => {
  const d = desktop(t, 'win32');
  for (const value of ['file:///private.pdf', 'https://example.com/a.pdf', Buffer.from('<html>'), new Uint8Array(26 * 1024 * 1024)]) {
    assert.equal((await d.print(value)).success, false);
  }
  assert.equal(d.native.length, 0);
  assert.deepEqual(fs.readdirSync(d.dir), []);
});

test('native printing failures clean up the temporary PDF and return an error', async (t) => {
  const d = desktop(t, 'win32', { nativeError: true });
  const result = await d.print(pdf);
  assert.equal(result.success, false);
  assert.match(result.error, /unavailable/);
  assert.deepEqual(fs.readdirSync(d.dir), []);
});

test('saved document settings select the Windows printer, paper and copies without a chooser', async (t) => {
  const d = desktop(t, 'win32');
  assert.equal((await d.print(pdf, { printerName: 'Invoice Office', paperSize: 'a5', copies: 3 })).success, true);
  assert.equal(d.native[0].settings.printer, 'Invoice Office');
  assert.equal(d.native[0].settings.paperSize, 'A5');
  assert.equal(d.native[0].settings.copies, 3);
  assert.equal(d.native[0].settings.printDialog, false);
});

test('saved document settings select the macOS/Linux printer and sheet size', async (t) => {
  const d = desktop(t, 'linux');
  await d.print(pdf, { printerName: 'Quotes', paperSize: 'letter', copies: 2 });
  assert.equal(d.windows[0].settings.deviceName, 'Quotes');
  assert.equal(d.windows[0].settings.pageSize, 'Letter');
  assert.equal(d.windows[0].settings.copies, 2);
  assert.equal(d.windows[0].settings.silent, true);
});

for (const platform of ['darwin', 'linux']) {
  test(platform + ' uses a sandboxed PDF window and a non-silent print dialog', async (t) => {
    const d = desktop(t, platform);
    assert.equal((await d.print(pdf)).success, true);
    const win = d.windows[0];
    assert.deepEqual(win.bytes, pdf);
    assert.equal(win.settings.silent, false);
    assert.equal(win.config.webPreferences.sandbox, true);
    assert.equal(win.config.webPreferences.nodeIntegration, false);
    assert.equal(win.config.webPreferences.preload, undefined);
    assert.equal(win.popup().action, 'deny');
    assert.equal(win.destroyed, true);
    assert.equal(d.native.length, 0);
    assert.deepEqual(fs.readdirSync(d.dir), []);
  });
}

test('PDF window cancellation and loading errors close the window and clean up', async (t) => {
  for (const options of [{ result: false, reason: 'Print job canceled' }, { closeEarly: true }, { loadError: true }]) {
    const d = desktop(t, 'linux', options);
    const result = await d.print(pdf);
    assert.ok(options.loadError ? result.success === false : result.cancelled);
    assert.equal(d.windows[0].destroyed, true);
    assert.deepEqual(fs.readdirSync(d.dir), []);
  }
});

test('the PDF bridge is registered through guarded IPC and shipped in the desktop package', () => {
  assert.match(read('src/preload.js'), /printPdf:\s*\(bytes, kind\) => ipcRenderer.invoke\('printer:print-pdf', bytes, kind\)/);
  const ipc = read('src/hardware-ipc.js');
  assert.match(ipc, /ipcMain = require\('\.\/ipc-guard'\).guard\(rawIpcMain\)/);
  assert.match(ipc, /ipcMain.handle\('printer:print-pdf'[\s\S]*?require\('\.\/print-pdf'\).printPdfDocument\(bytes/);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('src/print-pdf.js'));
});
