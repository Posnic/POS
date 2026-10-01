'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('saved sales reach the designer without legacy DOM or barcode canvas for every button', () => {
  const source = read('frontend/static/script/js/modules/js/sales_view.js');
  const start = source.indexOf('    printSale: function');
  const end = source.indexOf('    /* Shared by printing', start);
  for (const format of [undefined, 'standard', 'a4']) {
    let sent;
    const data = { sales_id: 'SALE-PK-1', receipt_barcode: true, items: [{ item_name: 'Tea', item_quantity: 1 }], items_total: 200 };
    const p = { sales: { view: { renderSaleDocument() { throw Error('Legacy template must not run'); } } },
      get: (_url, done) => done({ type: 'success', data }),
      receiptDesigner: { printSale: (...args) => { sent = args; } } };
    const chain = { show() { return this; }, html() { return this; } };
    const fn = vm.runInNewContext('({' + source.slice(start, end) + '}).printSale', { PosnicPro: p, $: () => chain });
    fn('id', 'sale', false, format);
    assert.equal(sent[0], data);
    assert.equal(sent[1], format || null);
    assert.equal(p._printTypeOverride, null);
  }
});

function printMethod(render) {
  const source = read('src/hardware-manager.js');
  const start = source.indexOf('  async printHTML(');
  return vm.runInNewContext('({' + source.slice(start, source.indexOf('\n  async getDefaultPrinter', start)) + '}).printHTML', {
    require: name => name === './escpos-unicode' ? { renderDesignedReceipt: render } : require(name),
    console: { error() {}, log() {} },
    Buffer,
    BrowserWindow: function () { throw Error('Must not use driver printing for thermal design'); },
  });
}

test('designed thermal copies use RAW once each, with distinct delivery identities', async () => {
  const calls = [];
  const method = printMethod(async () => Buffer.from('rendered receipt'));
  const ctx = { _resolvePrinterName: async () => 'BC 88AC', sendRawToPrinter: async (...args) => { calls.push(args); return { success: true }; } };
  const result = await method.call(ctx, '<article>Receipt</article>', { thermalRaster: true, pageSize: '80mm', copies: 2 });
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'BC 88AC');
  assert.notEqual(calls[0][3].jobId, calls[1][3].jobId);
});

test('capture-only renders the actual receipt but submits no copies and reports no delivery', async () => {
  const { DiagnosticSession } = require('../src/diagnostic-session');
  const session = new DiagnosticSession(); session.start(); session.setCapture(true);
  let preview, submits = 0;
  session.setPreview = html => { preview = html; };
  try {
    const result = await printMethod(async () => Buffer.from('raster')).call({
      diagnostic: () => session, _resolvePrinterName: async () => 'Counter',
      sendRawToPrinter: async () => { submits++; },
    }, '<article>Tea</article>', { thermalRaster: true, pageSize: '80mm', copies: 3 });
    assert.equal(result.success, false); assert.equal(result.diagnosticOnly, true);
    assert.equal(submits, 0); assert.equal(preview, '<article>Tea</article>');
    assert.equal(JSON.stringify(session.report()).includes('<article>'), false);
  } finally { session.stop(); }
});

test('render failure submits nothing; uncertain RAW failure never retries through HTML or PDF', async () => {
  let calls = 0;
  const ctx = { _resolvePrinterName: async () => 'Counter', sendRawToPrinter: async () => { calls++; return { success: false, error: 'Acceptance uncertain', retryable: false }; } };
  const opts = { thermalRaster: true, pageSize: '58mm', copies: 3 };
  const blank = await printMethod(async () => { throw Error('Rendered receipt is blank'); }).call(ctx, '', opts);
  assert.equal(blank.success, false); assert.equal(calls, 0);
  const failed = await printMethod(async () => Buffer.from('receipt')).call(ctx, '', opts);
  assert.equal(failed.error, 'Acceptance uncertain'); assert.equal(calls, 1);
});
