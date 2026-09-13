'use strict';

/*
 * What the kitchen ticket calls itself, and where the table is.
 *
 * Owner, on how a cook actually treats these: "we actually sent as item
 * cancelled even quantity reduced. for labours they dont care mostly. only
 * cancelled they just cancel while doing it. so keep as it is on this. when
 * whole order cancelled then send as Order cancelled instead of item
 * cancelled. one item or two item removal items cancelled okay. plural.
 * quantity reduced is bad for them."
 *
 * And earlier, on a second ticket for a table already served: "azure asking
 * like new order instead of modified order... with table number clearly
 * mentioned."
 *
 * So a reduction still prints as a cancellation, deliberately. What changes is
 * that losing a whole table's order and losing one line off it stop being the
 * same three words, and the table stops sharing a 13px line with the pax count
 * inside square brackets.
 *
 * These render real tickets rather than reading the template, because the
 * question is what comes out on paper.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

/* kot-manager runs in the Electron main process. It needs a window class and a
   writable path and nothing else to build the HTML. */
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { BrowserWindow: class {}, app: { getPath: () => require('node:os').tmpdir() } };
  }
  return load.call(this, request, ...rest);
};
const KOTManager = require(path.join(__dirname, '..', 'src', 'kot-manager.js'));
Module._load = load;

const kot = new KOTManager();

const ticket = (sale, kind) => kot._buildKOTHtml(sale, kind, 7);
const headingOf = (html) => (html.match(/<div class="lt">([^<]*)<\/div>/) || [])[1];
const biryani = { item_name: 'Chicken Biryani', item_quantity: 2 };
const naan = { item_name: 'Naan', item_quantity: 1 };
const atTable = (extra) => ({
  table_number: '5',
  person_count: '4',
  dine_type: 'Dine in',
  sale_process: 'KOT',
  ...extra,
});

test('a first ticket is a new order, and a later one is an additional order', () => {
  /* Not "Modified Order": the kitchen already cooked from the first sheet and
     threw it away, so there is nothing on their side being modified. */
  assert.strictEqual(headingOf(ticket(atTable({ items: [biryani] }), 'new')), 'New Order');
  assert.strictEqual(headingOf(ticket(atTable({ items: [biryani] }), 'edit')), 'Additional Order');
  assert.ok(!/Modified Order/.test(ticket(atTable({ items: [biryani] }), 'edit')));
});

test('one line off the order is an item cancelled, two or more is plural', () => {
  assert.strictEqual(headingOf(ticket(atTable({ items: [biryani] }), 'cancel')), 'Item Cancelled');
  assert.strictEqual(headingOf(ticket(atTable({ items: [biryani, naan] }), 'cancel')), 'Items Cancelled');
});

test('the whole order going is Order Cancelled, which is a different thing', () => {
  /* The only path that stamps sale_process 'cancelled' is the whole-order
     cancel; taking a line off leaves the order open and still saying KOT. */
  const whole = ticket(atTable({ sale_process: 'cancelled', items: [biryani, naan] }), 'cancel');
  assert.strictEqual(headingOf(whole), 'Order Cancelled');
  const oneLine = ticket(atTable({ sale_process: 'KOT', items: [biryani, naan] }), 'cancel');
  assert.strictEqual(headingOf(oneLine), 'Items Cancelled');
});

test('a reduction still reads as a cancellation, which is what the kitchen wanted', () => {
  /* Owner: "quantity reduced is bad for them". A reduction arrives as a cancel
     job carrying the amount removed, and must keep printing that way. */
  const reduced = ticket(atTable({ items: [{ item_name: 'Chicken Biryani', item_quantity: 2 }] }), 'cancel');
  assert.strictEqual(headingOf(reduced), 'Item Cancelled');
  assert.ok(!/Quantity Reduced|Reduced/i.test(reduced), 'the ticket invented a third kind of sheet');
  assert.match(reduced, /x2/, 'the amount taken off is not on the paper');
});

test('the table gets its own line, in its own size', () => {
  const html = ticket(atTable({ items: [biryani] }), 'new');
  assert.match(html, /<div class="tb">TABLE 5<\/div>/, 'the table is not called out');
  assert.match(html, /\.tb\{font-size:26px/, 'the table prints at the size of the date again');
  assert.ok(!/Table:\[/.test(html), 'the bracketed table and pax line is back');
  /* Pax is still there, just not competing with the table. */
  assert.match(html, /<div class="ml">Pax: 4<\/div>/);
});

test('a takeaway says it has no table, and a table with no pax prints no empty line', () => {
  const takeaway = ticket({ sale_process: 'KOT', dine_type: 'Take away', items: [naan] }, 'new');
  assert.ok(!/class="tb"/.test(takeaway), 'a takeaway printed a table heading');
  assert.match(takeaway, /Table: -/, 'a takeaway does not say it has no table');

  const noPax = ticket({ sale_process: 'KOT', table_number: '5', person_count: '', items: [naan] }, 'new');
  assert.match(noPax, /<div class="tb">TABLE 5<\/div>/);
  assert.ok(!/<div class="ml">Pax/.test(noPax), 'an empty pax line was printed');
});
