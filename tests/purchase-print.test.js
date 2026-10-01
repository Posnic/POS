const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const source = read('frontend/static/script/js/modules/js/receiving_view.js');
function setup(format = 'standard', options = {}) {
  const dom = new JSDOM('<div class="print-modal-body"><div id="receipt_wrapper" class="import-standard-print"><!-- empty until Settings opens --></div></div><div class="print-modal-a4-body"><div class="import-print"></div></div>', {runScripts: 'outside-only'});
  const w = dom.window, $ = require('jquery')(w);
  w.$ = w.jQuery = $;
  $.fn.number = function () { return this; };
  const calls = [], alerts = [], requests = [];
  const item = {item_name: 'Purchase rice', item_quantity: 2, item_unit: 'bag', item_price: 125, total_amount: 250, item_total_amount: 250, tax: 0, item_tax: 0, tax_type: 'exclusive', item_tax_type: 'exclusive', tax_fields: [], item_tax_fields: [], igst_tax: 0, cgst_tax: 0, item_igst_tax: 0, item_cgst_tax: 0, item_discount: 0, item_discount_percentage: 0};
  const data = {receiving_id: 'PUR-7', items_subtotal: 250, items_total: 250, tax: 0, return_tax: 0, items: [item], items_return: [], receipt_barcode: !!options.barcode, supplier_name: 'Supply shop', created_date: '01/10/2026'};
  const p = w.PosnicPro = {
    receivings: {}, i18n: {t: (key, fallback) => fallback}, roundoff: false,
    local: {get: key => ({branch_id_set: 'branch-1', currencySign: 'Rs', receiving_title: 'Purchase Invoice', receiving_return_title: 'Purchase Return', printing_size: 'receipt_medium'})[key]},
    resolvePrintType: () => format, alert: (...args) => alerts.push(args),
    printBarcode: () => { const canvas = w.document.getElementById('canvasTarget'); if (!canvas) throw Error('Missing barcode canvas'); canvas.toDataURL = () => 'data:image/png;base64,test'; },
    textOverflowPrintEllipsis: text => text, formatQuantity: qty => String(qty), nestedTaxCalculation: () => [], toggleVisibility: () => {},
    printView: (...args) => calls.push(args),
    get: (url, done, fail) => {
      requests.push(url);
      if (typeof url === 'object' && url.url === 'branches/getOneStore') {
        if (options.layoutFailure) return fail();
        return done({type: 'success', data: {branch_name: 'Test branch', print_standard_html: options.empty ? '' : read('api/src/json/print_standard_html.txt'), print_a4html: options.empty ? '' : read('api/src/json/print_a4html.txt')}});
      }
      if (options.apiFailure) return fail();
      if (options.badData) data.items_subtotal = null;
      if (typeof url === 'object') done({type: 'success', data: {custom_data: data, return_data: [item]}});
      else done({type: 'success', data});
    }
  };
  w.eval(source);
  return {dom, p, calls, alerts, requests};
}
for (const format of ['standard', 'a4']) {
  for (const returns of [false, true]) {
    test(`${format} ${returns ? 'purchase return' : 'purchase'} prints on fresh page without opening Settings`, () => {
      const s = setup(format);
      try {
        s.p.printBarcode = () => { throw Error('Disabled barcode must not be rendered'); };
        if (returns) s.p.receivings.view.returnPrintReceivings('id');
        else s.p.receivings.view.printReceivings('id', 'receiving');
        assert.deepEqual(s.alerts, []);
        assert.equal(s.calls.length, 1);
        assert.match(s.calls[0][0], /Purchase rice/);
        assert.match(s.calls[0][0], /250/);
        assert.match(s.calls[0][0], /Test branch/);
        assert.equal(s.calls[0][1], '');
      } finally { s.dom.window.close(); }
    });
  }
  test(`${format} barcode enabled renders only after template exists`, () => {
    const s = setup(format, {barcode: true});
    try { s.p.receivings.view.printReceivings('id', 'receiving'); assert.deepEqual(s.alerts, []); assert.equal(s.calls[0][1], 'data:image/png;base64,test'); }
    finally { s.dom.window.close(); }
  });
}
for (const option of ['layoutFailure', 'empty', 'apiFailure', 'badData']) {
  test(`${option} shows an error and sends no print`, () => {
    const s = setup('standard', {[option]: true});
    try { s.p.receivings.view.printReceivings('id', 'receiving'); assert.equal(s.calls.length, 0); assert.equal(s.alerts.length, 1); assert.equal(s.alerts[0][0], 'error'); }
    finally { s.dom.window.close(); }
  });
}

test('thermal purchase rows survive the real receipt extractor and ESC/POS renderer', () => {
  const s = setup();
  try {
    s.p.receivings.view.printReceivings('id', 'receiving');
    s.dom.window.eval(read('frontend/static/script/js/core/receipt-data.js'));
    const receipt = s.p.receiptData(s.calls[0][0]);
    assert.equal(receipt.items.length, 1);
    assert.equal(receipt.items[0].name, 'Purchase rice');
    assert.equal(receipt.items[0].qty, '2 bag');
    assert.equal(receipt.items[0].amount, 250);
    const bytes = require('../src/escpos-receipt').renderSale(receipt, {columns: 48});
    assert.match(bytes.toString('ascii'), /Purchase rice/);
    assert.match(bytes.toString('ascii'), /250/);
  } finally { s.dom.window.close(); }
});
