/*
 * THE TILL ASKS FOR TODAY'S PRICE INSTEAD OF BILLING NOTHING.
 *
 * Owner: "we will not bill with 0 for sure. we need to add with amount only.
 * its daily price or market price item. needs to be handled properly."
 *
 * At a live restaurant, three dishes are named "(Market Price)" and carry no
 * catalogue price, because the rate is the day's catch. The handset already
 * refused to put one on an order - `_priceOnlineLine` answers
 * `item_needs_price` and says so in a sentence written for whoever is holding
 * the screen.
 *
 * The till did not. Its sale screen reads the catalogue price into the line, a
 * missing price reads as zero, and the dish went onto the bill at nothing.
 * Nobody was told, because nothing had failed.
 *
 * The gate is at ADD time, not at payment time: the waiter is standing at the
 * screen when the line goes on, and the guest is waiting at the counter when
 * the bill is made. A refusal at payment would be correct and useless.
 *
 * `_needsTodaysPrice` is lifted out of sales.js and driven directly, because
 * the browser is not available here and the rule is the part worth testing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SALES = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js');
const source = fs.readFileSync(SALES, 'utf8');

/** Lift one method off the object literal by matching its braces. */
function lift(name) {
  const at = source.indexOf(`    ${name}: function (`);
  assert.notStrictEqual(at, -1, `${name} is gone from sales.js`);
  let depth = 0;
  let started = false;
  for (let i = at; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
      started = true;
    } else if (source[i] === '}') {
      depth -= 1;
      if (started && depth === 0) {
        const body = source.slice(source.indexOf('function (', at), i + 1);
        // eslint-disable-next-line no-new-func
        return new Function('PosnicPro', `return (${body});`);
      }
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

/** The screen, as much of it as the rule touches. */
const screen = (action = 'sale') => ({ sales: { SaleAction: action } });
const needsPrice = (params, action) => lift('_needsTodaysPrice')(screen(action))(params);

test('A DISH WITH NO PRICE IS ASKED ABOUT', () => {
  /* The three at Azure: Pomfret Fish Tawa Fry (Market Price) and friends. */
  assert.strictEqual(needsPrice({ item_name: 'Pomfret Fish Tawa Fry (Market Price)', selling_price: 0 }), true);
  assert.strictEqual(needsPrice({ selling_price: '0' }), true);
  assert.strictEqual(needsPrice({ selling_price: '' }), true);
  assert.strictEqual(needsPrice({}), true);
});

test('and so is one the shop marked as priced at the counter', () => {
  /* open_price is always-ask by design, whatever the catalogue says. */
  assert.strictEqual(needsPrice({ selling_price: 500, open_price: true }), true);
  assert.strictEqual(needsPrice({ selling_price: 500, open_price: 'true' }), true);
});

test('AN ORDINARY DISH IS NOT', () => {
  /* The gate must be invisible to the other 270 dishes on that menu, or a
     waiter is answering a dialog for every biryani. */
  assert.strictEqual(needsPrice({ item_name: 'Chicken Biryani', selling_price: 290 }), false);
  assert.strictEqual(needsPrice({ selling_price: '290' }), false);
  assert.strictEqual(needsPrice({ selling_price: 0.5 }), false);
});

test('a return is left alone, because that is repricing something already sold', () => {
  assert.strictEqual(needsPrice({ selling_price: 0 }, 'return'), false);
});

test('and it asks ONCE - the answer is not re-asked on the way back in', () => {
  /*
   * askTodaysPrice sets the price and calls addSalesLineItems again. Without
   * this flag that second call would ask again, for ever, and the line would
   * never go on the sale.
   */
  assert.strictEqual(needsPrice({ selling_price: 0, _priceAsked: true }), false);
  assert.strictEqual(needsPrice({ selling_price: 320, _priceAsked: true }), false);
});

test('nothing it can be handed makes it throw', () => {
  for (const params of [null, undefined, {}, { selling_price: null }, { selling_price: 'abc' }]) {
    assert.doesNotThrow(() => needsPrice(params), `threw on ${JSON.stringify(params)}`);
  }
  assert.strictEqual(needsPrice({ selling_price: 'abc' }), true, 'an unreadable price is not a price');
});

/* ----------------------------------------------------- and what it then does */

test('THE GATE IS WIRED IN, before the line is built', () => {
  /*
   * A rule nothing calls is the failure this codebase keeps producing. This
   * pins the call site, and that it sits before the row is drawn rather than
   * after.
   */
  const call = source.indexOf('PosnicPro.sales._needsTodaysPrice(params)');
  assert.notStrictEqual(call, -1, 'nothing asks whether the dish needs a price');

  const addLine = source.indexOf('addSalesLineItems: function (params) {');
  assert.ok(call > addLine, 'the gate is outside addSalesLineItems');

  const after = source.slice(call, call + 200);
  assert.match(after, /askTodaysPrice\(params\)/, 'the gate does not ask anything');
  assert.match(after, /return;/, 'the gate asks and then adds the line anyway');
});

test('a refused or empty answer drops the line rather than adding it at zero', () => {
  const ask = source.slice(source.indexOf('askTodaysPrice: function'), source.indexOf('addSalesLineItems: function'));
  assert.match(ask, /if \(!\(price > 0\)\)/, 'an empty or zero answer is accepted');
  assert.match(ask, /return;/, 'it carries on after refusing');
  assert.match(ask, /_priceAsked = true/, 'it will ask again for ever');
  assert.match(ask, /1000000/, 'there is no ceiling, so a fat finger goes straight onto the bill');
});
