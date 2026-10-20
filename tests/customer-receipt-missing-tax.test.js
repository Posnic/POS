'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('customer receipt renders every item with missing tax details and mismatched item count', () => {
  const dom = new JSDOM('<table id="customer_item_list"><tbody></tbody></table><div class="customer_total_view"></div><div class="customer_itemlength_view"></div><div class="customer_itemqty_view"></div>', { runScripts: 'outside-only' });
  const $ = require('jquery')(dom.window);
  dom.window.$ = dom.window.jQuery = $;
  const response = { type: 'success', data: {
    total_items: 9, branch_currency: '₹', sales_sub_total: 420, total_amount: 420,
    partial_balance: 0, payment_pending: 420, discount: 0, tax: 0, round_off: 0,
    items: [
      { item_name: 'Chicken Tikka', item_price: 260, item_quantity: 1 },
      { item_name: 'Green Salad', item_price: 90, item_quantity: 1, tax_fields: null },
      { item_name: 'Ice Cream', item_price: 70, item_quantity: 1, tax_fields: [] }
    ]
  }};
  dom.window.PosnicPro = {
    getAllUrlParams: () => ({ id: 'test' }),
    get: (_params, done) => done(response),
    printBarcode: () => {}, nestedTaxCalculation: () => [],
    removeDuplicates: values => values, alert: () => {}
  };
  dom.window.eval(fs.readFileSync('frontend/static/script/js/modules/js/customer_mail.js', 'utf8'));
  dom.window.PosnicPro.customermail.customerMailPrint();
  assert.equal($('#customer_item_list tbody tr').length, 3);
  assert.match($('#customer_item_list').text(), /Green Salad/);
  assert.doesNotMatch($('#customer_item_list').text(), /NaN/);
  assert.equal($('.customer_itemqty_view').text(), '3');
  assert.match($('.customer_total_view').text(), /420.00/);
  dom.window.PosnicPro.customermail.customerMailPrint();
  assert.equal($('#customer_item_list tbody tr').length, 3);
  dom.window.close();
});
