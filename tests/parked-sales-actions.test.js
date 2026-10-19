const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
const start = source.indexOf('PosnicPro.sales.parkedMenu = {');
const end = source.indexOf('\n};', start) + 3;

function boot(allowDelete, confirm = () => false) {
  const dom = new JSDOM('<div class="loader-product"></div><div id="sales_new_productList"></div><div id="sales_new_categoryList"></div>');
  const $ = require('jquery')(dom.window);
  const PosnicPro = {
    local: { get: k => ({ usertype: 'super_admin', allow_sale_hard_delete: String(allowDelete), currencySign: '₹' })[k] },
    sales: { parkedAgo: () => ({ text: '1 minute', exact: 'Now', stale: false }) },
    get: (_, done) => done({ data: JSON.stringify([{ sales_document_id: 'abc123', customer_name: '<script>bad</script>', total_amount: 70, number_of_items: 1 }]) }),
    alert: () => {},
  };
  vm.runInNewContext(source.slice(start, end), { PosnicPro, $, jQuery: $, Date, Number, String, window: { confirm } });
  return { $, menu: PosnicPro.sales.parkedMenu, PosnicPro };
}

test('parked rows expose resume and clear-all without hard deletion or interpreting customer HTML', () => {
  for (const enabled of [false, true]) {
    const { $, menu } = boot(enabled);
    menu.list();
    assert.equal($('a[href="#/sales/abc123/hold"]').length, 1);
    assert.equal($('a[href="#/sales/abc123/delete"]').length, 0);
    assert.equal($('#clear_all_parked_sales').prop('disabled'), false);
    assert.equal($('#parked_sales_table script').length, 0);
    assert.match($('#parked_sales_table').text(), /<script>bad<\/script>/);
  }
});

test('cancel sends nothing; confirmed clear submits once, refreshes, and failures allow retry', () => {
  let confirmed = false, sent = 0, success, failure;
  const { $, menu, PosnicPro } = boot(false, () => confirmed);
  PosnicPro.post = (request, done, fail) => {
    sent++; success = done; failure = fail;
    assert.equal(request.url, 'sales/parked/clear');
    assert.deepEqual(JSON.parse(request.data), { confirmed: true });
  };
  menu.list();
  menu.clearAll(); assert.equal(sent, 0);
  confirmed = true;
  menu.clearAll(); menu.clearAll(); assert.equal(sent, 1);
  assert.equal($('#clear_all_parked_sales').prop('disabled'), true);
  failure(); assert.equal(menu.clearing, false);
  menu.clearAll(); assert.equal(sent, 2);
  PosnicPro.get = (_, done) => done({ data: 0 });
  success({ type: 'success', data: { cleared: 25 } });
  assert.equal(menu.clearing, false);
  assert.match($('#parked_sales_table').text(), /Nothing parked/);
  assert.equal($('#clear_all_parked_sales').prop('disabled'), true);
});

test('ordinary parked drafts resume paid regardless of network latency; other bills retain state', () => {
  const { menu } = boot(false);
  assert.equal(menu.paidOnResume({ sale_process: 'Hold' }, false), true);
  assert.equal(menu.paidOnResume({ sale_process: 'Edit' }, false), false);
  assert.equal(menu.paidOnResume({ sale_process: 'KOT' }, false), false);
  assert.equal(menu.paidOnResume({ sale_process: 'Hold', captain_payment_plan: {} }, false), false);
});

test('auto-print accepts persisted checkbox strings and never treats false as truthy', () => {
  const { menu } = boot(false);
  for (const value of [true, 'true']) assert.equal(menu.printEnabled(value), true);
  for (const value of [false, 'false', undefined, null, '']) assert.equal(menu.printEnabled(value), false);
});

test('loaded parked sale updates the real payment checkbox and dispatches its change handler', () => {
  const { $, PosnicPro } = boot(false);
  $('body').append('<input type="checkbox" id="unpaid_payment_toggle" disabled>');
  let changed = 0;
  $('#unpaid_payment_toggle').on('change', () => changed++);
  const begin = source.indexOf("        var status = PosnicPro.sales.EditRecentSaleParams.payment_status");
  const finish = source.indexOf('        PosnicPro.sales.dineType =', begin);
  assert.ok(begin > 0 && finish > begin);
  for (const payment_status of ['Unpaid', 'Cancelled']) {
    const result = { sale_process: 'Hold', payment_status };
    PosnicPro.sales.EditRecentSaleParams = result;
    vm.runInNewContext(source.slice(begin, finish), { PosnicPro, $, result, String });
    assert.equal($('#unpaid_payment_toggle').prop('checked'), true);
    assert.equal($('#unpaid_payment_toggle').prop('disabled'), false);
  }
  assert.equal(changed, 2);
});

test('parked completion invokes the receipt printer only when the saved print option is enabled', () => {
  const { PosnicPro } = boot(false);
  const calls = [];
  PosnicPro.sales.view = { printSale: (...args) => calls.push(args) };
  const begin = source.indexOf('                    if ((isKotPaymentOnlyFlow || completingParkedSale)');
  const finish = source.indexOf('                    if (PosnicPro.sales.recentSaleAction', begin);
  assert.ok(begin > 0 && finish > begin);
  for (const print of [true, 'true', false, 'false', undefined]) {
    vm.runInNewContext(source.slice(begin, finish), { PosnicPro,
      isKotPaymentOnlyFlow: false, completingParkedSale: true,
      response: { data: { print } }, saleId: 'saved-sale' });
  }
  assert.deepEqual(calls, [['saved-sale', 'sale'], ['saved-sale', 'sale']]);
});
