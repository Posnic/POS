'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { renderReceipt, needsRaster, layout } = require('../src/escpos-unicode');
const { renderSale } = require('../src/escpos-receipt');
const { parse } = require('../src/escpos-preview');

const sale = {
  storeName: 'متجر التجربة', storeAddress: 'القاهرة', billNo: 'TEST-001', currency: 'ج.م ',
  customer: ['عبدالله'], serviceRows: [{ label: 'طاولة', value: '12' }],
  items: [{ name: 'شاي بالنعناع', qty: '2 كوب', rate: '15.00', amount: 30 },
    { name: 'Coffee', qty: '1', rate: '25.00', amount: 25 }],
  subTotal: 55, taxes: [{ label: 'ضريبة', amount: 5 }], total: 60,
  extras: [{ label: 'الدفع', value: 'نقداً' }], footer: 'شكراً لزيارتكم',
};

test('ASCII receipts retain their existing bytes and never start Chromium', async () => {
  const english = { ...sale, storeName: 'Shop', storeAddress: '', currency: '€',
    customer: [], serviceRows: [], items: [{ name: 'Coffee', qty: '1', amount: 25 }],
    taxes: [], extras: [], footer: 'Thank you' };
  for (const paperWidth of ['58', '80']) {
    const options = { paperWidth, openDrawer: true, cut: false };
    assert.deepEqual(await renderReceipt(english, options, () => assert.fail('Started renderer')), renderSale(english, options));
  }
});

test('Arabic is detected in every printed section, including digits and presentation forms', () => {
  assert.equal(needsRaster({ items: [{ name: 'Tea شاي' }] }), true);
  assert.equal(needsRaster({ storeName: 'متجر', items: [] }), true);
  assert.equal(needsRaster({ extras: [{ value: '١٢٣' }] }), true);
  assert.equal(needsRaster({ footer: '\ufefb' }), true);
  assert.equal(needsRaster({ logo: { src: 'https://example.com/شاي.png' }, items: [{ name: 'Tea' }] }), false);
});

test('Arabic names, units, customer, taxes, payments and footer survive layout on both rolls', () => {
  for (const paperWidth of ['58', '80']) {
    const plan = layout(sale, { paperWidth });
    const dom = new JSDOM(plan.body);
    const text = dom.window.document.body.textContent;
    for (const expected of ['شاي بالنعناع', '2 كوب', 'Coffee', 'القاهرة', 'عبدالله', 'طاولة', 'ضريبة', 'نقداً', 'شكراً لزيارتكم', 'ج.م 60.00']) assert.ok(text.includes(expected), expected);
    assert.equal(plan.width, paperWidth === '58' ? 384 : 576);
    assert.equal(dom.window.document.querySelector('td.name div').dir, 'auto');
    dom.window.close();
  }
});

test('long and mixed-language names are neither truncated nor treated as markup', () => {
  const name = 'قهوة عربية Coffee 250g '.repeat(20) + '<img src=x onerror=alert(1)>';
  const plan = layout({ ...sale, items: [{ name, qty: 1, amount: 10 }] }, { paperWidth: '58' });
  const dom = new JSDOM(plan.body);
  assert.equal(dom.window.document.querySelector('td.name div').textContent, name);
  assert.equal(dom.window.document.querySelector('img'), null);
  dom.window.close();
});

test('graphics reach the raw byte stream and preview with cut and drawer semantics', async () => {
  for (const paperWidth of ['58', '80']) {
    const width = paperWidth === '58' ? 384 : 576;
    const bitmap = Buffer.alloc(width / 8 * 30, 0x55);
    const bytes = await renderReceipt(sale, { paperWidth, openDrawer: true, drawerPin: 1 }, async plan => {
      assert.ok(plan.body.includes('شاي بالنعناع'));
      return [{ width, height: 30, data: bitmap.toString('base64') }];
    });
    const doc = parse(bytes, width / 12);
    const image = doc.rows.find(row => row.kind === 'raster');
    assert.equal(image.wBytes * 8, width);
    assert.deepEqual(Buffer.from(image.data, 'base64'), bitmap);
    assert.equal(doc.rows.filter(row => row.kind === 'cut').length, 1);
    assert.ok(bytes.includes(Buffer.from([27, 112, 1, 25, 250])));
    const preview = await renderReceipt(sale, { paperWidth, cut: false }, async () => [{ width, height: 30, data: bitmap.toString('base64') }]);
    assert.equal(preview.includes(Buffer.from([27, 112])), false);
    assert.equal(parse(preview).rows.some(row => row.kind === 'cut'), false);
  }
});

test('a renderer failure does not silently print a receipt with blank Arabic names', async () => {
  await assert.rejects(renderReceipt(sale, {}, async () => { throw new Error('Font unavailable'); }), /Font unavailable/);
});

test('prepared logo and footer bitmaps survive and untrusted image URLs never enter the page', () => {
  const picture = { width: 8, height: 1, data: 'gA==' };
  const plan = layout({ ...sale, logo: picture, footerImage: picture, footerImageCaption: 'امسح الرمز' });
  assert.equal(plan.pictures.length, 2);
  assert.ok(plan.body.includes('امسح الرمز'));
  assert.equal(layout({ ...sale, logo: { src: 'https://example.com/logo' } }).body.includes('https:'), false);
});

test('the offline Arabic font and its licence ship in the desktop package', () => {
  const pkg = require('../package.json');
  for (const file of ['src/escpos-unicode.js', 'src/fonts/NotoSansArabic.ttf', 'src/fonts/NotoSansArabic-OFL.txt']) {
    assert.ok(pkg.build.files.includes(file), `${file} is missing from the installer`);
    assert.ok(fs.statSync(path.join(__dirname, '..', file)).size > 0);
  }
});

function desktop(render) {
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const load = createRequire(path.join(__dirname, '../src/hardware-ipc.js'));
  const handlers = new Map(), jobs = [], logs = [];
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/hardware-ipc.js'), 'utf8'), {
    module: mod, console: { log() {}, warn() {}, error() {} }, global: {}, process, setTimeout() {},
    require(name) {
      if (name === 'electron') return { app: { getPath: () => path.join(__dirname, 'fixtures/no-user-data') },
        ipcMain: { handle: (key, handler) => handlers.set(key, handler) } };
      if (name === './essae-weight-reader') return {};
      if (name === './receipt-log') return { record: record => logs.push(record) };
      if (name === './escpos-unicode') return { renderReceipt: (data, opts) => renderReceipt(data, opts, render) };
      return load(name);
    },
  });
  mod.exports.setupHardwareIPC({ sendRawToPrinter: async (name, bytes) => { jobs.push({ name, bytes }); return { success: true }; } });
  const event = { senderFrame: { url: 'http://localhost:5555/dashboard.html' } };
  return { call: (key, ...args) => handlers.get(key)(event, ...args), jobs, logs };
}

test('desktop preview and print use the same Arabic dots and preserve targets and copies', async () => {
  const app = desktop(async plan => [{ width: plan.width, height: 3, data: Buffer.alloc(plan.width / 8 * 3, 0xa5).toString('base64') }]);
  const preview = await app.call('printer:preview-receipt', sale, { paperWidth: '58', openDrawer: true });
  assert.equal(app.jobs.length, 0);
  assert.equal(app.logs.length, 0);
  const result = await app.call('printer:print-receipt', sale, {
    printers: [{ name: 'Counter', pageSize: '58mm', copies: 2 }, { name: 'Office', pageSize: '80mm', copies: 1 }],
  });
  assert.equal(result.success, true);
  assert.equal(result.printed, 3);
  assert.deepEqual(app.jobs.map(job => job.name), ['Counter', 'Counter', 'Office']);
  assert.deepEqual(app.jobs[0].bytes, app.jobs[1].bytes);
  assert.deepEqual(parse(app.jobs[0].bytes, 32), preview);
  assert.equal(parse(app.jobs[2].bytes).rows.find(row => row.kind === 'raster').wBytes, 72);
  assert.equal(app.logs.length, 1);
});

test('desktop reports raster failures without spooling or logging a successful blank receipt', async () => {
  const app = desktop(async () => { throw new Error('Arabic receipt font did not load'); });
  const result = await app.call('printer:print-receipt', sale, { printerName: 'Counter' });
  assert.equal(result.success, false);
  assert.match(result.error, /font did not load/);
  assert.equal(app.jobs.length, 0);
  assert.equal(app.logs[0].printers[0].status, 'failed');
});
