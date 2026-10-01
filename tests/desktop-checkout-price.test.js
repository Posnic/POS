'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');

test('new desktop rows render the actual selling price when there is no inline override', () => {
  const line = source.split('\n').find((row) => row.includes('<td id="saleInlineItemPrice_'));
  const render = new Function('params', 'id', 'return ' + line.trim().replace(/\+$/, '') + ';');
  assert.match(render({ selling_price: 65 }, 'item'), />65<\/td>/);
  assert.match(render({ selling_price: 65, sale_inline_item_price: 70 }, 'item'), />70<\/td>/);
  assert.match(render({ selling_price: 65, sale_inline_item_price: 0 }, 'item'), />0<\/td>/);
});

test('journal conflict removes the checkout overlay and enables correction without sending', () => {
  const start = source.indexOf('            var savedSubmission;');
  const end = source.indexOf('            PosnicPro.post(params', start);
  let removed = 0, enabled = false, unlocked = false, message;
  const sales = { submissionInProgress: true, submissionJournal() { return { save() { throw new Error('pending'); } }; } };
  const $ = (selector) => ({
    prop(name, value) { if (selector === '#save_btn' && name === 'disabled' && value === false) enabled = true; },
    removeClass(name) { if (selector === '#save_submit' && name === 'disabled') unlocked = true; }
  });
  const loader = { find(selector) { assert.equal(selector, '.loadingSpinner'); return { remove() { removed++; } }; } };
  new Function('PosnicPro', '$', 'params', 'loader', source.slice(start, end))(
    { sales, alert(type, value) { message = value; } }, $, { data: '{}' }, loader
  );
  assert.equal(sales.submissionInProgress, false);
  assert.equal(removed, 1);
  assert.equal(enabled && unlocked, true);
  assert.equal(message, 'pending');
});
