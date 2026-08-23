const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cssReader, stripComments } = require('./helpers/source-lookup');

/*
 * Cash denominations, and saying whether the money on the counter is enough.
 *
 * Owner ask: "current denomination and process not so great. if customer give
 * more note then we need inform customer its more than what we want... for
 * each country we should have database already prefilled denomation."
 *
 * The sharp end is the first half. "Return balance 0.00" was shown BOTH when
 * the customer had paid to the penny and when they were still hundreds short -
 * two situations that must never look alike at a counter, because the second
 * one ends with the shop out of pocket and nobody knowing when it happened.
 */

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const salesRaw = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js');
const salesJs = stripComments(salesRaw);
const html = read('frontend', 'modules', 'sales_write.html');
const cssRule = cssReader(read('frontend', 'static', 'style', 'css', 'custom.css'));

/* The real function, run against a stub. Read out of the file rather than
   copied, so the test cannot pass while the till does something else. */
function loadDenominations() {
  const from = salesRaw.indexOf('PosnicPro.sales.defaultDenominations = function () {');
  assert.notStrictEqual(from, -1, 'defaultDenominations is gone');
  const body = salesRaw.slice(from, salesRaw.indexOf('\n};', from) + 3);

  /* The table lives at module scope, so it is evaluated alongside the
     function - and shared between calls, which is exactly what makes the
     copy-on-return worth asserting. */
  const tableAt = salesRaw.indexOf('var POSNIC_DENOMINATION_SETS = {');
  assert.notStrictEqual(tableAt, -1, 'the denomination table is gone');
  const table = salesRaw.slice(tableAt, salesRaw.indexOf('\n};', tableAt) + 3);

  const store = {};
  const scope = { local: { get: (k) => store[k] || '' }, sales: {} };
  // eslint-disable-next-line no-new-func
  new Function('PosnicPro', table + '\n' + body)(scope);
  return {
    body: table,
    for: (sign) => { store.currencySign = sign; return scope.sales.defaultDenominations(); },
  };
}

function loadStatus() {
  const from = salesRaw.indexOf('    showTenderStatus: function (tendered, billAmount) {');
  assert.notStrictEqual(from, -1, 'showTenderStatus is gone');
  let depth = 0;
  let end = -1;
  for (let i = salesRaw.indexOf('{', from); i < salesRaw.length; i++) {
    if (salesRaw[i] === '{') depth++;
    else if (salesRaw[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const body = salesRaw.slice(from, end).replace('showTenderStatus: function', 'function showTenderStatus');

  const state = { text: '', cls: new Set(), shown: false };
  const el = {
    length: 1,
    text(t) { if (t !== undefined) { state.text = t; return el; } return state.text; },
    addClass(c) { String(c).split(' ').forEach((x) => state.cls.add(x)); return el; },
    removeClass(c) { String(c).split(' ').forEach((x) => state.cls.delete(x)); return el; },
    show() { state.shown = true; return el; },
    hide() { state.shown = false; return el; },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', 'PosnicPro', body + '\nreturn showTenderStatus;')(
    () => el,
    { local: { get: () => '₹' } },
  );
  return (tendered, bill) => {
    state.text = '';
    state.cls = new Set();
    state.shown = false;
    fn(tendered, bill);
    return { text: state.text, cls: [...state.cls], shown: state.shown };
  };
}

/* ------------------------------------------------------------------ *
 * Short, exact, or change
 * ------------------------------------------------------------------ */

test('being short is never shown as a zero balance', () => {
  /* The exact case from the report: 9 x 500 against a 5262.65 bill. */
  const status = loadStatus();
  const r = status(4500, 5262.65);
  assert.ok(r.shown, 'nothing is shown when the customer is short');
  assert.ok(r.cls.includes('is-short'), `expected the short state, got ${r.cls.join(' ')}`);
  assert.match(r.text, /762\.65/, 'the amount still owed is not stated');
  assert.match(r.text, /still to pay/i, 'it does not say what the number means');
});

test('paying exactly is distinguishable from being short', () => {
  /* Both used to read "0.00". */
  const status = loadStatus();
  const exact = status(5262.65, 5262.65);
  const short = status(4500, 5262.65);
  assert.ok(exact.cls.includes('is-exact'));
  assert.notDeepStrictEqual(exact.text, short.text);
});

test('over-paying says how much to give back', () => {
  const status = loadStatus();
  const r = status(6000, 5262.65);
  assert.ok(r.cls.includes('is-over'));
  assert.match(r.text, /737\.35/);
  assert.match(r.text, /change/i);
});

test('a rounding difference is not called a shortfall', () => {
  /* Half a paisa under is arithmetic, not an unpaid bill. */
  const status = loadStatus();
  assert.ok(status(5262.645, 5262.65).cls.includes('is-exact'));
});

test('nothing counted yet says nothing', () => {
  /* The row must not sit there reading "short" before anybody has touched a
     note - that is nagging, not information. */
  assert.strictEqual(loadStatus()(0, 5262.65).shown, false);
});

test('the status is shown in words and colour, not a bare number', () => {
  /* A cashier reads this for about a second while talking to somebody. */
  assert.ok(html.includes('tender_status'), 'the status element is missing');
  for (const state of ['is-short', 'is-exact', 'is-over']) {
    assert.match(cssRule(`.tender-status.${state}`), /background/, `${state} has no colour`);
  }
});

/* ------------------------------------------------------------------ *
 * The prefilled denominations
 * ------------------------------------------------------------------ */

test('many currencies are covered, not just a handful', () => {
  const { body } = loadDenominations();
  const entries = [...body.matchAll(/^ {8}'([^']+)': \[/gm)];
  assert.ok(entries.length >= 40, `only ${entries.length} currencies are prefilled`);
});

test('every set is ascending, positive and free of duplicates', () => {
  /* The buttons are rendered in the order given, and a repeated value is two
     buttons that do the same thing. */
  const { body } = loadDenominations();
  for (const m of body.matchAll(/^ {8}'([^']+)': \[([^\]]+)\]/gm)) {
    const sign = m[1];
    const vals = m[2].split(',').map((x) => parseFloat(x.trim()));
    assert.ok(vals.every((v) => Number.isFinite(v) && v > 0), `${sign} has a bad value`);
    assert.deepStrictEqual(vals, [...vals].sort((a, b) => a - b), `${sign} is not ascending`);
    assert.strictEqual(new Set(vals).size, vals.length, `${sign} repeats a value`);
    assert.ok(vals.length >= 4, `${sign} has too few denominations to be real`);
  }
});

test('a shop in Nigeria or Indonesia does not get rupee buttons', () => {
  const d = loadDenominations();
  assert.notDeepStrictEqual(d.for('₦'), d.for('₹'), 'naira falls back to rupees');
  assert.notDeepStrictEqual(d.for('Rp'), d.for('₹'), 'rupiah falls back to rupees');
  assert.ok(d.for('Rp').includes(100000), 'the rupiah set has no large notes');
});

test('an unknown currency falls back to a 1-2-5 ladder, not to one country', () => {
  /*
   * Almost every currency is built on 1, 2 and 5 by powers of ten, so this is
   * recognisable nearly anywhere - and unlike a copy of one country's notes it
   * does not look like a bug to everybody else.
   */
  const d = loadDenominations();
  const fallback = d.for('§');
  assert.deepStrictEqual(fallback, [1, 2, 5, 10, 20, 50, 100, 200, 500]);
});

test('the caller gets a copy, so the table cannot be mutated', () => {
  /* The sale screen sorts this list in place in one of its two callers. */
  const d = loadDenominations();
  const first = d.for('₹');
  first.push(99999);
  assert.ok(!d.for('₹').includes(99999), 'the shared table was modified');
});

test("the shop's own list still wins", () => {
  /* Settings > Cash Denominations is the authority; this is only the start. */
  assert.match(
    salesJs,
    /SaleDenomination[\s\S]{0,200}defaultDenominations/,
    'the shop-defined list no longer takes precedence',
  );
});
