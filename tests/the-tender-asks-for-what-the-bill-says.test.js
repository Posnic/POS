'use strict';

/*
 * THE TENDER SCREEN ASKS FOR WHAT THE BILL SAYS.
 *
 * Owner: "take payment cand cash new payment metho sometime it shows only
 * total without tax. needs to be fixed."
 *
 * Sometimes, not always, which is the shape of a race rather than of
 * arithmetic. Two figures are in play when the payment panel opens:
 *
 *   extraDiscount.sale_new_tot            the grand total THIS screen has
 *                                         just worked out - items, discount,
 *                                         tax, round-off. The number printed
 *                                         on the bill.
 *   EditRecentSaleParams.sales_total      whatever was stored on the sale the
 *                                         last time it was written. For an
 *                                         order taken on a handset or a QR
 *                                         page that was computed somewhere
 *                                         else, and can predate a tax change
 *                                         or an edit.
 *
 * The stored one was preferred, and the correction underneath it only fired
 * when the computed total was ABOVE ZERO. Opening the tender before this
 * screen had finished adding up - the order is fetched, the rows are drawn,
 * the totals follow - left the computed total at 0, skipped the correction,
 * and showed the stale stored figure. Which is how a customer got a total
 * with no tax in it, on some bills and not others.
 *
 * Lifted out and run rather than eyeballed, because the bug is in the ORDER
 * of two fallbacks and reading it is exactly what missed it the first time.
 * See tests/lift-a-function-out-to-test-it notes for why this seam exists.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SALES = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8'
);
const NL = String.fromCharCode(10);

/**
 * The three lines that decide what the tender asks for, run for real.
 *
 * Lifted by name rather than by line number so the test survives edits
 * above it, and evaluated so it is the real expression being checked - a
 * regex would pass on code that reads correctly and computes the wrong way
 * round.
 */
function tenderTotal({ computed, stored }) {
  const at = SALES.indexOf('const currentTotal = parseFloat(PosnicPro.sales.extraDiscount.sale_new_tot)');
  assert.ok(at > 0, 'showMultiPaymentMode no longer resolves a total; this test is reading nothing');
  const end = SALES.indexOf('let multi_payment', at);
  assert.ok(end > at, 'the total block has moved');
  const source = SALES.slice(at, end);

  const PosnicPro = {
    sales: {
      extraDiscount: { sale_new_tot: computed },
      EditRecentSaleParams: { sales_total: stored },
    },
  };
  /* eslint-disable-next-line no-new-func -- the point is to run the real lines */
  return new Function('PosnicPro', source + NL + 'return sales_total;')(PosnicPro);
}

test('the freshly computed grand total is what the customer is asked for', () => {
  /* 545 with tax in it, against 500 stored before the tax was applied. */
  assert.strictEqual(tenderTotal({ computed: 545, stored: 500 }), 545);
});

test('a total of zero is not a total, so the stored one stands in', () => {
  /*
   * The moment before this screen has added anything up. Falling back is
   * right; preferring it was the bug.
   */
  assert.strictEqual(tenderTotal({ computed: 0, stored: 500 }), 500);
});

test('and with nothing to go on it asks for nothing, rather than NaN', () => {
  assert.strictEqual(tenderTotal({ computed: 0, stored: 0 }), 0);
  assert.strictEqual(tenderTotal({ computed: undefined, stored: undefined }), 0);
});

test('a stored figure never wins over a computed one, whichever is larger', () => {
  /*
   * Both directions, because "prefer the bigger number" would pass the first
   * test and still be wrong: a discount applied on this screen makes the
   * correct total the SMALLER one.
   */
  assert.strictEqual(tenderTotal({ computed: 450, stored: 500 }), 450);
  assert.strictEqual(tenderTotal({ computed: 600, stored: 500 }), 600);
});
