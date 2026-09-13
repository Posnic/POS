'use strict';

/*
 * One action, one name, on every screen it appears on.
 *
 * Owner, describing the table screen: "when click table number and see the
 * button. it will have sale print and settlement. Sale print actually meant to
 * take print of before customer pay. so have proper naming. Settlement to pay
 * and after pay normal auto print will come."
 *
 * Two actions were wearing five names between them.
 *
 *   printKOTReceipt        "Sale Print" on the table panel
 *                          "Print Bill" on two list screens
 *                          "Print"      on a third
 *   kothistory.proceed     "Settle" on the table panel
 *                          "Settlement" on four tooltips
 *                          "Settle payment" on the sales dossier
 *
 * None of "Sale Print", "Print" or "Settlement" says what happens. A person
 * learning this till met three words for taking one print and three for taking
 * money, and had to try them to find out.
 *
 * The names now match the paper. Before payment a waiter carries a bill, which
 * the print itself heads TAX INVOICE where GST runs and BILL where it does
 * not, so the button says Print Bill on every screen. Taking the money is Take
 * Payment, a verb phrase like every other button beside it, and the word the
 * packs were already translating lang_settlement into: Encaisser, Abrechnen.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const KOT = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'kot.js');
const HISTORY = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'kothistory.js');
const SALES = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js');
const ENGLISH = JSON.parse(read('languages', '_english.json'));

/* Every screen the two actions appear on. */
const SCREENS = [['kot.js', KOT], ['kothistory.js', HISTORY], ['sales.js', SALES]];

/* Markup only: the lines that actually put a control on a screen. A function
   definition, an internal call, or a comment explaining what a name used to be
   are none of them offers of the action to a person. */
const controls = (src, action) => {
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    if (!action.test(line) || !/onclick=/.test(line)) return;
    /* The label is sometimes on the same line and sometimes on the next one,
       depending on whether the control was written as one string or laid out
       across a template. Both count as the control. */
    out.push(lines.slice(i, i + 3).join('\n'));
  });
  return out;
};

test('nothing on the table screens still offers a control called Sale Print', () => {
  for (const [name, src] of SCREENS) {
    for (const line of src.split(/\r?\n/)) {
      if (!/onclick=|data-t-title=|<lang /.test(line)) continue;
      assert.ok(!/Sale Print/.test(line), name + ' still calls the pre-payment print "Sale Print"');
      assert.ok(!/lang_saleprint/.test(line), name + ' still reaches for the lang_saleprint key');
    }
  }
});

test('the sales view modal keeps Sale Print, because there it is paired with Return Print', () => {
  /*
   * Not everything called "Sale Print" was wrong. In the print dropdown on the
   * sales view it sits next to "Return Print" and the pair reads correctly:
   * print the sale, or print the return. Renaming it there would break the
   * pairing and change a screen nobody complained about.
   */
  const modal = read('frontend', 'modals', 'sales.html');
  assert.match(modal, /lang_saleprint/);
  assert.match(modal, /lang_returnprint/);
});

test('taking the pre-payment print is called Print Bill wherever it is offered', () => {
  let found = 0;
  for (const [name, src] of SCREENS) {
    for (const line of controls(src, /printKOTReceipt\(|kothistory\.print\(/)) {
      found += 1;
      assert.ok(/lang_print_bill/.test(line), name + ' offers the print under some other name');
    }
  }
  assert.ok(found >= 3, 'the print action moved; this test is looking in the wrong place');
});

test('taking the money is called Take Payment wherever it is offered', () => {
  let found = 0;
  for (const [name, src] of SCREENS) {
    for (const line of controls(src, /kothistory\.proceed\(|sales\.showPayment\(/)) {
      found += 1;
      assert.ok(/lang_settlement/.test(line), name + ' offers taking payment under some other name');
    }
  }
  assert.ok(found >= 4, 'the payment action moved; this test is looking in the wrong place');
});

test('none of the old words survive on these screens', () => {
  for (const [name, src] of SCREENS) {
    assert.ok(!/>\s*Settle\s*</.test(src), name + ' still has a bare "Settle" button');
    assert.ok(!/Settle payment/.test(src), name + ' still says "Settle payment"');
    assert.ok(!/title="Settlement"/.test(src), name + ' still has a "Settlement" tooltip');
  }
});

test('the key says Take Payment, which is what the packs were already translating it into', () => {
  assert.strictEqual(ENGLISH.lang_settlement, 'Take Payment');
  assert.strictEqual(ENGLISH.lang_print_bill, 'Print Bill');
});

test('both labels reach the packs rather than sitting as bare English', () => {
  /* A label written straight into a template string is invisible to the
     translation layer, which is how these two buttons came to be the only
     English left on a Tamil till. */
  const panel = KOT.slice(KOT.indexOf('printKOTReceipt'), KOT.indexOf('printKOTReceipt') + 1600);
  assert.match(panel, /<lang class="lang_print_bill">Print Bill<\/lang>/);
  assert.match(panel, /<lang class="lang_settlement">Take Payment<\/lang>/);
});

test('every pack answers both keys, so no till falls back to English', () => {
  const dir = path.join(ROOT, 'languages');
  const packs = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  assert.ok(packs.length >= 17, 'packs went missing');
  for (const file of packs) {
    const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const key of ['lang_settlement', 'lang_print_bill']) {
      assert.ok(pack[key] && String(pack[key]).trim(), file + ' does not answer ' + key);
    }
  }
});
