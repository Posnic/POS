/*
 * What the handset's home screen is told about the floor.
 *
 * getTablesWithActiveOrders grouped every open KOT by table and then threw
 * away everything except the table's name, so the first screen a waiter sees
 * could draw a grid of identical boxes and nothing else. Walking back onto the
 * floor, the question is which table has been waiting longest and which is
 * nearly done - and the screen could not say.
 *
 * The cost of answering it is three accumulators on a pass that was already
 * happening. The cost of getting the SHAPE wrong is every handset that has not
 * been updated showing an empty home screen, which is why most of this file is
 * about the shape.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'src', 'services', 'sale.service.js'),
  'utf8'
);

const fn = (() => {
  const at = source.indexOf('const getTablesWithActiveOrders');
  const end = source.indexOf('\nconst getSaleById', at);
  return source.slice(at, end);
})();

test('the floor is counted, timed and totalled in the group that already ran', () => {
  /* Three accumulators, not a second query: the documents are grouped by
     table here anyway, and a restaurant's home screen polls this. */
  assert.match(fn, /orders: \{ \$sum: 1 \}/, 'the open tickets are not counted');
  assert.match(fn, /since: \{ \$min:/, 'the earliest ticket is not kept');
  assert.match(fn, /amount: \{ \$sum:/, 'the tables are not totalled');
});

test('a missing date falls back rather than sorting first', () => {
  /* created_date is not on every historic document. A null $min would make
     the oldest table look like the newest - the exact opposite of the
     signal. */
  assert.match(fn, /\$ifNull: \['\$created_date', '\$date'\]/, 'there is no fallback date');
  assert.match(fn, /\$ifNull: \['\$sales_total', 0\]/, 'a sale with no total would make the sum null');
});

test('`tables` is still a list of names', () => {
  /*
   * THE COMPATIBILITY RULE. Handsets in the field are on whatever version they
   * were last updated to, and that app does `tables.forEach(name => ...)` on
   * strings. Turning those into objects would empty the home screen of every
   * phone not yet updated - on the screen a waiter opens first.
   */
  assert.match(fn, /tables: uniqueTables/, 'tables is no longer the plain name list');
  assert.match(fn, /table_details/, 'the detail does not ride alongside');
});

test('the detail lines up with the names, one for one', () => {
  /* Built by mapping the same uniqueTables, so a name can never be in one
     list and missing from the other. */
  assert.match(fn, /uniqueTables\.map\(/, 'the detail is not derived from the names');
});

test('a table waiting on two dine types is waiting since the EARLIER one', () => {
  /*
   * One table name can carry more than one group. The table has been waiting
   * since its first open ticket, not its most recent - taking the later one
   * would quietly reset the clock every time somebody added a round of
   * drinks, and the table that most needs attention would look the freshest.
   */
  assert.match(fn, /was\.since <= res\.since/, 'the earlier ticket does not win');
});

test('the time is sent as an instant, not as a local string', () => {
  /* A handset in a different timezone has to read the same moment. */
  assert.match(fn, /toISOString\(\)/, 'the time is not sent as an instant');
});

test('takeaway is reported the same way tables are', () => {
  /* It is a queue with a wait like any other, and the old response said only
     that it existed. */
  assert.match(fn, /takeaway_detail/, 'takeaway carries no detail');
  assert.match(fn, /has_takeaway: hasTakeaway/, 'the old takeaway flag is gone');
});

test('nothing open is still an empty list, not a null', () => {
  /* The caller does .forEach on it. */
  assert.match(fn, /const tables = \[\]/, 'tables no longer starts as an array');
});
