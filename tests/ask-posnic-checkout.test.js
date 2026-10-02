'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/ask_posnic.js'), 'utf8');

function setup() {
  const dom = new JSDOM(`<table id="sales_new_items_table"><tr><td name="addSalesLineItemId">coke</td><td><input id="touchsale_item_qtycoke" value="1"></td></tr><tr><td name="addSalesLineItemId">biryani</td><td><input id="touchsale_item_qtybiryani" value="3"></td></tr></table><div id="payment_id"><label class="btn-payment-mode"><input class="payment_mode" id="Cash"></label><label class="btn-payment-mode"><input class="payment_mode" id="Card"></label></div><input id="Partial_amount"><input id="tendered_amount"><input id="unpaid_payment_toggle" type="checkbox"><input id="wallet_balance" type="checkbox">`, { url: 'https://posnic.test/#/sales/new' });
  const $ = require('jquery')(dom.window); let submissions = 0;
  const PosnicPro = { local: { get: () => 'branch' }, i18n: { t: (_key, fallback) => fallback }, alert() {}, sales: { SaleAction: 'add', saleProcess: 'Add', extraDiscount: { sale_new_tot: 450 }, addSale: { cartOrderSubmit() { submissions++; } } } };
  vm.runInNewContext(source, { $, PosnicPro, window: dom.window });
  const ui = PosnicPro.askposnic;
  ui.checkout = { branch: 'branch', total: 450, lines: [{ item_id: 'coke', qty: 1 }, { item_id: 'biryani', qty: 3 }] };
  return { ui, $, dom, PosnicPro, submitted: () => submissions };
}

test('payment buttons require an explicit click and complete the native sale only once', () => {
  const { ui, $, submitted } = setup();
  ui.checkoutPaymentReady();
  assert.equal(submitted(), 0);
  assert.equal($('#ask_checkout_payment button').length, 2);
  $('#ask_checkout_payment button').first().trigger('click');
  ui.completeCheckout('Cash');
  assert.equal(submitted(), 1);
  assert.equal($('#Partial_amount').val(), '450.00');
  assert.equal($('#Cash').prop('checked'), true);
  assert.equal(ui.checkout.print, true);
});

test('card confirmation uses only an existing configured card method', () => {
  const { ui, $, submitted } = setup();
  ui.completeCheckout('Card');
  assert.equal(submitted(), 1);
  assert.equal($('#Card').prop('checked'), true);
  const missing = setup(); missing.$('#Card').remove();
  missing.ui.completeCheckout('Card'); assert.equal(missing.submitted(), 0);
});

test('changes to branch, items, amount, route or sale mode prevent quick completion', () => {
  const changes = [
    env => env.PosnicPro.local.get = () => 'other',
    env => env.$('#touchsale_item_qtybiryani').val('4'),
    env => env.$('#sales_new_items_table tr').last().remove(),
    env => env.PosnicPro.sales.extraDiscount.sale_new_tot = 500,
    env => env.dom.window.location.hash = '#/askposnic',
    env => env.PosnicPro.sales.SaleAction = 'edit',
    env => env.PosnicPro.sales.paymentOnlyMode = true,
  ];
  changes.forEach(change => { const env = setup(); change(env); env.ui.completeCheckout('Cash'); assert.equal(env.submitted(), 0); });
});

test('split tender quick payment clears other amounts before recording the selected method', () => {
  const { ui, $, submitted } = setup();
  $('#payment_id').html('<div class="payment-method-card"><button class="btn-payment-method"><input id="Cash" class="payment_mode"></button><input class="payment-amount-input" value="200"></div><div class="payment-method-card"><button class="btn-payment-method"><input id="Card" class="payment_mode"></button><input class="payment-amount-input" value="250"></div>');
  ui.completeCheckout('Cash');
  assert.equal(submitted(), 1);
  assert.deepEqual($('.payment-amount-input').map(function () { return $(this).val(); }).get(), ['450.00', '0.00']);
});
