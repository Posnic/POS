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


for (const method of ['Cash', 'Card', 'Upi', 'Google Pay', 'Bank Transfer', 'Qrpay', 'Razorpay']) {
  test('full fractional payable survives payment method selection: ' + method, () => {
    const { dom, $, win, sales } = setup('Unpaid', { [method]: 5397.5 });
    win.PosnicPro.configPaymentType = ['Card','Upi','Google Pay','Bank Transfer'].map(payment_value => ({ payment_value }));
    win.localStorage.setItem('payment_gateway', 'true');
    sales.extraDiscount.sale_new_tot = sales.EditRecentSaleParams.sales_total = 5667.37;
    $('#Partial_amount').val('5667.37');
    sales.showMultiPaymentMode();
    const id = ['Qrpay','Razorpay'].includes(method) ? 'qrpay' : method.toLowerCase().replace(/\s/g, '');
    assert.equal(Number($('#' + id + '_input').val()), 5667.37);
    for (const next of ['Cash','Card','Upi','Google Pay','Bank Transfer','Qrpay']) {
      $(win.document.getElementById(next)).closest('button').trigger('click');
      const sum = $('.payment-amount-input').get().reduce((n, el) => n + Number(el.value || 0), 0);
      assert.equal(Math.round(sum * 100), 566737);
      assert.equal($('#save_btn').prop('disabled'), false);
    }
    dom.window.close();
  });
}

test('split and partial payments preserve recorded amounts and reject overpayment', () => {
  const { dom, $, win, sales } = setup('Partialy Paid', { Cash: 1000, Card: 4667.37 });
  win.PosnicPro.configPaymentType = [{payment_value:'Card'}, {payment_value:'Upi'}];
  sales.extraDiscount.sale_new_tot = sales.EditRecentSaleParams.sales_total = 5667.37;
  sales.EditRecentSaleParams.partial_amounts = 5667.37;
  $('#Partial_amount').val('5667.37');
  sales.showMultiPaymentMode();
  assert.equal(Number($('#cash_input').val()), 1000);
  assert.equal(Number($('#card_input').val()), 4667.37);
  assert.equal($('#save_btn').prop('disabled'), false);
  $('#card_input').val('4668.37').trigger('input');
  assert.equal($('#save_btn').prop('disabled'), true);
  dom.window.close();
});

// Exercise the real saved-order loader and real row insertion, rather than
// constructing an already-calculated DOM. Row order affects half-paisa sums.
test('Azure saved Table 6 loads into payment at the printed total through real cart rows', () => {
  const { dom, $, sales, win } = setup('Unpaid', {});
  $('body').append('<table id="sales_new_items_table"><tbody></tbody></table><input id="grand_total"><span id="extraDisc">0</span><span id="percentIcon" class="d-none"></span><span id="sales_new_grand_total"></span>');
  $.fn.number = function (value) { return this.text(Number(value).toFixed(2)); };
  $.fn.editable = function () { return this; };
  win.billingWindowId = null;
  win.db = { customerDisplay: { put: () => {}, add: () => {}, get: () => Promise.resolve(null) } };
  win.PosnicPro.escapeHtml = value => $('<i>').text(value == null ? '' : value).html();
  win.PosnicPro.i18n = { t: (_key, fallback) => fallback };
  win.PosnicPro.local.get = key => key === 'general_settings' ? '{}' : '';
  win.PosnicPro.commonEditDate = () => {};
  Object.assign(sales, {
    setDefaults: () => {}, view: { changeExtraDiscType: () => {} },
    recentMenu: { setEditSalesDetails: () => {} }, SaleTableLineItems: {},
    quantity: { formatQty: value => value },
    searchItem: () => false, _applyPriceList: value => value,
    _needsTodaysPrice: () => false, checkAutoWeightTrigger: () => {},
    customerBalanceCheck: () => {}, taxFeatureOn: () => true,
    chargesTotal: () => 0, chargesTax: () => 0,
    calculation: { billLevelDiscount: () => 0 }
  });
  function load(owner, name) {
    const start = source.indexOf('    ' + name + ': function');
    const end = source.indexOf('\n    },', start);
    win.eval(owner + '.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  }
  load('PosnicPro.sales', 'addSalesLineItems');
  load('PosnicPro.sales.recentMenu', 'editItems');
  load('PosnicPro.sales.calculation', 'salesTableRowCart');
  load('PosnicPro.sales.calculation', 'extraDiscoundCalculation');
  const units = [350,300,300,380,340,360,350,340,60,100,250,30,300,294,47.25,31.5,136.5,136.5,136.5];
  const quantities = [1,1,1,1,1,1,2,1,2,3,1,2,2,1,2,2,1,1,2];
  const bill = {
    sales_id: 'SB1D28-27-000130', sales_total: 5667.37, sales_sub_total: 5397.5,
    tax: 269.87, payment_status: 'Unpaid', sale_process: 'KOT', table_number: '6',
    person_count: 10, extra_discount: 0, extra_discount_type: 'price',
    items: units.map((price, index) => ({ item_id: 'line' + index, item_name: 'Dish ' + index,
      item_price: price, item_quantity: quantities[index], item_discount: 0,
      item_discount_percentage: 0, tax: 5, tax_type: 'exclusive', company_price_total: 0 }))
  };
  let opened = 0;
  sales.openTenderModel = () => {
    assert.equal(sales.extraDiscount.sale_new_tot, bill.sales_total,
      'real saved-order loading must retain the printed payable before opening tender');
    $('#Partial_amount').val(sales.extraDiscount.sale_new_tot);
    sales.showMultiPaymentMode();
    opened++;
  };
  sales.recentMenu.editItems('saved-table6', bill, 'edit');
  assert.equal(opened, 1);
  assert.equal($('#sales_new_items_table tbody tr').length, 19);
  assert.equal(Number($('#cash_input').val()), 5667.37);
  assert.equal($('#save_btn').prop('disabled'), false);
  assert.deepEqual($('#sales_new_items_table tbody tr').get().map(row => row.id),
    units.map((_price, index) => 'touch_row_line' + index));
  win.PosnicPro.configPaymentType = ['Card', 'Upi', 'Google Pay', 'Bank Transfer'].map(payment_value => ({ payment_value }));
  win.localStorage.setItem('payment_gateway', 'true');
  sales.showMultiPaymentMode();
  for (const method of ['Cash', 'Card', 'Upi', 'Google Pay', 'Bank Transfer', 'Qrpay']) {
    $(win.document.getElementById(method)).closest('button').trigger('click');
    const sum = $('.payment-amount-input').get().reduce((total, input) => total + Number(input.value || 0), 0);
    assert.equal(Math.round(sum * 100), 566737, method + ' must collect the printed total');
    assert.equal($('#save_btn').prop('disabled'), false);
  }
  dom.window.close();
});

test('opening tender refreshes local payment methods before showing choices', () => {
  const { dom, sales, win } = setup();
  let reply, opened = false;
  win.PosnicPro.get = (url, callback) => { assert.equal(url, 'setting/getPaymentAll'); reply = callback; };
  sales.openTenderModel();
  assert.equal(sales._loadingPaymentMethods, true);
  sales.openTenderModel = ready => { opened = ready; };
  reply({ type: 'success', data: [{ payment_value: 'Upi' }] });
  assert.equal(opened, true);
  assert.equal(win.PosnicPro.configPaymentType[0].payment_value, 'Upi');
  dom.window.close();
});

test('failed payment-method reload keeps cached UPI and does not open a cash-only tender', () => {
  const { dom, sales, win } = setup();
  win.PosnicPro.i18n = { t: (_key, text) => text };
  win.PosnicPro.get = (_url, _done, fail) => fail();
  sales.openTenderModel();
  assert.equal(win.PosnicPro.configPaymentType[0].payment_value, 'Upi');
  assert.match(win.lastError, /Could not load payment settings/);
  assert.equal(sales._loadingPaymentMethods, false);
  dom.window.close();
});
