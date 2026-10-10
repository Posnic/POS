'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { rows } = require('../api/src/helpers/sale-payment-summary');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('saved split shapes retain each allocation without double counting Captain totals', () => {
  const expected = [{ method: 'UPI', amount: 300 }, { method: 'Cash', amount: 200 }];
  for (const multi_payment of [{ Upi: 300, Cash: 200 }, '{"Upi":300,"Cash":200}', [{ method: 'upi', amount: 300 }, { method: 'cash', amount: 200 }]]) {
    assert.deepEqual(rows({ multi_payment, payment_mode: 'Upi', items_total: 500 }), expected);
  }
  assert.deepEqual(rows({ captain_payments: [{ method: 'Mixed', amount: 500, tenders: [{ method: 'upi', amount: 300 }, { method: 'cash', amount: 200 }] }] }), expected);
  assert.deepEqual(rows({ multi_payment: { Cash: 100, cash: 100, UPI: 0, Card: -10, Bad: 'bad' } }), [{ method: 'Cash', amount: 200 }]);
});

test('unpaid and historical mixed bills never invent collected money', () => {
  assert.deepEqual(rows({ payment_mode: 'Cash', payment_status: 'Unpaid', items_total: 500 }), []);
  assert.deepEqual(rows({ payment_mode: 'Cash,UPI', payment_status: 'Paid', items_total: 500 }), []);
  assert.deepEqual(rows({ payment_mode: 'Cash', payment_status: 'Unpaid', partial_check: true, partial_balance: 200, items_total: 500 }), [{ method: 'Cash', amount: 200 }]);
  assert.deepEqual(rows({ payment_mode: 'Card', payment_status: 'Paid', sales_total: 500 }), [{ method: 'Card', amount: 500 }]);
});

test('sale sheet and designed receipts display the same split and escape method names', () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const w = dom.window;
  w.$ = w.jQuery = require('jquery')(w);
  w.PosnicPro = { sales: {}, local: { get: k => k === 'currencySign' ? '₹' : '' }, i18n: { t: (_k, fallback) => fallback } };
  w.PosnicPro.escapeHtml = value => w.$('<span>').text(value).html();
  w.eval(read('api/src/helpers/sale-payment-summary.js'));
  w.eval(read('api/src/helpers/receipt-design.js'));
  w.eval(read('src/receipt-page-layout.js'));
  w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
  const source = read('frontend/static/script/js/modules/js/sales.js');
  const start = source.indexOf('    buildSaleSheet: function');
  const end = source.indexOf('\n    },', start);
  w.eval('PosnicPro.sales.buildSaleSheet = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  const data = { sales_id: 'S-1', payment_status: 'Paid', payment_mode: 'Mixed', multi_payment: '{"Upi":300,"Cash":200}', items: [], items_total: 500, sales_total: 500 };
  data.receipt_designs = w.PosnicPro.receiptDesigner.defaults(data);
  const htmls = [w.PosnicPro.sales.buildSaleSheet(data), ...['a4', '80', '58'].map(format => w.PosnicPro.receiptDesigner.render(data, format, false))];
  htmls.forEach(html => {
    const content = w.$('<div>').html(html).text();
    assert.match(content, /UPI\s*₹\s*300\.00/);
    assert.match(content, /Cash\s*₹\s*200\.00/);
    assert.doesNotMatch(content, /UPI\s*₹\s*500\.00/);
  });
  data.multi_payment = { '<img src=x onerror=alert(1)>': 500 };
  assert.equal(w.$('<div>').html(w.PosnicPro.sales.buildSaleSheet(data)).find('img').length, 0);
  dom.window.close();
});
