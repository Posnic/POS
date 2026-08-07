const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/*
 * Quantities for items sold by weight.
 *
 * A shop reported that a line would not go below one. It was worse than that:
 * pressing minus on 0.300kg did not decline to move, it set the quantity to 1
 * - three hundred grams became a kilo and the customer paid for it.
 *
 * These tests drive the real handlers out of sales.js against a cart row built
 * to the same shape the till builds, so the arithmetic under test is the
 * arithmetic that runs on a counter.
 */
const ROOT = path.join(__dirname, '..');

function boot({ weighed = false, quantity = '1' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body>'
    + '<div id="save_submit"></div>'
    + '<input id="touchsale_item_qty7" value="' + quantity + '">'
    + '<span id="addSalesLineItemSellingPrice_7">100</span>'
    + '<span id="addSalesLineItemDiscount_7">0</span>'
    + '<span id="addSalesLineItemTax_7">0</span>'
    + '<span id="addSalesLineItemTaxType_7">Inc</span>'
    + '<span id="addSalesLineItemPrice_7">100</span>'
    + '<span id="discountSign7"></span>'
    + '<span id="addSalesLineTotal_7"></span>'
    + '<span id="addSalesDiscount_7"></span>'
    + '<span id="addSalesGstTax_7"></span>'
    + '<span id="addSalesLineItemName_7">Onion</span>'
    + '</body></html>');
  /* jQuery stays on 3 deliberately: the frontend ships 3.3.1, and the product
     code still calls $.trim, which 4 removed. Testing this markup against 4
     would be testing it against a library it never runs on. */
  const $ = require('jquery')(dom.window);

  /*
   * The handler calls out to the rest of the till on its way through -
   * customer balances, cart totals, the customer display. None of that bears
   * on the arithmetic under test, so anything not named below answers as a
   * no-op rather than being stubbed one function at a time as it surfaces.
   */
  const noops = {
    get: (target, prop) => (prop in target ? target[prop] : () => {}),
  };

  const PosnicPro = {
    alert: () => {},
    local: { get: () => null },
    sales: new Proxy({
      SaleAction: 'add',
      SaleTableLineItems: {
        7: {
          item_id: '7',
          available_quantity: 500,
          addSalesLineItemAmount: 100,
          addSalesLineItemDiscountAmount: 0,
          addSalesLineItemDiscountPercentage: 0,
          tax: 0,
          item_weight_machine_based: weighed,
        },
      },
      calculation: { salesTableRowCart: () => {} },
      isWeighedItem: (d) => {
        if (!d) return false;
        const v = d.item_weight_machine_based;
        return v === '1' || v === 1 || v === true || v === 'true';
      },
    }, noops),
  };

  /*
   * sales.js is one large file that assigns onto PosnicPro. Rather than
   * evaluate all of it - it reaches for the DOM of a whole till at load - lift
   * out the quantity object under test and evaluate that alone.
   */
  const source = fs.readFileSync(
    path.join(ROOT, 'frontend/static/script/js/modules/js/sales.js'), 'utf8');
  const start = source.indexOf('PosnicPro.sales.quantity = {');
  assert.notStrictEqual(start, -1, 'quantity object not found in sales.js');
  // Walk to the matching close brace.
  let depth = 0, i = source.indexOf('{', start), end = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const quantitySource = source.slice(start, end) + ';';

  const db = { customerDisplay: { put: () => {}, add: () => {} } };
  new dom.window.Function('PosnicPro', '$', 'db', 'window', 'document', quantitySource)(
    PosnicPro, $, db, dom.window, dom.window.document);

  return { $, PosnicPro };
}

const qty = ($) => $('#touchsale_item_qty7').val();

test('minus on a weighed line steps down by 100g, not up to a kilo', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '0.300' });
  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 0, 'false', 'true');

  assert.strictEqual(parseFloat(qty($)), 0.2,
    'pressing minus on 300g must not raise the quantity');
});

test('a weighed line never jumps to 1 at the bottom', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '0.050' });
  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 0, 'false', 'true');

  const after = parseFloat(qty($));
  assert.ok(after <= 0.05, 'quantity went up when it should have gone down or held: ' + after);
  assert.ok(after > 0, 'quantity should not reach zero from the minus button: ' + after);
});

test('plus on a weighed line adds 100g and keeps the gram', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '0.305' });
  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 1, 'false', 'true');

  assert.strictEqual(parseFloat(qty($)), 0.405,
    'the third decimal is grams and must survive the button');
});

test('a counted item still steps by one and floors at one', () => {
  // The change must not alter what every other shop already relies on.
  const { $, PosnicPro } = boot({ weighed: false, quantity: '3' });
  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 1, 'false', 'true');
  assert.strictEqual(parseFloat(qty($)), 4);

  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 0, 'false', 'true');
  assert.strictEqual(parseFloat(qty($)), 3);
});

test('a counted item does not go below one', () => {
  const { $, PosnicPro } = boot({ weighed: false, quantity: '1' });
  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 0, 'false', 'true');
  assert.strictEqual(parseFloat(qty($)), 1);
});

/* ---- the clamp that runs on every keystroke ---- */

test('a decimal quantity can actually be typed', () => {
  // minmax runs from oninput and writes straight back into the field, so what
  // it returns lands under the cursor.
  const source = fs.readFileSync(
    path.join(ROOT, 'frontend/static/script/js/core/PosnicPro.js'), 'utf8');
  const start = source.indexOf('    minmax: function (value, min, max) {');
  assert.notStrictEqual(start, -1, 'minmax not found');
  let depth = 0, i = source.indexOf('{', start + 20), end = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = source.slice(source.indexOf('function', start), end);
  const minmax = eval('(' + body + ')');

  // Typing ".3" one key at a time. The bare "." used to answer 0, which turned
  // the next keystroke into "03" - three kilos instead of three hundred grams.
  assert.strictEqual(minmax('.', 0, 100000), '.');
  assert.strictEqual(minmax('.3', 0, 100000), '.3');

  // And the ordinary way of typing it.
  assert.strictEqual(minmax('0', 0, 100000), '0');
  assert.strictEqual(minmax('0.', 0, 100000), '0.');
  assert.strictEqual(minmax('0.3', 0, 100000), '0.3');
  assert.strictEqual(minmax('0.305', 0, 100000), '0.305');

  // An emptied box stays empty rather than having a 0 forced back under the
  // cursor, which would have to be deleted before retyping.
  assert.strictEqual(minmax('', 0, 100000), '');

  // Over the maximum caps at the maximum. This returned the literal 100
  // whatever the maximum was, so typing past 100000 replaced the quantity with
  // an unrelated number.
  assert.strictEqual(minmax('100001', 0, 100000), 100000);
  assert.strictEqual(minmax('-5', 0, 100000), 0);
});

/* ---- precision: a scale reports grams, and every step has to keep them ---- */

function loadFormatQty() {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/script/js/modules/js/sales.js'), 'utf8');
  const start = source.indexOf('    formatQty: function (value, weighed) {');
  assert.notStrictEqual(start, -1, 'formatQty not found in sales.js');
  let depth = 0, i = source.indexOf('{', start + 30), end = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return eval('(' + source.slice(source.indexOf('function', start), end) + ')');
}

test('a weight keeps its grams', () => {
  // 0.375kg is 375g. At two decimals it becomes 0.38 - ten grams the shop
  // gives away on the sale and never gets back on the return.
  const formatQty = loadFormatQty();
  assert.strictEqual(formatQty(0.375, true), '0.375');
  assert.strictEqual(formatQty(4.055, true), '4.055');
  assert.strictEqual(formatQty(0.005, true), '0.005');
});

test('a round weight still shows its three decimals', () => {
  /*
   * This used to assert the opposite - that 2kg printed as "2" - on the
   * reasoning that trailing zeros looked like false precision. In the shop it
   * read worse: the Qty column had 0.25 on one row, 0.1 on the next and 2 on
   * the third, so no two rows were the same width and the column could not be
   * read down. A weight is a reading off a scale and shows all three decimals
   * whatever the value; a counted item still does not.
   */
  const formatQty = loadFormatQty();
  assert.strictEqual(formatQty(2, true), '2.000');
  assert.strictEqual(formatQty(10, false), '10');
});

test('a counted quantity keeps two decimals', () => {
  const formatQty = loadFormatQty();
  assert.strictEqual(formatQty(1.5, false), '1.5');
  assert.strictEqual(formatQty(3, false), '3');
});

test('rubbish in gives a usable zero rather than NaN on a receipt', () => {
  const formatQty = loadFormatQty();
  assert.strictEqual(formatQty('', true), '0');
  assert.strictEqual(formatQty('abc', true), '0');
  assert.strictEqual(formatQty(undefined, true), '0');
});
