'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { renderSale, COLUMNS } = require('../escpos-receipt');
const { blockAt } = require('./helpers/source-lookup');

/*
 * Supplementary client-side evidence for the public vendor-neutral fixture.
 *
 * This does not pretend to drive a packaged Electron application, a physical
 * printer, or a payment provider. It exercises two smaller boundaries that
 * can be reproduced without those systems:
 *
 *   - fixture-shaped receipt markup through Posnic's shipped HTML extractor
 *     and ESC/POS byte renderer;
 *   - the shipped pre-completion cart-clear handler in a DOM, with every
 *     network method instrumented to fail if it is called.
 */

const ROOT = path.join(__dirname, '..');
const RECEIPT_DATA_SOURCE = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'),
  'utf8',
);
const SALES_SOURCE = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8',
);

const SALE_001_HTML = `
  <section>
    <h1 class="print_store_name">Fixture Test Shop</h1>
    <div class="print_store_address">Synthetic address - no real business</div>
    <div class="print-custom-title">SALES RECEIPT</div>
    <span class="print_view_id">SALE-001</span>
    <span class="print_date">2026-08-22</span>

    <div class="row receipt-row-item-holder">
      <span class="invoice-content-heading">Counter Sample A</span>
      <span class="item-qty">2 each</span>
      <span class="item-total">XTS 20.00</span>
    </div>
    <div class="row receipt-row-item-holder">
      <span class="invoice-content-heading">Counter Sample B</span>
      <span class="item-qty">2 each</span>
      <span class="item-total">XTS 27.50</span>
    </div>
    <div class="row receipt-row-item-holder" style="display: none">
      <span class="invoice-content-heading">Hidden template row</span>
      <span class="item-qty">99 each</span>
      <span class="item-total">XTS 999.00</span>
    </div>

    <div class="row">
      <span class="invoice-footer-value">Sub total:</span>
      <span class="invoice-footer-value">XTS 45.00</span>
    </div>
    <div class="row">
      <span class="invoice-footer-value">Synthetic tax:</span>
      <span class="invoice-footer-value">XTS 2.50</span>
    </div>
    <div class="row">
      <span class="invoice-footer-value">Total:</span>
      <span class="invoice-footer-value">XTS 47.50</span>
    </div>
    <div class="row">
      <span class="invoice-footer-value">Tender label:</span>
      <span class="invoice-footer-value">Cash</span>
    </div>
    <div class="invoice-policy">Synthetic fixture only; no real transaction.</div>
  </section>`;

function extractReceipt(html) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const $ = require('jquery')(dom.window);
  const PosnicPro = {};
  new dom.window.Function('PosnicPro', '$', RECEIPT_DATA_SOURCE)(PosnicPro, $);
  return PosnicPro.receiptData(html);
}

function decodeEscPos(buffer) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const lines = [];
  const controls = [];
  let line = '';

  for (let i = 0; i < buffer.length;) {
    const byte = buffer[i];
    if (byte === ESC) {
      const command = buffer[i + 1];
      if (command === 0x40) { controls.push('initialize'); i += 2; continue; }
      if (command === 0x61 || command === 0x45 || command === 0x74) { i += 3; continue; }
      if (command === 0x64) { lines.push(line); line = ''; i += 3; continue; }
      if (command === 0x70) { controls.push('drawer'); i += 5; continue; }
      i += 2;
      continue;
    }
    if (byte === GS) {
      const command = buffer[i + 1];
      if (command === 0x21) { i += 3; continue; }
      if (command === 0x56) { controls.push('cut'); i += 4; continue; }
      i += 2;
      continue;
    }
    if (byte === 0x0a) {
      lines.push(line);
      line = '';
      i += 1;
      continue;
    }
    line += String.fromCharCode(byte);
    i += 1;
  }
  if (line) lines.push(line);
  return { lines, controls };
}

test('SALE-001 fixture arithmetic survives the shipped receipt HTML extractor', () => {
  const sale = extractReceipt(SALE_001_HTML);

  assert.strictEqual(sale.storeName, 'Fixture Test Shop');
  assert.strictEqual(sale.title, 'SALES RECEIPT');
  assert.strictEqual(sale.billNo, 'SALE-001');
  assert.deepStrictEqual(sale.items, [
    { name: 'Counter Sample A', qty: '2 each', amount: 20 },
    { name: 'Counter Sample B', qty: '2 each', amount: 27.5 },
  ]);
  assert.strictEqual(sale.subTotal, 45);
  assert.deepStrictEqual(sale.taxes, [{ label: 'Synthetic tax', amount: 2.5 }]);
  assert.strictEqual(sale.total, 47.5);
  assert.deepStrictEqual(sale.extras, [{ label: 'Tender label', value: 'Cash' }]);
  assert.strictEqual(sale.footer, 'Synthetic fixture only; no real transaction.');

  const lineTotal = sale.items.reduce((sum, item) => sum + item.amount, 0);
  assert.strictEqual(lineTotal, 47.5, 'the extracted receipt lines must reconcile to XTS 47.50');
  assert.strictEqual(sale.subTotal + sale.taxes[0].amount, sale.total);
});

test('SALE-001 renders bounded, deterministic ESC/POS bytes for both roll widths', (t) => {
  const sale = extractReceipt(SALE_001_HTML);
  const hashes = new Set();

  for (const width of ['58', '80']) {
    const bytes = renderSale(sale, { paperWidth: width });
    const { lines, controls } = decodeEscPos(bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    hashes.add(sha256);
    t.diagnostic(`${width}mm receipt: ${bytes.length} bytes, sha256=${sha256}`);

    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(bytes.length > 0);
    assert.deepStrictEqual(controls, ['initialize', 'cut']);
    assert.ok(!controls.includes('drawer'), 'a receipt must not pulse a drawer unless requested');
    assert.ok(lines.some((line) => line.includes('Counter Sample A')));
    assert.ok(lines.some((line) => line.includes('Counter Sample B')));
    assert.ok(lines.some((line) => line.startsWith('TOTAL') && line.endsWith('47.50')));
    for (const line of lines) {
      assert.ok(
        line.length <= COLUMNS[width],
        `${width}mm line is ${line.length} columns: ${JSON.stringify(line)}`,
      );
    }
  }

  assert.strictEqual(hashes.size, 2, '58mm and 80mm output should be independently laid out');
});

function bootPreCompletionVoid() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="sales_new_item_name" value="Counter Sample A">
    <span class="tax-sales-line-total">9.99</span>
    <input id="tax" value="2.50">
    <div id="reset_modal"></div>
  </body></html>`, { url: 'https://fixture.invalid/#sales/new' });
  const $ = require('jquery')(dom.window);
  const calls = {
    renderCharges: 0,
    setDefaults: 0,
    customerViewDisplay: 0,
    alerts: [],
    network: [],
  };

  $.fn.modal = function modal(action) {
    this.attr('data-modal-action', action);
    return this;
  };

  const failOnNetwork = (method) => (...args) => {
    calls.network.push({ method, args });
    throw new Error(`pre-completion void attempted ${method}`);
  };
  const PosnicPro = {
    get: failOnNetwork('GET'),
    post: failOnNetwork('POST'),
    put: failOnNetwork('PUT'),
    delete: failOnNetwork('DELETE'),
    alert: (type, message) => calls.alerts.push({ type, message }),
    sales: {
      charges: [{ label: 'Synthetic charge', amount: 1 }],
      SaleTableLineItems: [{ item_id: 'ITEM-001', quantity: 3 }],
      renderCharges: () => { calls.renderCharges += 1; },
      setDefaults: () => { calls.setDefaults += 1; },
      customerViewDisplay: () => { calls.customerViewDisplay += 1; },
      clear: {},
    },
  };

  const source = blockAt(
    SALES_SOURCE,
    'PosnicPro.sales.clear.cartItems = function (isFalse) {',
  );
  new dom.window.Function('PosnicPro', '$', 'window', `${source};`)(PosnicPro, $, dom.window);

  return { dom, $, PosnicPro, calls };
}

test('VOID-001 client handler clears an unsaved basket without a network posting', () => {
  const { dom, $, PosnicPro, calls } = bootPreCompletionVoid();

  PosnicPro.sales.clear.cartItems();

  assert.deepStrictEqual(PosnicPro.sales.charges, []);
  assert.deepStrictEqual(PosnicPro.sales.SaleTableLineItems, []);
  assert.strictEqual($('#sales_new_item_name').val(), '');
  assert.strictEqual($('.tax-sales-line-total').html(), '0.00');
  assert.strictEqual($('#reset_modal').attr('data-modal-action'), 'hide');
  assert.strictEqual(dom.window.document.activeElement.id, 'sales_new_item_name');
  assert.strictEqual(calls.renderCharges, 1);
  assert.strictEqual(calls.setDefaults, 1);
  assert.strictEqual(calls.customerViewDisplay, 1);
  assert.deepStrictEqual(calls.alerts, [{ type: 'success', message: 'Sale cancelled.' }]);
  assert.deepStrictEqual(calls.network, [], 'an unsaved basket clear must not call an API');
});

test('VOID-001 client handler can clear silently without changing posting behavior', () => {
  const { PosnicPro, calls } = bootPreCompletionVoid();

  PosnicPro.sales.clear.cartItems(false);

  assert.deepStrictEqual(PosnicPro.sales.SaleTableLineItems, []);
  assert.deepStrictEqual(calls.alerts, []);
  assert.deepStrictEqual(calls.network, []);
});
