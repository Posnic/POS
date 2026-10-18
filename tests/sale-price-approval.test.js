'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');
test('sale-only price approval reaches checkout without requiring a discount', () => {
  const PosnicPro = { sales: { lineEdit: { _priceApprovalToken: 'signed-price-approval' }, _manualDiscountOn: () => false } };
  const start = source.indexOf('PosnicPro.sales.guardDiscountApproval = function');
  const end = source.indexOf('/*********** START - ADD NEW SALES', start);
  vm.runInNewContext(source.slice(start, end), { PosnicPro });
  const params = { data: JSON.stringify({ items: [{ sale_inline_item_price: 70 }] }) };
  let proceeded = false;
  PosnicPro.sales.guardDiscountApproval(params, () => { proceeded = true; });
  assert.equal(proceeded, true);
  assert.equal(JSON.parse(params.data).price_override_approval_token, 'signed-price-approval');
  assert.equal(JSON.parse(params.data).items[0].sale_inline_item_price, 70);
});
