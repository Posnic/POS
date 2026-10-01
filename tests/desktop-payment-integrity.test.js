'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
function setup(status = 'Unpaid', payments = { Upi: 250 }) {
  const dom = new JSDOM('<div id="payment_id"></div><input id="Partial_amount" value="262.50"><input id="unpaid_payment_toggle" type="checkbox" checked><button id="save_btn"></button><span id="return_balance_amount"></span><input id="sales_new_customer_partial_balance">', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  const $ = require('jquery')(win);
  win.$ = win.jQuery = $;
  win.setTimeout = (fn) => fn();
  win.PosnicPro = { local: { get: () => 'Rs.' }, configPaymentType: [{ payment_value: 'Upi' }], alert: (_type, message) => { win.lastError = message; }, sales: {
    extraDiscount: { sale_new_tot: 262.5 }, EditRecentSaleParams: { sales_total: 262.5, payment_status: status, multi_payment: payments }, paymentOnlyMode: true
  } };
  for (const name of ['showMultiPaymentMode', 'payableCap', 'initPaymentValidation', 'openTenderModel']) {
    const start = source.indexOf('    ' + name + ': function');
    const end = source.indexOf('\n    },', start);
    assert.ok(start >= 0 && end > start);
    win.eval('PosnicPro.sales.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  }
  return { dom, win, $, sales: win.PosnicPro.sales };
}
test('unpaid bill renders full taxed UPI amount and method switching preserves it', () => {
  const { dom, $, sales } = setup();
  sales.showMultiPaymentMode();
  assert.equal(Number($('#upi_input').val()), 262.5);
  assert.equal($('#save_btn').prop('disabled'), false);
  $('#Cash').closest('button').trigger('click');
  assert.equal(Number($('#cash_input').val()), 262.5);
  $('#Upi').closest('button').trigger('click');
  assert.equal(Number($('#upi_input').val()), 262.5);
  assert.equal(Number($('#cash_input').val()), 0);
  dom.window.close();
});
test('existing paid tender discrepancy is not silently increased', () => {
  const { dom, $, sales } = setup('Paid');
  sales.showMultiPaymentMode();
  assert.equal(Number($('#upi_input').val()), 250);
  assert.equal($('#save_btn').prop('disabled'), true);
  dom.window.close();
});
test('partial tender is preserved', () => {
  const { dom, $, sales } = setup('Partialy Paid', { Upi: 100 });
  sales.EditRecentSaleParams.partial_amounts = 100;
  $('#Partial_amount').val('100');
  sales.showMultiPaymentMode();
  assert.equal(Number($('#upi_input').val()), 100);
  dom.window.close();
});
for (const computed of [250, 260, NaN]) {
  test('payment-only stops before opening a repriced bill: ' + computed, () => {
    const { dom, $, sales, win } = setup();
    sales.extraDiscount.sale_new_tot = computed;
    sales.openTenderModel();
    assert.match(win.lastError, /differs from the saved bill/);
    assert.equal($('#save_btn').prop('disabled'), true);
    assert.equal($('#payment_id').children().length, 0);
    dom.window.close();
  });
}


test('Azure Table 6 payment sums full-precision lines before rounding, matching the API', () => {
  const { dom, $, sales, win } = setup('Unpaid', {});
  const { computeLineTax } = require('../api/src/services/tax-engine');
  const { calculateSaleHeader } = require('../api/src/services/sale-header');
  const amounts = [350,300,300,380,340,360,700,340,120,300,250,60,600,294,94.5,63,136.5,136.5,273];
  const totals = amounts.map(value => computeLineTax({ itemAmount: value, sellingPrice: value, itemQuantity: 1, itemTax: 5, taxType: 'exclusive' }).total);
  const expected = calculateSaleHeader({}, totals.reduce((n, v) => n + v, 0), { roundOff: false }).salesTotalForDoc;
  assert.equal(expected, 5667.37);
  assert.equal(Number(totals.reduce((n, v) => n + Number(v.toFixed(2)), 0).toFixed(2)), 5667.36);
  $('body').append('<table id="sales_new_items_table"><tbody></tbody></table><input id="grand_total"><span id="extraDisc">0</span><span id="percentIcon" class="d-none"></span><span id="sales_new_grand_total"></span>');
  totals.forEach((total, id) => {
    $('#sales_new_items_table tbody').append('<tr>' + '<td></td>'.repeat(8) + '<td>' + id + '</td><td>line</td></tr>');
    $('body').append('<span id="addSalesLineTotal_' + id + '">' + total.toFixed(2) + '</span><span id="returnLineTotal_' + id + '">' + total + '</span><input id="touchsale_item_qty' + id + '" value="1"><span id="addSalesGstTax_' + id + '">' + (total - amounts[id]) + '</span>');
  });
  $.fn.number = function (value) { return this.text(Number(value).toFixed(2)); };
  win.db = { customerDisplay: { put: () => {}, get: () => Promise.resolve(null) } };
  sales.customerBalanceCheck = () => {};
  sales.taxFeatureOn = () => true;
  sales.chargesTotal = sales.chargesTax = () => 0;
  sales.calculation = { billLevelDiscount: () => 0 };
  for (const name of ['salesTableRowCart', 'extraDiscoundCalculation']) {
    const start = source.indexOf('    ' + name + ': function');
    const end = source.indexOf('\n    },', start);
    win.eval('PosnicPro.sales.calculation.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  }
  sales.calculation.salesTableRowCart();
  assert.equal(sales.extraDiscount.sale_new_tot, expected);
  sales.EditRecentSaleParams.sales_total = expected;
  sales.EditRecentSaleParams.multi_payment = { Upi: expected };
  $('#Partial_amount').val(expected);
  sales.showMultiPaymentMode();
  assert.equal(Number($('#upi_input').val()), expected);
  assert.equal($('#save_btn').prop('disabled'), false);
  dom.window.close();
});
