'use strict';

/*
 * A CANCELLATION IS NOT AN ORDER.
 *
 * Owner, the first time he heard the kitchen speak for real: "one mistake for
 * cancelled order it reads as new order. item cancelled or order cancelled
 * clearly need to do."
 *
 * The till writes three kinds of kitchen ticket - new, modified and cancel -
 * and the announcer asked one question: is this modified? Everything that was
 * not modified opened with "new order", so a table taking two biryanis OFF was
 * read across the kitchen as a table ordering two biryanis.
 *
 * That is the worst shape a bug in this feature can take. Silence loses a
 * ticket; this cooks food nobody asked for, and the kitchen has no way to know
 * because the words were confident and wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { script, say } = require('../src/kitchen-call');

const TICKET = [
  { item_name: 'Chicken Biryani', item_quantity: 2 },
  { item_name: 'Butter Naan', item_quantity: 1 },
];

test('A CANCELLED TICKET NEVER SAYS "NEW ORDER"', () => {
  const said = say({ table: '5', items: TICKET, cancelled: true });

  assert.doesNotMatch(said, /new order/i, 'a cancellation is announced as an order');
  assert.match(said, /cancel/i);
});

test('the whole order going is a different sentence from two dishes coming off', () => {
  /*
   * They are different jobs. One clears a table; the other changes what is
   * already on the pass, and the rest of that ticket is still being cooked.
   */
  const whole = script({ table: '5', items: TICKET, cancelled: true, whole: true });
  const part = script({ table: '5', items: TICKET, cancelled: true });

  assert.strictEqual(whole.head[0], 'Table 5, order cancelled.');
  assert.strictEqual(part.head[0], 'Table 5, items cancelled.');
});

test('and one line coming off says item, not items', () => {
  const one = script({ table: '5', items: [TICKET[1]], cancelled: true });
  assert.strictEqual(one.head[0], 'Table 5, item cancelled.');
});

test('EVERY CANCELLED LINE SAYS SO, not only the opening', () => {
  /*
   * A cook who walks up half way through hears one dish and a number and
   * nothing else. "Cancel two Chicken Biryani" cannot be misheard as an order
   * for two; "Two Chicken Biryani" after an opening they missed can.
   */
  const said = script({ table: '5', items: TICKET, cancelled: true });

  assert.deepEqual(said.items, ['Cancel two Chicken Biryani.', 'Cancel one Butter Naan.']);
});

test('the count says the plates are coming OFF', () => {
  const said = script({ table: '5', items: TICKET, cancelled: true });
  assert.strictEqual(said.head[1], 'Three items off.');
});

test('a new order and an amendment are untouched', () => {
  /* The common case must read exactly as it did before this existed. */
  const fresh = script({ table: '5', items: TICKET });
  const changed = script({ table: '5', items: TICKET, changed: true });

  assert.deepEqual(fresh.head, ['Table 5, new order.', 'Three items.']);
  assert.deepEqual(fresh.items, ['Two Chicken Biryani.', 'One Butter Naan.']);
  assert.strictEqual(changed.head[0], 'Table 5, order changed.');
});

test('a ticket with no table still says what kind it is', () => {
  const said = script({ items: TICKET, cancelled: true, whole: true });
  assert.strictEqual(said.head[0], 'Order cancelled.');
});

/* ------------------------------------------------- what the caller passes */

test('THE TILL TELLS THE ANNOUNCER WHICH KIND OF TICKET IT IS', () => {
  /*
   * The words above are only right if the caller says which job this is. The
   * server writes `type: 'cancel'` and this read `=== 'modified'` and nothing
   * else, which is where the whole fault lived.
   */
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'kot-manager.js'), 'utf8');
  const at = manager.indexOf('_announceToKitchen(sale, items, jobType)');
  assert.ok(at > -1, 'nothing announces to the kitchen');

  const body = manager.slice(at, at + 2000);
  assert.match(body, /cancelled: kind === 'cancel'/);
  assert.match(body, /changed: kind === 'modified'/);
});

test('and whether it is the whole order is COUNTED, not guessed', () => {
  /*
   * No flag on the ticket says this: the server builds a cancel job out of
   * whichever lines were struck. If that is every line the sale has, the
   * table is being cleared.
   */
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'kot-manager.js'), 'utf8');
  const at = manager.indexOf('_announceToKitchen(sale, items, jobType)');
  const body = manager.slice(at, at + 2000);

  assert.match(body, /const onTheSale = Array\.isArray\(sale\.items\) \? sale\.items\.length : 0/);
  assert.match(body, /whole = kind === 'cancel' && onTheSale > 0 && items\.length >= onTheSale/);
});

/* --------------------------------------------------- where voices come from */

test('SOMEBODY CAN GET MORE VOICES WITHOUT BEING TOLD TO GO AND LOOK', () => {
  /*
   * Owner: "voice are as per system. if user can install more show the way to
   * do." The note used to say more voices exist, which is a sentence somebody
   * reads and then does not know where to go.
   */
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'hardware-manager.html'), 'utf8');

  assert.match(page, /id="kitchenVoiceGet"/, 'there is no way to get more voices');
  assert.match(page, /desktop\.open\('voices'\)/, 'the button reaches nothing');
  assert.match(page, /Add voices/, 'it does not say what to do when the settings open');
});

test('and the renderer names an intent rather than an address', () => {
  /*
   * A page passing its own URL to shell.openExternal turns an allowlist into
   * an open redirect for anything that can reach that channel.
   */
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const at = main.indexOf("case 'voices':");
  assert.ok(at > -1, 'main does not answer the button');

  const branch = main.slice(at, at + 600);
  assert.match(branch, /ms-settings:speech/, 'Windows is where the voices are installed');
  assert.match(branch, /process\.platform === 'win32'/);
  assert.match(branch, /darwin/, 'a Mac is sent nowhere');
});
