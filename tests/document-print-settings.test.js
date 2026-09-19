'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { documentPrintSettings, validateDocumentPrintSettings } = require('../src/device-preferences');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const initial = () => ({ sales: [{ name: 'Counter', pageSize: '80mm', copies: 1 }],
  invoice: { printerName: 'Office', paperSize: 'a4', copies: 2 },
  quotation: { printerName: '', paperSize: 'letter', copies: 1 } });

test('printer profiles migrate current and legacy receipts without borrowing their printer for invoices', () => {
  const current = documentPrintSettings({ receipt_printers: JSON.stringify(initial().sales) });
  assert.deepEqual(current.sales, initial().sales);
  assert.equal(current.invoice.printerName, '');
  assert.equal(current.quotation.paperSize, 'a4');
  const old = documentPrintSettings({ receipt_printer: 'Till', print_width: '2inch' });
  assert.deepEqual(old.sales, [{ name: 'Till', pageSize: '58mm', copies: 1 }]);
  assert.doesNotThrow(() => documentPrintSettings({ receipt_printers: '{broken', document_print_profiles: '{broken' }));
});

test('profile validation refuses invalid copies, repeated printers and thermal invoice formats', () => {
  assert.deepEqual(validateDocumentPrintSettings(initial()), initial());
  for (const mutate of [v => { v.sales = []; }, v => { v.sales.push(v.sales[0]); },
    v => { v.invoice.copies = 0; }, v => { v.quotation.copies = 21; },
    v => { v.invoice.paperSize = '80mm'; }, v => { v.sales[0].name = 'Counter\nOther'; }]) {
    const value = initial(); mutate(value);
    assert.throws(() => validateDocumentPrintSettings(value));
  }
});

function ipc(prefs, file, fileSystem = fs) {
  const handlers = {};
  const source = read('src/hardware-ipc.js');
  const from = source.indexOf("  ipcMain.handle('printer:get-document-settings'");
  const end = source.indexOf('\n  /*', from);
  new Function('ipcMain', 'require', 'preferences', 'fs', '_prefsPath', source.slice(from, end))(
    { handle: (key, fn) => { handlers[key] = fn; } },
    () => ({ documentPrintSettings, validateDocumentPrintSettings }), prefs, fileSystem, file);
  return handlers;
}

test('saving profiles persists independently, survives reload and retains other device settings', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-profiles-')), file = path.join(dir, 'preferences.json');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  const prefs = { 'hardware.weightMachine': { port: 'COM7' } }, h = ipc(prefs, file);
  assert.equal(h['printer:save-document-settings']({}, initial()).success, true);
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted['hardware.weightMachine'].port, 'COM7');
  assert.equal(persisted.receipt_printer, 'Counter');
  assert.equal(persisted.print_width, '80mm');
  assert.deepEqual(documentPrintSettings(persisted), initial());
  assert.deepEqual(h['printer:get-document-settings'](), initial());
});

test('a failed settings write is reported and does not change active printer choices', () => {
  const prefs = { receipt_printer: 'Old' }, before = clone(prefs);
  const h = ipc(prefs, 'unused', { writeFileSync: () => { throw new Error('Disk full'); } });
  assert.equal(h['printer:save-document-settings']({}, initial()).success, false);
  assert.deepEqual(prefs, before);
});

test('PDF IPC applies only the requested document profile and refuses an unavailable named printer', async () => {
  const source = read('src/hardware-ipc.js'), captured = [], handlers = {};
  const from = source.indexOf("  ipcMain.handle('printer:print-pdf'");
  const end = source.indexOf('\n  });', from) + 6;
  const profiles = initial(); profiles.quotation.printerName = 'Estimates';
  let queues = [{ name: 'Office' }, { name: 'Estimates' }];
  new Function('ipcMain', 'require', 'BrowserWindow', 'hardwareManager', source.slice(from, end))(
    { handle: (key, fn) => { handlers[key] = fn; } },
    name => name === './device-preferences' ? { documentPrintSettings: () => profiles } : {
      printPdfDocument: async (_bytes, options) => { captured.push(options); return { success: true }; },
    }, { fromWebContents: () => null }, { listPrinters: async () => queues });
  const print = handlers['printer:print-pdf'];
  await print({}, Buffer.from('%PDF-'), 'invoice');
  await print({}, Buffer.from('%PDF-'), 'quotation');
  await print({}, Buffer.from('%PDF-'), 'report');
  assert.equal(captured[0].printerName, 'Office');
  assert.equal(captured[0].copies, 2);
  assert.equal(captured[1].printerName, 'Estimates');
  assert.equal(captured[1].paperSize, 'letter');
  assert.equal(captured[2].printerName, undefined);
  queues = [];
  assert.equal((await print({}, Buffer.from('%PDF-'), 'invoice')).success, false);
  assert.equal(captured.length, 3, 'missing named printer must not fall back to another queue');
});

function page(t, desktop = true) {
  const dom = new JSDOM('<div id="document-print-settings"></div>', { url: 'http://localhost/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, $ = require('jquery')(w), store = {};
  w.$ = w.jQuery = $;
  w.PosnicPro = { escapeHtml: value => $('<i>').text(value).html(), i18n: { t: (_k, text) => text },
    local: { get: key => store[key], set: (key, value) => { store[key] = value; } } };
  let saved = initial();
  if (desktop) w.electronAPI = { preferences: {}, printer: {
    getDocumentSettings: async () => clone(saved),
    saveDocumentSettings: async value => { saved = validateDocumentPrintSettings(value); return { success: true, settings: clone(saved) }; },
    list: async () => [{ name: 'Counter' }, { name: 'Office' }, { name: 'Estimates' }],
  } };
  w.eval(read('frontend/static/script/js/core/print-settings.js'));
  return { w, $, store, settings: w.PosnicPro.printSettings, saved: () => clone(saved) };
}

test('invoice and quotation controls appear only for enabled features and update without reload', async (t) => {
  const p = page(t);
  for (const off of [false, 'false', undefined, null]) {
    await p.settings.mount({ invoices_enable: off, quotes_enable: off });
    assert.equal(p.$('[data-profile="invoice"]').prop('hidden'), true);
    assert.equal(p.$('[data-profile="quotation"]').prop('hidden'), true);
  }
  p.settings.features({ invoices_enable: true, quotes_enable: false });
  assert.equal(p.$('[data-profile="invoice"]').prop('hidden'), false);
  assert.equal(p.$('[data-profile="quotation"]').prop('hidden'), true);
  p.settings.features({ invoices_enable: 'true', quotes_enable: 'enable' });
  assert.equal(p.$('[data-profile="quotation"]').prop('hidden'), false);
});

test('settings save separate destinations, paper and copies and reload the saved values', async (t) => {
  const p = page(t);
  await p.settings.mount({ invoices_enable: true, quotes_enable: true });
  const invoice = p.$('[data-profile="invoice"]'), quote = p.$('[data-profile="quotation"]');
  invoice.find('[data-setting="printer"]').val('Office');
  invoice.find('[data-setting="paper"]').val('a5');
  quote.find('[data-setting="printer"]').val('Estimates');
  quote.find('[data-setting="copies"]').val('3');
  await p.settings.save();
  assert.equal(p.saved().invoice.paperSize, 'a5');
  assert.equal(p.saved().quotation.printerName, 'Estimates');
  assert.equal(p.saved().quotation.copies, 3);
  assert.deepEqual(p.saved().sales, initial().sales);
  await p.settings.mount({ invoices_enable: true, quotes_enable: true });
  assert.equal(p.$('[data-profile="invoice"] [data-setting="paper"]').val(), 'a5');
  assert.match(p.store.document_print_profiles, /Estimates/);
});

test('saving sales does not erase hidden module settings or quietly change unavailable printers', async (t) => {
  const p = page(t);
  p.w.electronAPI.printer.list = async () => [{ name: 'Counter' }];
  await p.settings.mount({ invoices_enable: false, quotes_enable: false });
  p.$('[data-profile="sales"] [data-setting="paper"]').val('58mm');
  await p.settings.save();
  assert.deepEqual(p.saved().invoice, initial().invoice);
  assert.deepEqual(p.saved().quotation, initial().quotation);
  assert.equal(p.saved().sales[0].pageSize, '58mm');
});

test('browser settings do not promise printer selection and preserve paper choices', async (t) => {
  const p = page(t, false);
  await p.settings.mount({ invoices_enable: true });
  assert.equal(p.$('[data-setting="printer"]').length, 0);
  assert.equal(p.$('[data-profile="invoice"] [data-setting="copies"]').prop('disabled'), true);
  p.$('[data-profile="invoice"] [data-setting="paper"]').val('a5');
  await p.settings.save();
  await p.settings.ready();
  assert.equal(p.settings.get('invoice').paperSize, 'a5');
});

test('sales send each saved layout and copy count only to its configured printer', async (t) => {
  const p = page(t), prints = [], errors = [];
  const values = initial(); values.sales.push({ name: 'Office', pageSize: 'a5', copies: 2 });
  p.w.electronAPI.printer.getDocumentSettings = async () => clone(values);
  p.w.electronAPI.printer.print = async (html, options) => { prints.push({ html, options: clone(options) }); return { success: true }; };
  p.w.PosnicPro.alert = (_level, msg) => errors.push(msg);
  p.w.PosnicPro.afterPrint = () => {};
  p.w.eval(read('api/src/helpers/receipt-design.js'));
  p.w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
  await p.w.PosnicPro.receiptDesigner.printSale({ branch_name: 'Test Shop', items: [{ item_name: 'Cup', item_price: 20, item_quantity: 1 }], items_total: 20 });
  assert.deepEqual(errors, []);
  assert.deepEqual(prints.map(x => [x.options.printerName, x.options.pageSize, x.options.copies]), [['Counter', '80mm', 1], ['Office', 'a5', 2]]);
  assert.match(prints[0].html, /data-receipt-design="80"/);
  assert.match(prints[1].html, /data-receipt-design="a5"/);
  assert.equal(prints[0].options.strictPrinter, true);
});

test('an explicitly chosen sales printer never falls back to the system default', async () => {
  const source = read('src/hardware-manager.js');
  const start = source.indexOf('  async printHTML('), end = source.indexOf('\n  async getDefaultPrinter', start);
  const names = [];
  class Window {
    constructor() { this.webContents = {}; }
    async loadURL() {}
    isDestroyed() { return true; }
  }
  const method = vm.runInNewContext('({' + source.slice(start, end) + '}).printHTML', {
    BrowserWindow: Window, hardenPrintWindow() {}, setTimeout() {}, console: { log() {}, warn() {}, error() {} },
  });
  const context = {
    _resolvePrintRoute: () => ({ url: 'data:text/html,test', secure: false }),
    _resolvePrinterName: async () => 'Counter', _waitForPrintPage: async () => {},
    _sendPrintJob: async (_win, opts) => { names.push(opts.deviceName); return { success: false, error: 'Offline' }; },
    _printViaPdfFallback: async (_win, name) => { names.push(name); return { success: false, error: 'Offline' }; },
    _printWithSystemDefaultFallback: async () => { throw new Error('wrong printer'); },
  };
  const result = await method.call(context, '<p>Sample</p>', { printerName: 'Counter', strictPrinter: true });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Offline');
  assert.deepEqual(names, ['Counter', 'Counter', 'Counter']);
});

test('invoice and quotation PDFs use actual A4, A5 and Letter pages with content inside the paper', () => {
  const { jsPDF } = require('../frontend/static/script/js/jspdf.umd.min.js');
  const source = read('frontend/static/script/js/modules/js/sales.js');
  const from = source.indexOf('_buildPdf: function'), end = source.indexOf('    printNow: function', from);
  const builder = vm.runInNewContext('({' + source.slice(from, end) + '})._buildPdf', {
    PosnicPro: { i18n: { t: (_key, text) => text }, quotes: {} },
  });
  for (const [paper, width, height] of [['a4', 210, 297], ['a5', 148, 210], ['letter', 215.9, 279.4]]) {
    for (const invoice of [false, true]) {
      const positions = [];
      function PDF(options) {
        const doc = new jsPDF(options), original = doc.text;
        doc.text = function (text, x, y, opts) {
          const lines = Array.isArray(text) ? text : [text];
          for (const line of lines) {
            const size = doc.getTextWidth(line), align = opts && opts.align;
            const left = align === 'right' ? x - size : align === 'center' ? x - size / 2 : x;
            positions.push({ line, left, right: left + size, y });
          }
          return original.apply(doc, arguments);
        };
        return doc;
      }
      const data = { quote_id: 'Q-001', customer_name: 'Sample Customer', customer_address: 'Example street, Example city',
        created_date: '2026-09-19', total: 240, subtotal: 240, terms: 'Sample payment terms. '.repeat(25),
        items: Array.from({ length: 18 }, () => ({ item_name: 'Notebook with recycled paper', qty: 2, unit_price: 12, line_total: 24 })) };
      const doc = builder(PDF, data, { name: 'Sample Shop', email: 'shop@example.com' }, null,
        { paperSize: paper, ...(invoice ? { title: 'INVOICE', number: 'INV-001', headLines: ['Date: 19/09/2026'], afterTotal: [{ label: 'Balance due', value: 'Rs 240.00' }] } : {}) });
      assert.ok(Math.abs(doc.internal.pageSize.getWidth() - width) < 0.01);
      assert.ok(Math.abs(doc.internal.pageSize.getHeight() - height) < 0.01);
      assert.ok(doc.getNumberOfPages() > 1);
      for (const pos of positions) assert.ok(pos.left >= 5 && pos.right <= width - 5 && pos.y <= height - 4,
        paper + ': text outside paper: ' + JSON.stringify(pos));
    }
  }
});
