'use strict';

/*
 * A switch nobody can reach is not a switch.
 *
 * The bill stopped printing the table number, the order type, the covers, the
 * steward, the item count and where the order came from, because the owner read
 * one and said so: "in the bill Table, order type, covers umber of items not
 * required. KOT fine. not in the bill."
 *
 * Then he sent a hotel restaurant's tax invoice printing every one of them:
 * "we have those as optional. no need to incluede... based on settings we can
 * add it. like toggle or desgn in one place for printing receipt."
 *
 * So the rows are switches, off by default, gathered on ONE card - the Receipt
 * Print tab that already holds Auto Print, Print Logo and Print Customer. A
 * setting that exists only in the payload reader is a row a shop can never get
 * back, which would have been a quiet loss dressed up as a fix.
 *
 * THIS TEST WALKS THE WHOLE CHAIN, because it has five links and any one of
 * them silently drops the value:
 *
 *   the card         frontend/modules/settings_write.html
 *   read + written   frontend/static/script/js/modules/js/settings.js
 *   coerced          api/src/models/setting.model.js
 *   stored           api/src/models/branch.model.js
 *   obeyed           api/src/helpers/bill-payload.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { buildBillPayload } = require(path.join(ROOT, 'api', 'src', 'helpers', 'bill-payload.js'));

const SWITCHES = [
  'bill_print_table',
  'bill_print_dine_type',
  'bill_print_covers',
  'bill_print_steward',
  'bill_print_total_qty',
  'bill_print_source',
  'bill_print_session',
  'bill_print_hsn',
  'bill_print_fssai',
];

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const CARD = read('frontend', 'modules', 'settings_write.html');
const SETTINGS_JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const SETTING_MODEL = read('api', 'src', 'models', 'setting.model.js');
const BRANCH_MODEL = read('api', 'src', 'models', 'branch.model.js');

/* -------------------------------------------------------------- every link */

test('EVERY SWITCH SURVIVES ALL FIVE LINKS OF THE CHAIN', () => {
  const broken = [];
  for (const key of SWITCHES) {
    if (!new RegExp('id="' + key + '"').test(CARD)) broken.push(key + ': no control on the card');
    if (!new RegExp('name="' + key + '"').test(CARD)) broken.push(key + ': the control has no name');
    if (!new RegExp('data\\.' + key + ' === true').test(SETTINGS_JS)) {
      broken.push(key + ': the card never shows what is stored');
    }
    if (!new RegExp(key + ": \\(\\$\\('#" + key + "'\\)").test(SETTINGS_JS)) {
      broken.push(key + ': Save does not send it');
    }
    if (!new RegExp('this\\.toBoolean\\(data\\.' + key + '\\)').test(SETTING_MODEL)) {
      broken.push(key + ': the string from the form is never coerced');
    }
    if (!new RegExp(key + ': \\{ type: Boolean, default: false \\}').test(BRANCH_MODEL)) {
      broken.push(key + ': the shop cannot store it, or does not default to off');
    }
    if (!new RegExp(key + ": \\{ type: 'String', select: true \\}").test(BRANCH_MODEL)) {
      broken.push(key + ': it is stored but never read back');
    }
  }
  assert.deepStrictEqual(broken, []);
});

/* --------------------------------------------------- and the default is off */

const A_TABLE_SALE = {
  sales_id: 'SB1D15-000009',
  date: new Date(2026, 8, 14, 19, 55),
  table_number: '16',
  dine_type: 'Dine In',
  person_count: 1,
  created_by: 'Sriram',
  channel: 'tableside',
  items: [{ name: 'Malabar Paratha', item_quantity: 4, item_base_price: 100, hsncode: '996332' }],
  sales_sub_total: 400,
  sales_total: 400,
};

/* What each switch needs on the SHOP before it can print anything. A switch
   turned on for data the shop has not got must print nothing, which is a
   different test - this one proves the switch is wired at all. */
const SHOP_DATA = {
  bill_print_fssai: { branch_fssai_number: '12415013000025' },
  bill_print_session: {
    menu_dayparts: [{ id: 'dinner', name: 'Dinner', hours: [{ from: '19:00', to: '23:30' }] }],
  },
};

test('a shop that has never opened this card sees no change at all', () => {
  /* The direction that matters. 90 shops print today; a default of on would put
     six new rows on every one of their bills the morning this deploys. */
  const bill = buildBillPayload(A_TABLE_SALE, {});
  assert.deepStrictEqual(bill.serviceRows, []);
  assert.strictEqual(bill.source, '');
  assert.strictEqual(bill.fssai, '');
  assert.deepStrictEqual(bill.items.map((i) => i.hsn), ['']);
  /* extras stays what it always was: rows a shop's own template added. */
  assert.deepStrictEqual(bill.extras, []);
});

test('every switch actually changes the bill when it is turned on', () => {
  /*
   * One at a time, so a switch that does nothing cannot hide behind a
   * neighbour that does - which is how a dead toggle ships.
   */
  const dead = [];
  for (const key of SWITCHES) {
    const bill = buildBillPayload(A_TABLE_SALE, { [key]: true, ...(SHOP_DATA[key] || {}) });
    /* totalQty is deliberately NOT a serviceRow. It is a count of what was
       bought, so it prints beside the subtotal rather than in the header with
       the table number - see bill-payload's totalQuantity and
       tests/the-bill-reads-like-a-bill. A switch is alive if it changes the
       bill ANYWHERE, not only in one block. */
    const changed =
      bill.serviceRows.length > 0 ||
      bill.source !== '' ||
      bill.fssai !== '' ||
      String(bill.totalQty || '') !== '' ||
      bill.items.some((i) => i.hsn);
    if (!changed) dead.push(key);
  }
  assert.deepStrictEqual(dead, [], 'switches that print nothing when on');
});

test('the card says what each row is, in words a shop owner uses', () => {
  /* A card of six unexplained toggles is a card nobody touches. */
  for (const key of SWITCHES) {
    assert.match(CARD, new RegExp('lang_' + key + '_hint'), key + ' has no explanation');
  }
  assert.match(CARD, /lang_what_the_bill_carries/, 'the section has no heading');
});

test('none of it touches the kitchen ticket', () => {
  /*
   * The whole argument for taking these off the bill is that the kitchen has
   * them. A switch on this card that reached the ticket would take the table
   * number off a cook's paper, and a cook who cannot see the table number
   * cannot send the food anywhere.
   */
  const kot = read('src', 'kot-manager.js') + read('src', 'escpos-kot.js');
  for (const key of SWITCHES) {
    assert.ok(!kot.includes(key), 'the kitchen ticket now obeys ' + key);
  }
});

test('the customer GSTIN is deliberately NOT one of these switches', () => {
  /*
   * Every row above is a shop decision made once. A customer handing over a
   * GSTIN is not: they are standing at the counter asking for a bill they can
   * claim against, and making them wait while somebody finds a settings page
   * is the failure being fixed. Given means printed.
   */
  const payload = read('api', 'src', 'helpers', 'bill-payload.js');
  const block = payload.slice(payload.indexOf('function customerLines'));
  assert.ok(!/wants\(/.test(block.slice(0, block.indexOf('\n}'))),
    'the customer GSTIN has grown a setting to hide behind');
  assert.match(CARD, /lang_customer_gstin_always_prints/,
    'the card does not say the GSTIN prints without a switch');
});
