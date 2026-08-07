const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/*
 * A weight keeps all three decimals, even the zeros.
 *
 * The shop reported the quantity column not lining up: 250g showed as 0.25 and
 * 100g as 0.1, so every row was a different width and a column of weights
 * could not be read down. Three decimals always - 0.250, 0.100, 1.000 - makes
 * the column square, and the trailing zeros read as "weighed" rather than as a
 * number somebody rounded.
 *
 * Counted goods keep the old behaviour: a plain 2 must not become 2.00 beside
 * a genuine weight.
 *
 * These drive the real handlers out of sales.js, so what is asserted here is
 * what a counter does.
 */
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js');

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
   * The handler calls out to the rest of the till on its way through - cart
   * totals, the customer display, tax. None of it bears on the quantity, and
   * the calls nest (sales.calculation.salesTableRowCart), so anything not
   * named below answers as a callable that answers the same way.
   */
  const deepNoop = () => new Proxy(function () {}, {
    get: (t, p) => (p === 'then' ? undefined : deepNoop()),
    apply: () => undefined,
  });
  const noops = { get: (target, prop) => (prop in target ? target[prop] : deepNoop()) };

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
    }, noops),
    minmax: (v) => v,
    validate: () => {},
    get: () => {},
  };

  const source = fs.readFileSync(SOURCE, 'utf8');

  /* Only the quantity object and isWeighedItem are needed here. */
  const start = source.indexOf('PosnicPro.sales.quantity = {');
  assert.notStrictEqual(start, -1, 'quantity block not found');
  let depth = 0; let i = start + 'PosnicPro.sales.quantity = {'.length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  const quantityBlock = source.slice(start, i + 1) + ';';

  const weighedStart = source.indexOf('PosnicPro.sales.isWeighedItem = function');
  const weighedEnd = source.indexOf('\n};', weighedStart) + 3;
  const weighedFn = source.slice(weighedStart, weighedEnd);

  /* The cart writes to the customer display on its way through; not under test. */
  const db = { customerDisplay: { put: () => {} } };

  // eslint-disable-next-line no-new-func
  new Function('PosnicPro', '$', 'db', 'window', 'document',
    weighedFn + '\n' + quantityBlock)(PosnicPro, $, db, dom.window, dom.window.document);

  return { $, PosnicPro, dom };
}

/* The Qty column helper, which lives in core because every page renders it. */
function bootCore() {
  const source = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');

  const pick = (name) => {
    const start = source.indexOf('    ' + name + ':');
    assert.notStrictEqual(start, -1, name + ' not found in core');
    let depth = 0; let i = source.indexOf('{', start);
    if (source.slice(start, i).includes('[')) {   // an array member, not a function
      const end = source.indexOf('],', start);
      return source.slice(start, end + 1).replace('    ' + name + ':', 'PosnicPro.' + name + ' =') + ';';
    }
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') { depth--; if (depth === 0) break; }
    }
    return source.slice(start, i + 1).replace('    ' + name + ':', 'PosnicPro.' + name + ' =') + ';';
  };

  const PosnicPro = {};
  // eslint-disable-next-line no-new-func
  new Function('PosnicPro',
    [pick('measuredUnits'), pick('isMeasuredUnit'), pick('formatQuantity')].join('\n'))(PosnicPro);
  return PosnicPro;
}

test('a weight keeps three decimals even when they are zeros', () => {
  const { PosnicPro } = boot();
  const f = PosnicPro.sales.quantity.formatQty;

  assert.strictEqual(f(0.25, true), '0.250');
  assert.strictEqual(f(0.1, true), '0.100');
  assert.strictEqual(f(0.3, true), '0.300');
  assert.strictEqual(f(1, true), '1.000');
});

test('a weight is not rounded away', () => {
  // The reason three decimals exist at all: 0.375kg is 375g, and two decimals
  // would hand the customer 380g.
  const { PosnicPro } = boot();
  const f = PosnicPro.sales.quantity.formatQty;

  assert.strictEqual(f(0.375, true), '0.375');
  assert.strictEqual(f(4.055, true), '4.055');
  assert.strictEqual(f(0.005, true), '0.005');
});

test('counted goods stay plain', () => {
  // 2 must not read as 2.00 in a column beside a weight.
  const { PosnicPro } = boot();
  const f = PosnicPro.sales.quantity.formatQty;

  assert.strictEqual(f(2, false), '2');
  assert.strictEqual(f(10, false), '10');
  assert.strictEqual(f(1.5, false), '1.5');
});

test('every weight in the column is the same width', () => {
  // The actual complaint: 0.25 beside 0.1 beside 1 does not line up.
  const { PosnicPro } = boot();
  const f = PosnicPro.sales.quantity.formatQty;

  const widths = [0.25, 0.1, 1, 0.005, 12.5].map((v) => f(v, true).length);
  const decimals = [0.25, 0.1, 1, 0.005, 12.5]
    .map((v) => f(v, true).split('.')[1].length);

  assert.deepStrictEqual(decimals, [3, 3, 3, 3, 3]);
  assert.ok(widths.every((w) => w >= 5), 'every weight shows 0.000 at minimum');
});

test('the minus button lands on a padded weight', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '0.350' });

  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 0, 'false', 'true');

  assert.strictEqual($('#touchsale_item_qty7').val(), '0.250');
});

test('the plus button lands on a padded weight', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '0.900' });

  PosnicPro.sales.quantity.qtyIncreaseDecrease('7', 1, 'false', 'true');

  // A whole kilo is still three decimals - the column does not jump about when
  // a weight happens to be round.
  assert.strictEqual($('#touchsale_item_qty7').val(), '1.000');
});

test('a typed weight is squared up when the box is left', () => {
  const { $, PosnicPro } = boot({ weighed: true, quantity: '1' });
  $('#touchsale_item_qty7').val('.25');

  PosnicPro.sales.quantity.normalizeInput('7');

  assert.strictEqual($('#touchsale_item_qty7').val(), '0.250');
});

test('a half-typed weight is left alone', () => {
  // Reformatting "0." into "0.000" mid-entry takes the decimal point away from
  // somebody still typing it.
  const { $, PosnicPro } = boot({ weighed: true, quantity: '1' });

  for (const partial of ['', '.', '0.']) {
    $('#touchsale_item_qty7').val(partial);
    PosnicPro.sales.quantity.normalizeInput('7');
    assert.strictEqual($('#touchsale_item_qty7').val(), partial,
      'partial entry "' + partial + '" should survive');
  }
});

test('the Qty column pads by unit, wherever it is rendered', () => {
  /*
   * This is what the sale view, the receiving view and the printed receipt all
   * call - sixteen render sites that previously printed the stored number raw,
   * which is where 0.25 and 0.1 were coming from.
   */
  const PosnicPro = bootCore();

  assert.strictEqual(PosnicPro.formatQuantity(0.25, 'kg'), '0.250');
  assert.strictEqual(PosnicPro.formatQuantity(0.1, 'kg'), '0.100');
  assert.strictEqual(PosnicPro.formatQuantity(1, 'kg'), '1.000');
  assert.strictEqual(PosnicPro.formatQuantity(0.375, 'KG'), '0.375');
  assert.strictEqual(PosnicPro.formatQuantity('2.5', 'ltr'), '2.500');
});

test('counted units are left exactly as they are', () => {
  const PosnicPro = bootCore();

  assert.strictEqual(PosnicPro.formatQuantity(2, 'pcs'), '2');
  assert.strictEqual(PosnicPro.formatQuantity(3, 'qty'), '3');
  assert.strictEqual(PosnicPro.formatQuantity(5, ''), '5');
  assert.strictEqual(PosnicPro.formatQuantity(5, undefined), '5');
});

test('a quantity that is not a number survives being rendered', () => {
  // These render sites run over saved sales, and an old row may hold anything.
  const PosnicPro = bootCore();

  assert.strictEqual(PosnicPro.formatQuantity('', 'kg'), '');
  assert.strictEqual(PosnicPro.formatQuantity(null, 'kg'), null);
  assert.strictEqual(PosnicPro.formatQuantity(undefined, 'kg'), undefined);
});

test('a counted quantity is not padded on the way out', () => {
  const { $, PosnicPro } = boot({ weighed: false, quantity: '1' });
  $('#touchsale_item_qty7').val('3');

  PosnicPro.sales.quantity.normalizeInput('7');

  assert.strictEqual($('#touchsale_item_qty7').val(), '3');
});
