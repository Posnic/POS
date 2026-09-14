'use strict';

/*
 * The paper says where the order came from.
 *
 * Owner: "when order sent kitch show one field order source. just source some
 * sutable places: captain source: pos source: customer swiggy or online order
 * or qr those i want. in the bill also specify. keep this as configurable
 * whether client wants to print in kot or not."
 *
 * The kitchen ticket LOG has said this on screen for a while. A cook holding
 * the paper could not see it, and on a floor with handsets, a QR code and two
 * aggregators, "who sent this" is the question a disputed ticket turns on.
 *
 * TWO COPIES OF ONE TABLE, ON PURPOSE. The ticket is drawn in the desktop shell
 * and the bill payload is built in the API, and those two cannot share a module:
 * the API ships OUTSIDE the asar archive as extraResources/server.js while
 * src/ lives inside it, so a require resolves to a second copy or to nothing.
 * That is the same reason kot-notify.js uses `process` as its bus. So the table
 * is written twice and this file compares them - two copies that are checked
 * beat one copy that cannot be reached.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const shell = require(path.join(ROOT, 'src', 'order-source.js'));
const api = require(path.join(ROOT, 'api', 'src', 'utils', 'order-source.js'));
const { renderKitchenTicket } = require(path.join(ROOT, 'src', 'escpos-kot.js'));
const { buildBillPayload } = require(path.join(ROOT, 'api', 'src', 'helpers', 'bill-payload.js'));
const preview = require(path.join(ROOT, 'src', 'escpos-preview.js'));

/* ------------------------------------------------------- the words themselves */

test('every channel is named the way a cook would say it', () => {
  assert.strictEqual(shell.orderSource({ channel: 'tableside' }), 'Captain app');
  assert.strictEqual(shell.orderSource({ channel: 'pos' }), 'Till');
  assert.strictEqual(shell.orderSource({ channel: 'online' }), 'Customer phone');
  assert.strictEqual(shell.orderSource({ channel: 'kiosk' }), 'Kiosk');
  assert.strictEqual(shell.orderSource({ channel: 'phone' }), 'Phone order');
});

test('an aggregator is NAMED, not called Marketplace', () => {
  /*
   * The point of the whole feature for a shop on two aggregators. "Marketplace"
   * on a ticket does not tell anybody who is standing at the counter.
   */
  assert.strictEqual(shell.orderSource({ channel: 'marketplace', channel_partner: 'swiggy' }), 'Swiggy');
  assert.strictEqual(shell.orderSource({ channel: 'marketplace', channel_partner: 'zomato' }), 'Zomato');
  /* Partner ids are stored normalised, so they have to be made readable again. */
  assert.strictEqual(shell.partnerName('zomato_gold'), 'Zomato Gold');
  assert.strictEqual(shell.partnerName('  swiggy  '), 'Swiggy');
  /* A marketplace sale with no partner recorded still says something true. */
  assert.strictEqual(shell.orderSource({ channel: 'marketplace' }), 'Marketplace');
});

test('the waiter is named, because four handsets look alike', () => {
  assert.strictEqual(shell.orderSource({ channel: 'tableside', user_name: 'Ravi' }), 'Captain app (Ravi)');
});

test('years of older sales carry only sale_method, and still answer', () => {
  /* Reading `channel` alone would make every sale written before it existed
     say "Till", quietly and wrongly. */
  assert.strictEqual(shell.orderSource({ sale_method: 'Table-Order' }), 'Captain app');
  assert.strictEqual(shell.orderSource({ sale_method: 'Self-Order' }), 'Customer phone');
  assert.strictEqual(shell.orderSource({ channel: 'pos', sale_method: 'Table-Order' }), 'Till',
    'the new field should win when both are present');
});

test('something unrecognised is repeated, not guessed at', () => {
  assert.strictEqual(shell.orderSource({ sale_method: 'Dunzo' }), 'Dunzo');
  assert.strictEqual(shell.orderSource({}), 'Till');
});

/* ------------------------------------------------- and the two copies agree */

test('the shell and the API print the same words for the same order', () => {
  /*
   * THE TEST THIS FILE EXISTS FOR. An edit to one table that is not made to
   * the other would put one word on the kitchen ticket and a different one on
   * the customer's bill for the same order, and nothing else would notice.
   */
  assert.deepStrictEqual(api.WHERE, shell.WHERE, 'the channel tables have drifted apart');
  assert.deepStrictEqual(api.LEGACY, shell.LEGACY, 'the legacy tables have drifted apart');

  for (const sale of [
    { channel: 'tableside', user_name: 'Ravi' },
    { channel: 'pos' },
    { channel: 'online' },
    { channel: 'kiosk' },
    { channel: 'marketplace', channel_partner: 'swiggy' },
    { channel: 'ecommerce', channel_partner: 'own_shop' },
    { sale_method: 'Table-Order' },
    { sale_method: 'Dunzo' },
    {},
  ]) {
    assert.strictEqual(api.orderSource(sale), shell.orderSource(sale),
      'the two copies disagree about ' + JSON.stringify(sale));
  }
});

/* ------------------------------------------------------------- on the paper */

test('the kitchen ticket prints it, under the bill number', () => {
  /* The top belongs to the three things a cook reads first: what kind of sheet,
     which table, what to make. This is the fourth. */
  const lines = preview.asLines(preview.parse(renderKitchenTicket({
    title: 'New Order', number: 7, tableNo: '6', saleId: 'SB-41',
    source: 'Captain app (Ravi)', items: [{ name: 'Fish Curry', quantity: 1 }],
  }, { paperWidth: '48' }), 48)).filter(Boolean);

  const at = lines.findIndex((l) => l.includes('From: Captain app (Ravi)'));
  assert.ok(at > -1, 'the ticket does not say where the order came from');
  assert.ok(lines.indexOf('SB-41') < at, 'the source is above the bill number');
  assert.ok(at < lines.findIndex((l) => l.startsWith('FISH CURRY')), 'the source is below the food');
});

test('no source prints no line, rather than an empty one', () => {
  /* A shop with one way of taking orders does not need a row on every ticket
     telling it so. */
  const lines = preview.asLines(preview.parse(renderKitchenTicket({
    title: 'New Order', number: 7, tableNo: '6', items: [{ name: 'Fish Curry', quantity: 1 }],
  }, { paperWidth: '48' }), 48));
  assert.ok(!lines.some((l) => l.includes('From:')), 'an empty source printed a line anyway');
});

test('the bill prints it too', () => {
  const payload = buildBillPayload(
    { sales_id: 'SB-42', sales_total: 420, items: [{ item_name: 'Fish Curry', item_quantity: 1, item_total: 420 }],
      channel: 'marketplace', channel_partner: 'swiggy' },
    { branch_name: 'Azure Sea Foods' }
  );
  assert.strictEqual(payload.source, 'Swiggy');
  const receipt = fs.readFileSync(path.join(ROOT, 'src', 'escpos-receipt.js'), 'utf8');
  assert.match(receipt, /if \(sale\.source\) r\.line\('From: ' \+ sale\.source\);/,
    'the payload carries a source the receipt never prints');
});

/* ----------------------------------------------------------- and it is a switch */

test('a shop can turn it off on the kitchen ticket', () => {
  /* Owner: "keep this as configurable whether client wants to print in kot or
     not." */
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /this\.config && this\.config\.kot_print_source === false/);
  assert.match(kot, /source: this\.config/);
});

test('and on the bill', () => {
  const off = buildBillPayload({ sales_id: 'x', channel: 'pos' }, { bill_print_source: false });
  assert.strictEqual(off.source, '');
  /* The settings form posts strings, so 'false' is a real stored value and
     reading it as a boolean would leave it switched on. */
  const offString = buildBillPayload({ sales_id: 'x', channel: 'pos' }, { bill_print_source: 'false' });
  assert.strictEqual(offString.source, '');
});

test('absent means on, because it is what was asked for', () => {
  assert.strictEqual(buildBillPayload({ sales_id: 'x', channel: 'pos' }, {}).source, 'Till');
});

test('both copies are in the packaged build', () => {
  /* build.files is an allowlist, and the API half rides with server.js rather
     than the archive - so only the shell copy needs listing here. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/order-source.js'));
});
