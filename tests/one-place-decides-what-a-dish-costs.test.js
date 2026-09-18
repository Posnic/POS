'use strict';

/*
 * ONE PLACE DECIDES WHAT A DISH COSTS.
 *
 * kot.js carried THREE copies of the same discount-and-tax arithmetic: the
 * search results, and the two paths that re-read an order already sitting on
 * a table. Three copies of a price calculation is how a dish ends up costing
 * two different amounts on two screens, and nobody notices until a customer
 * is charged twice differently for the same thing.
 *
 * THEY HAD ALREADY DRIFTED, which is the part worth knowing:
 *
 *   the search path      reads `selling_price`, and an item carrying tax with
 *                        no tax_type is treated as INCLUSIVE
 *   the order paths      read `selling_price || item_price`, and the same
 *                        item is treated as EXCLUSIVE
 *
 * On a taxed item with no tax_type those two return different money. So the
 * sum is now shared (`_priceFrom`) and the differences are KEPT, passed in by
 * each caller through `_priceOf` and `_priceOfOrderLine`. Folding the
 * defaults together would quietly reprice every untyped item on one screen or
 * the other, and that is a decision about money for the owner to make on
 * purpose rather than something to slip into a refactor.
 *
 * These tests run the real functions against the numbers the old copies
 * produced, because "I moved some code and it looks the same" is not a thing
 * anybody should take on trust where money is concerned.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'kot.js'),
  'utf8'
);
const NL = String.fromCharCode(10);

/** The three pricing methods, lifted out and runnable. */
function pricing() {
  const names = ['_priceFrom', '_priceOf', '_priceOfOrderLine'];
  const bodies = names.map((name) => {
    const at = SRC.indexOf('    ' + name + ': function');
    assert.ok(at > 0, name + ' is gone from kot.js');
    /* To the line that closes the method at this indent. */
    const end = SRC.indexOf(NL + '    },', at);
    assert.ok(end > at, name + ' has no visible end');
    return SRC.slice(at, end + NL.length + 6);
  });
  const src = 'var PosnicPro = { kot: {' + NL + bodies.join(NL) + NL + '} };' + NL + 'return PosnicPro.kot;';
  /* eslint-disable-next-line no-new-func -- running the real arithmetic is the point */
  return new Function(src)();
}

const kot = pricing();

/** What every old copy did, kept here as the thing being compared against. */
function theOldWay(sellingPrice, tax, taxType, discountAmount, discountPercentage) {
  let finalPrice = 0;
  const taxPrice = (sellingPrice * tax) / (100 + tax);
  const inclusive = sellingPrice - taxPrice;
  if (discountAmount > 0 && tax > 0) {
    const d = taxType === 'exclusive' ? sellingPrice - discountAmount : inclusive - discountAmount;
    finalPrice = d + (tax / 100) * d;
  } else if (discountPercentage > 0 && tax > 0) {
    const base = taxType === 'exclusive' ? sellingPrice : inclusive;
    const v = base - base * (discountPercentage / 100);
    finalPrice = v + (tax / 100) * v;
  } else if (discountAmount > 0) {
    finalPrice = sellingPrice - discountAmount;
  } else if (discountPercentage > 0) {
    finalPrice = sellingPrice - sellingPrice * (discountPercentage / 100);
  } else if (tax > 0) {
    finalPrice = taxType === 'exclusive'
      ? sellingPrice + (sellingPrice * tax) / 100
      : inclusive + (inclusive / 100) * tax;
  } else {
    finalPrice = sellingPrice;
  }
  return finalPrice;
}

const CASES = [
  /* price, tax, taxType, discount amount, discount % */
  [220, 0, 'inclusive', 0, 0],
  [220, 5, 'inclusive', 0, 0],
  [220, 5, 'exclusive', 0, 0],
  [220, 18, 'exclusive', 20, 0],
  [220, 18, 'inclusive', 20, 0],
  [220, 12, 'exclusive', 0, 10],
  [220, 12, 'inclusive', 0, 10],
  [220, 0, 'inclusive', 50, 0],
  [220, 0, 'inclusive', 0, 25],
  [0, 18, 'exclusive', 0, 0],
];

test('the shared sum returns exactly what the three copies returned', () => {
  for (const [p, t, tt, da, dp] of CASES) {
    assert.strictEqual(
      kot._priceFrom(p, t, tt, da, dp).toFixed(4),
      theOldWay(p, t, tt, da, dp).toFixed(4),
      'moved the money for ' + JSON.stringify([p, t, tt, da, dp])
    );
  }
});

test('a catalogue row still treats an untyped tax as inclusive', () => {
  /* The search and Browse path. Changing this would reprice every untyped
     item in the search results. */
  const got = kot._priceOf({ selling_price: 220, tax: 5 });
  assert.strictEqual(got.priceDisplay, theOldWay(220, 5, 'inclusive', 0, 0).toFixed(2));
  assert.strictEqual(got.basePrice, '220.00');
});

test('an order line still treats an untyped tax as exclusive', () => {
  /* The two order-reading paths. This is the drift that was found, and it is
     kept deliberately - see the header. */
  assert.strictEqual(
    kot._priceOfOrderLine({ selling_price: 220, tax: 5 }).toFixed(2),
    theOldWay(220, 5, 'exclusive', 0, 0).toFixed(2)
  );
});

test('the two defaults really do disagree, so nobody merges them by accident', () => {
  /*
   * Stated as a test rather than only as a comment. If somebody makes these
   * agree, this fails and asks them to mean it - which is the point, because
   * it changes what customers are charged.
   */
  const catalogue = Number(kot._priceOf({ selling_price: 220, tax: 5 }).priceDisplay);
  const orderLine = Number(kot._priceOfOrderLine({ selling_price: 220, tax: 5 }).toFixed(2));
  assert.notStrictEqual(catalogue, orderLine,
    'the inclusive/exclusive defaults now agree; if that was deliberate, say so here');
});

test('an order line falls back to item_price when there is no catalogue price', () => {
  /* A line saved before a catalogue price existed. The search path has never
     done this and still does not. */
  assert.strictEqual(kot._priceOfOrderLine({ item_price: 180 }).toFixed(2), '180.00');
  assert.strictEqual(kot._priceOf({ item_price: 180 }).priceDisplay, '0.00');
});

test('only one copy of the arithmetic is left in the file', () => {
  /*
   * The reason for the whole change. Counted on the one line every copy had -
   * if a fourth appears, this says so before it can drift.
   */
  const copies = (SRC.match(/inclusive_price = sellingPrice - taxPrice/g) || []).length;
  assert.strictEqual(copies, 1, 'there are ' + copies + ' copies of the pricing sum in kot.js');
});
