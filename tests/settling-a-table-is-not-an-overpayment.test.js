'use strict';

/*
 * A table that owes 420 rupees is not overpaying 420 rupees.
 *
 * Owner, settling a table on a live floor:
 *
 *   "why this error i am seeing. i never had this issue before. coz of decimal
 *    and non decimal value comparision ?"
 *   Error: Total payment (Rs420.00) cannot exceed Pay amount (Rs0.00)
 *
 * It is not decimals. Both sides are already rounded to two places and compared
 * with a 0.01 tolerance, so no float could produce a 420 against a 0.
 *
 * What produced it: the payment tiles and the Pay amount box are filled from
 * two DIFFERENT numbers. showMultiPaymentMode fills Cash from the loaded sale's
 * sales_total, which is 420. openTenderModel fills Pay amount from the sale's
 * partial_balance whenever the sale is flagged partial - and partial_balance is
 * the money ALREADY TAKEN, which on a table that has not paid yet is nothing.
 *
 * Then the two validators disagreed about what to do with that zero. The live
 * one fell back to the cart total, so the tender looked right and Save stayed
 * lit. The one inside cartOrderSubmit read `parseFloat(partial) || 0` with no
 * fallback at all, so pressing Pay refused the settlement. The cashier could
 * see a correct screen and still not take the money.
 *
 * These tests run the shipped payableCap against a fake till rather than
 * describing it, so the arithmetic is actually exercised.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8'
);

/** The shipped payableCap, lifted out of sales.js and given a fake till. */
function capWith({ typed, cart, stored }) {
  const start = SRC.indexOf('payableCap: function () {');
  assert.notStrictEqual(start, -1, 'payableCap is gone from sales.js');
  const open = SRC.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > open, 'payableCap has unbalanced braces');
  const body = 'function () ' + SRC.slice(open, end + 1);

  const $ = () => ({ val: () => typed });
  const PosnicPro = {
    sales: {
      extraDiscount: { sale_new_tot: cart },
      EditRecentSaleParams: { sales_total: stored },
    },
  };
  return new Function('$', 'PosnicPro', 'return ' + body + ';')($, PosnicPro)();
}

test('the cashier typed a figure, so that is the cap', () => {
  assert.strictEqual(capWith({ typed: '250', cart: 420, stored: 420 }), 250);
});

test('an unpaid table settles against its own bill, not against zero', () => {
  /* The exact shape of the owner's screenshot: Pay amount filled from a sale
     that has taken nothing yet, a 420 rupee cart behind it. */
  assert.strictEqual(capWith({ typed: '0.00', cart: 420, stored: 420 }), 420);
  assert.strictEqual(capWith({ typed: '', cart: 420, stored: 420 }), 420);
});

test('with the cart not yet totalled, the loaded sale still carries the bill', () => {
  /* This is the number showMultiPaymentMode fills the Cash tile from, so the
     two sides of the comparison cannot contradict each other. */
  assert.strictEqual(capWith({ typed: '0.00', cart: 0, stored: 420 }), 420);
});

test('nothing anywhere is a cap of zero, not a refusal', () => {
  assert.strictEqual(capWith({ typed: '', cart: 0, stored: undefined }), 0);
  assert.strictEqual(capWith({ typed: 'abc', cart: NaN, stored: null }), 0);
});

test('a stored total that arrives as a string still counts', () => {
  /* sales_total comes back off the wire as text on some routes. */
  assert.strictEqual(capWith({ typed: '', cart: 0, stored: '1018.50' }), 1018.5);
});

test('both validators ask the same question', () => {
  const live = SRC.slice(SRC.indexOf('initPaymentValidation: function () {'));
  assert.match(live.slice(0, 400), /const payAmount = PosnicPro\.sales\.payableCap\(\);/,
    'the tender screen works its cap out on its own again');

  const save = SRC.slice(SRC.indexOf('// Final validation: Check if multipayment total exceeds Pay amount'));
  assert.match(save.slice(0, 800), /var payAmount = PosnicPro\.sales\.payableCap\(\);/,
    'the save still reads Pay amount raw, so it can refuse what the screen allowed');
  assert.ok(!/var payAmount = parseFloat\(partial\) \|\| 0;/.test(SRC),
    'the bare fallback-free read is still in the file');
});

test('with no bill in front of it, the validator says nothing at all', () => {
  /* Otherwise the tiles left over from a settled table throw an overpayment
     toast across the KOT screen, which is where the owner first saw it. */
  const live = SRC.slice(SRC.indexOf('initPaymentValidation: function () {'));
  const upToCheck = live.slice(0, live.indexOf('if (sum > payAmountRounded + 0.01)'));
  assert.match(upToCheck, /if \(payAmountRounded <= 0\) \{\s*\n\s*return;/,
    'a cleared till can still be told it has overpaid');
  assert.match(SRC, /if \(payAmount > 0 && multipaymentTotal > payAmount \+ 0\.01\) \{/,
    'the save can still refuse when there is no bill to refuse against');
});

test('the Pay amount box opens on what is due, not on what was already taken', () => {
  assert.match(SRC, /var alreadyPaid = parseFloat\(PosnicPro\.sales\.EditRecentSaleParams\.partial_amounts\) \|\| 0;/,
    'partial_amounts is read raw again');
  assert.match(SRC, /\$\('#Partial_amount'\)\.val\(\(alreadyPaid > 0 \? alreadyPaid : saleNewTot\)\.toFixed\(2\)\);/,
    'an unpaid settlement still opens on 0.00');
  /* And a stored string can no longer take the whole tender down on toFixed. */
  assert.ok(!/EditRecentSaleParams\.partial_amounts\.toFixed\(2\)/.test(SRC),
    'toFixed is still called straight on a value that may be text');
});
