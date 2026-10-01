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
  win.PosnicTaxEngine = require('../frontend/static/script/js/core/tax-engine');
  win.setTimeout = (fn) => fn();
  win.PosnicPro = { local: { get: () => 'Rs.' }, configPaymentType: [{ payment_value: 'Upi' }], alert: (_type, message) => { win.lastError = message; }, sales: {
    extraDiscount: { sale_new_tot: 262.5 }, EditRecentSaleParams: { sales_total: 262.5, payment_status: status, multi_payment: payments }, paymentOnlyMode: true
  } };
  for (const name of ['sub', 'showMultiPaymentMode', 'getPaymentObject', 'payableCap', 'initPaymentValidation', 'openTenderModel']) {
    const start = source.indexOf('    ' + name + ': function');
    const end = source.indexOf('\n    },', start);
    assert.ok(start >= 0 && end > start);
    win.eval('PosnicPro.sales.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  }
  return { dom, win, $, sales: win.PosnicPro.sales };
}

test('split payment keeps configured method spelling in the submitted ledger', () => {
  const { dom, win, $, sales } = setup('Unpaid', { Cash: 262.5 });
  win.PosnicPro.configPaymentType = [{ payment_value: 'QA Card' }, { payment_value: 'UPI' }];
  // Include the real delegated handler: selecting a tender rewrites radio values.
  const handlerStart = source.indexOf('$(document).on(\'change\', \'.payment_mode\'');
  const handlerEnd = source.indexOf('\n});', handlerStart) + 4;
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  win.eval(source.slice(handlerStart, handlerEnd));
  sales.showMultiPaymentMode();
  $('#cash_input').val('100').trigger('input');
  $('#qacard_input').closest('.payment-method-card').find('button').trigger('click');
  $('#qacard_input').val('100').trigger('input');
  $('#upi_input').closest('.payment-method-card').find('button').trigger('click');
  $('#UPI').prop('checked', true).trigger('change');
  assert.equal($('#Cash').val(), 'UPI');
  assert.deepEqual(JSON.parse(JSON.stringify(sales.getPaymentObject())), {
    Cash: 100, 'QA Card': 100, UPI: 62.5
  });
  assert.equal($('#save_btn').prop('disabled'), false);
  dom.window.close();
});
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
function savedOrderSetup() {
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
  load('PosnicPro.sales', 'savedSellingPrice');
  load('PosnicPro.sales', 'addSalesLineItems');
  load('PosnicPro.sales.recentMenu', 'editItems');
  load('PosnicPro.sales.calculation', 'salesTableRowCart');
  load('PosnicPro.sales.calculation', 'extraDiscoundCalculation');
  return { dom, $, sales, win };
}

test('Azure saved Table 6 loads into payment at the printed total through real cart rows', () => {
  const { dom, $, sales, win } = savedOrderSetup();
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

test('partially paid history keeps a settlement action and shows the remaining balance', () => {
  const { dom, win, $, sales } = setup();
  win.PosnicPro.i18n = { t: (_key, fallback) => fallback };
  win.PosnicPro.convertDate = value => value;
  $('body').append('<div id="sales_doc"></div><div id="sales_list_rows"></div>');
  const bill = { _id: 'abc', sales_id: 'QA-PARTIAL', payment_status: 'Partialy Paid', sales_total: 100,
    sales_sub_total: 100, partial_balance: 40, payment_pending: 60, items: [] };
  for (const name of ['buildSaleSheet', 'renderSaleDoc', 'loadHistory']) {
    const start = source.indexOf('    ' + name + ': function');
    const end = source.indexOf('\n    },', start);
    win.eval('PosnicPro.sales.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
  }
  sales.mountHistoryFilters = () => {};
  sales.renderHistoryPager = () => {};
  win.PosnicPro.listFilter = { legacyFilters: () => ({}), request: (_key, _options, done) => done({ data: { list: [bill] } }) };
  win.PosnicPro.listSort = { value: () => '' };
  sales.loadHistory();
  assert.equal($('#sales_list_rows .rs-pill').text(), 'Partial');
  sales.renderSaleDoc(bill);
  assert.match($('#sales_doc').text(), /Take Payment/);
  assert.match($('#sales_doc').text(), /PARTIALLY PAID/);
  assert.match($('#sales_doc').text(), /Pending: Rs\.\s*60\.00/);
  assert.doesNotMatch($('#sales_doc').text(), /Pending: Rs\.\s*40\.00/);
  dom.window.close();
});


test('app order with inclusive and exclusive tax keeps its saved payable when loaded for payment', () => {
  const { dom, $, sales } = savedOrderSetup();
  const bill = { sales_id: 'QA-APP', sales_total: 201.75, sales_sub_total: 192.14,
    tax: 9.61, payment_status: 'Unpaid', sale_process: 'KOT', extra_discount: 0,
    items: [
      { item_id: 'paratha', item_name: 'Paratha', item_price: 45, item_quantity: 3, tax: 5,
        tax_type: 'exclusive', pricing: { version: 1, selling_price: 45 } },
      { item_id: 'water', item_name: 'Water', item_price: 28.57, item_quantity: 2, tax: 5,
        tax_type: 'inclusive', pricing: { version: 1, selling_price: 30 } }
    ].map(line => ({ item_discount: 0, item_discount_percentage: 0, company_price_total: 0, ...line })) };
  let opened = false;
  sales.openTenderModel = () => {
    assert.equal(sales.extraDiscount.sale_new_tot, 201.75);
    opened = true;
  };
  sales.recentMenu.editItems('qa-app', bill, 'edit');
  assert.equal(opened, true);
  assert.equal($('#saleInlineItemPrice_water').text(), '30');
  assert.equal($('#addSalesLineItemSellingPrice_water').text(), '30');
  dom.window.close();
});

for (const spec of [
  {price:45,tax:5,type:'exclusive',pct:10,flat:0,qty:1,extra:0,percent:false,charges:0,expected:42.53},
  {price:45,tax:5,type:'exclusive',pct:10,flat:0,qty:1,extra:10,percent:false,charges:20,expected:52.53},
  {price:45,tax:5,type:'exclusive',pct:10,flat:0,qty:2,extra:10,percent:true,charges:30,expected:106.55},
  {price:30,tax:5,type:'inclusive',pct:10,flat:0,qty:2,extra:10,percent:true,charges:20,expected:68.6},
  {price:30,tax:5,type:'inclusive',pct:0,flat:5,qty:1,extra:0,percent:false,charges:0,expected:24.75},
  {price:100,tax:0,type:'exclusive',pct:0,flat:5,qty:3,extra:10,percent:false,charges:20.05,expected:295.05}
]) test('new cart canonical discounts and charges: '+JSON.stringify(spec), () => {
  const {dom,$,sales,win} = savedOrderSetup();
  sales.paymentOnlyMode = false;
  sales.addSalesLineItems({id:'qa',name:'QA',selling_price:spec.price,company_price:0,
    tax:spec.tax,tax_type:spec.type,discount_amount:spec.flat,discount_percentage:spec.pct,
    quantity:spec.qty,item_quantity:spec.qty,unit:'pc'});
  $('#touchsale_item_qtyqa').val(spec.qty);
  $('#extraDisc').text(spec.extra);
  $('#percentIcon').toggleClass('d-none',!spec.percent);
  sales.chargesTotal = () => spec.charges;
  sales.calculation.salesTableRowCart();
  assert.equal(sales.extraDiscount.sale_new_tot,spec.expected);
  $('#Partial_amount').val(spec.expected);
  sales.EditRecentSaleParams = {};
  sales.showMultiPaymentMode();
  assert.equal(Number($('#cash_input').val()),spec.expected);
  dom.window.close();
});
test('opening payment repeatedly preserves new charges and the collected total', (t) => {
  const {dom,$,sales,win} = savedOrderSetup();
  t.after(() => dom.window.close());
  sales.customerViewDisplay = () => {};
  win.PosnicPro.local.get = key => key === 'enable_multi_payment' ? 'enable' : key === 'general_settings' ? '{}' : '';
  $('#Partial_amount').addClass('partial_amount');
  const charges=[{name:'Service',amount:20,taxed:true,tax_amount:0.05},{name:'Delivery',amount:10,taxed:false,tax_amount:0}];
  sales.paymentOnlyMode=false; sales.SaleAction='add'; sales.EditRecentSaleParams={};
  $('body').append('<input id="sales_new_customer_name" value="Walk-in"><input id="customer_current_balance" value="0">');
  Object.assign(sales,{charges,refreshCustomerAccount:()=>{},renderTenderReceiptPreview:()=>{},saleDoneTimer:{stop:()=>{}},defaultDenominations:()=>[],renderCharges:()=>{sales.calculation.extraDiscoundCalculation();}});
  sales.chargesTotal=()=>sales.charges.reduce((n,c)=>n+c.amount,0);
  sales.chargesTax=()=>sales.charges.reduce((n,c)=>n+c.tax_amount,0);
  sales.addSalesLineItems({id:'qa',name:'QA',selling_price:45,company_price:0,tax:5,tax_type:'exclusive',discount_amount:0,discount_percentage:10,item_quantity:1,unit:'pc'});
  sales.addSalesLineItems({id:'water',name:'Water',selling_price:30,company_price:0,tax:5,tax_type:'inclusive',discount_amount:0,discount_percentage:0,item_quantity:1,unit:'pc'});
  $('#extraDisc').text(10); $('#percentIcon').removeClass('d-none'); sales.calculation.salesTableRowCart();
  assert.equal(sales.extraDiscount.sale_new_tot,95.32);
  for(let i=0;i<2;i++){
    sales.openTenderModel(true);
    assert.deepEqual(sales.charges,charges);
    assert.equal(sales.extraDiscount.sale_new_tot,95.32);
    assert.equal(Number($('#cash_input').val()),95.32);
  }
  dom.window.close();
});
test('saved order restores charges before checking its payable', (t) => {
  const {dom,$,sales,win}=savedOrderSetup(); t.after(()=>dom.window.close());
  const charges=[{name:'Service',amount:20,taxed:true,tax_amount:0.05,tax_name:'Old tax',source:'manual'}];
  sales.chargesTotal=()=>sales.charges.reduce((n,c)=>n+c.amount,0);
  sales.chargesTax=()=>sales.charges.reduce((n,c)=>n+c.tax_amount,0);
  let opened=0;
  sales.openTenderModel=()=>{assert.equal(sales.extraDiscount.sale_new_tot,120.05);opened++;};
  sales.recentMenu.editItems('saved', {sales_id:'saved',sales_total:120.05,sales_sub_total:100,tax:.05,charges,
    payment_status:'Unpaid',sale_process:'Add',extra_discount:0,extra_discount_type:'price',
    items:[{item_id:'zero',item_name:'Zero',item_price:100,item_quantity:1,item_discount:0,item_discount_percentage:0,tax:0,tax_type:'exclusive',company_price_total:0}]},'edit');
  assert.equal(opened,1); assert.equal(sales.charges[0].tax_amount,.05);
  sales.charges[0].amount=30; assert.equal(charges[0].amount,20,'editing must not mutate the saved snapshot');
  const start=source.indexOf('PosnicPro.sales.chargeTax = {');
  const end=source.indexOf('PosnicPro.sales.chargesTax =',start);
  win.eval(source.slice(start,end));
  sales.chargeTax._tax={name:'New tax',value:5};
  assert.equal(sales.chargeTax.amountFor(charges[0]),.05,'payment-only retains issued charge tax');
});
test('saved receipt lists every discount, charge and split tender with pretax lines', (t) => {
  const {dom,$,win,sales}=savedOrderSetup(); t.after(()=>dom.window.close());
  const start=source.indexOf('    buildSaleSheet: function'); const end=source.indexOf('\n    },',start);
  win.eval('PosnicPro.sales.buildSaleSheet = '+source.slice(source.indexOf('function',start),end+6)+';');
  const html=sales.buildSaleSheet({sales_id:'TEST',payment_status:'Paid',payment_mode:'Cash',
    sales_sub_total:73.5714285714,discount:4.5,tax:3.50357142857,sale_extra_discount:7.2525,sales_total:95.32,
    items:[{item_name:'Paratha',item_price:45,item_quantity:1,tax:5,tax_type:'exclusive',total_amount:42.525},
      {item_name:'Water',item_price:30,item_quantity:1,tax:5,tax_type:'inclusive',total_amount:30}],
    charges:[{name:'Service <test>',amount:20},{name:'Delivery',amount:10}],multi_payment:{Cash:20,Card:30,UPI:45.32}});
  const sheet=$(html); const rows=sheet.find('tfoot tr').get().map(row=>$(row).text().trim());
  assert.ok(rows.some(r=>r.includes('Additional discount') && r.includes('-7.25')));
  assert.ok(rows.some(r=>r.includes('Service <test>') && r.includes('20.00')));
  assert.ok(rows.some(r=>r.includes('Delivery') && r.includes('10.00')));
  assert.equal(sheet.find('test').length,0);
  assert.match(sheet.find('tbody tr').eq(0).text(),/45\.00.*45\.00/);
  assert.match(sheet.find('tbody tr').eq(1).text(),/28\.57.*28\.57/);
  const sum=sheet.find('tfoot tr.q-sub td:last-child').get().reduce((n,td)=>n+Number($(td).text().replace(/[^\d.-]/g,'')),0);
  assert.equal(Math.round(sum*100)/100,95.32);
  assert.match(sheet.find('.q-footer').text(),/Cash:.*20\.00.*Card:.*30\.00.*UPI:.*45\.32/);
});
