'use strict';

/*
 * A payment method gets one tile, however many times it is listed.
 *
 * Owner, with two identical Cash tiles on the payment panel, both showing the
 * same 690: "two cash i am seeing. i added via setting already showing one."
 *
 * Cash is built into both payment screens. A shop that also adds "Cash" to its
 * own payment list in Settings was then given a second tile for it. That is not
 * a cosmetic duplicate. Both tiles render `id="Cash"` on the radio and the same
 * derived id on the amount box, and both read the same entry out of the stored
 * split, so a 690 rupee bill showed 690 in each and typing into one never
 * reached the other.
 *
 * These read the source rather than the DOM because the tiles are built by
 * string concatenation inside two long closures that a test cannot reach. What
 * they pin is the rule: every place a tile is appended goes through a guard
 * that has seen what is already on the screen.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SALES = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8'
);

/** One function's body, from its key to the next sibling key at the same depth. */
function block(name, nextName) {
  const from = SALES.indexOf(`    ${name}: function `);
  assert.notStrictEqual(from, -1, `${name} is gone from sales.js`);
  const to = SALES.indexOf(`    ${nextName}: function `, from);
  assert.notStrictEqual(to, -1, `${nextName} is gone, so ${name} cannot be bounded`);
  return SALES.slice(from, to);
}

const multi = block('showMultiPaymentMode', 'editItemPricingSale');
const single = block('showPaymentMode', 'increaseDenom');

test('the split-tender screen appends every tile through one guard', () => {
  assert.match(multi, /function addPaymentBlock\(id, title, isActive\) \{/, 'there is no guard');
  assert.match(multi, /if \(!key \|\| renderedMethods\[key\]\) \{ return; \}/, 'the guard lets a repeat through');
  /* The built-in name and its title both count, so a shop that typed
     "Razorpay" gets no second tile beside the one that already says it. */
  assert.match(multi, /renderedMethods\[normalizeKey\(String\(title \|\| ''\)\)\] = true;/,
    'only the id is remembered, so the title can still be listed again');

  /* Exactly one place appends a tile, and it is inside the guard. Any other
     is a way onto the screen that has not checked what is already there. */
  const appends = multi.match(/\$\('#payment_id'\)\.append\(createPaymentBlock\(/g) || [];
  assert.strictEqual(appends.length, 1, 'a tile is appended outside addPaymentBlock');
  assert.ok(
    multi.indexOf('function addPaymentBlock') < multi.indexOf("$('#payment_id').append(createPaymentBlock("),
    'the only append is not the one inside the guard'
  );
  for (const call of ['Cash', 'Qrpay']) {
    assert.ok(multi.includes(`addPaymentBlock('${call}'`), `the built-in ${call} tile no longer registers itself`);
  }
  assert.match(multi, /addPaymentBlock\(val\.payment_value, val\.payment_value,/, 'the shop\'s own list bypasses the guard');
});

test('the match is loose, because the shop types these names by hand', () => {
  /* "Cash", "cash" and "CASH " are one method. normalizeKey already existed
     for reading the stored split; the guard uses the same idea. */
  assert.match(multi, /function normalizeKey\(str\) \{\s*return str\.replace\(\/\\s\+\/g, ''\)\.toLowerCase\(\);/);
  assert.match(single, /return String\(value \|\| ''\)\.replace\(\/\\s\+\/g, ''\)\.toLowerCase\(\);/,
    'the single-tender screen matches exactly, so "cash" slips past it');
});

test('the single-tender screen refuses a repeat too, and knows what is already there', () => {
  assert.match(single, /var renderedModes = \{ cash: true \};/, 'Cash is built in there but not registered');
  assert.match(single, /if \(renderedModes\[modeKey\(val\.payment_value\)\]\) \{ return; \}/, 'the loop appends whatever it is given');
  assert.match(single, /renderedModes\[modeKey\(val\.payment_value\)\] = true;/, 'a list with Cash twice still draws it twice');
  /* The gateway button is only there when the gateway is on, so it only
     reserves its names then. */
  assert.match(single, /renderedModes\.qrpay = true;[\s\S]{0,60}renderedModes\.razorpay = true;/,
    'with the gateway on, a listed Razorpay would draw a second button');
});

test('the guard that never guarded anything is gone', () => {
  /* `SalePaymentType.leght !== 0` was a typo for length. `undefined !== 0` is
     always true, so it protected nothing and hid the fact that nothing here
     checked the list at all. */
  assert.ok(!/\.leght\b/.test(SALES), 'the misspelled length check is still in sales.js');
  assert.match(single, /let SalePaymentType = PosnicPro\.configPaymentType \|\| \[\];/,
    'an absent list would now throw where the typo used to swallow it');
});
