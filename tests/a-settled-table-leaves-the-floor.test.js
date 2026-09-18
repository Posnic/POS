'use strict';

/*
 * A SETTLED TABLE LEAVES THE FLOOR, AND A PRINTED BILL DOES NOT.
 *
 * Owner, in one message, about three things that are really one thing:
 *
 *   "after pyament still have issue i think when table clicked its howing
 *   old order. next after print bill that right display closed. it mean
 *   page refreshed and selected table not selected more. if i click print
 *   bill then i need success message bill printed and show same page. if i
 *   click take payment and payment is over then remove that table from
 *   screen and also clear from that able."
 *
 * The three faults, in the order he met them:
 *
 *   A tapped table listed settled orders. The grid of tables and the panel
 *   beside it are two different queries, and only the grid asked for
 *   unpaid tickets. A Table-Order sale keeps sale_process 'KOT' even after
 *   it is paid - sale.service.js forces it back - so the only thing
 *   separating a live table from a finished one is payment_status.
 *
 *   Printing a bill deselected the table. afterPrint reset #/kot/6 to
 *   #/kot, which is the same screen with nothing on the right of it.
 *
 *   Settling rebuilt the whole app through #/dashboard to "force change
 *   detection", when both halves of the screen only ever needed asking
 *   again.
 *
 * None of the three announces itself. Each looks like the screen simply
 * behaving oddly, which is why they were reported three times before they
 * were understood.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NL = String.fromCharCode(10);

const KOT = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'kot.js'),
  'utf8'
);
const CORE = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'),
  'utf8'
);

/** Every filter object in kot.js that asks the sales list for KOT tickets. */
function tableQueries() {
  const out = [];
  const lines = KOT.split(NL);
  lines.forEach((line, i) => {
    if (/sale_process:\s*'KOT'/.test(line)) {
      out.push({ line: i + 1, near: lines.slice(i, i + 4).join(NL) });
    }
  });
  return out;
}

test('there are table queries to check at all', () => {
  /* If this screen is rewritten into another shape the sweep below would
     pass by finding nothing. Say so instead. */
  assert.ok(tableQueries().length >= 1,
    'no KOT filter objects found in kot.js; this test is reading nothing');
});

test('EVERY table query asks only for tickets that are still open', () => {
  /*
   * The grid on the left is getTablesWithActiveOrders: branch, sale_process
   * KOT, payment_status Unpaid. A panel that asks for the same table without
   * the payment clause disagrees with it, and the disagreement is visible -
   * the owner tapped a table and got orders that had already been settled,
   * each with a live Take Payment button.
   *
   * Swept rather than named, because there are three copies of this query in
   * the file and only one of them is reached today.
   */
  const missing = tableQueries()
    .filter((q) => !/payment_status:\s*'Unpaid'/.test(q.near))
    .map((q) => 'line ' + q.line);

  assert.deepStrictEqual(missing, [],
    'these list settled tickets as if a table were still occupied: ' + missing.join(', '));
});

test('a settled ticket cannot be matched by the panel that offers Take Payment', () => {
  /*
   * Named so the sweep cannot be satisfied by a file that has stopped asking
   * for the table at all. loadTableDetails is what a tap on a table runs.
   */
  const at = KOT.indexOf('loadTableDetails: function');
  assert.ok(at > 0, 'the panel a tapped table opens is gone');
  const body = KOT.slice(at, at + 2600);
  assert.match(body, /payment_status:\s*'Unpaid'/,
    'tapping a table would list orders that have already been paid for');
});

test('printing a bill leaves the waiter on the table they printed it for', () => {
  /*
   * A table is #/kot/6. afterPrint used to reset the address to its first
   * part, which is #/kot - the same screen with nothing selected. The paper
   * came out and the order disappeared off the right of the screen.
   */
  const at = CORE.indexOf('afterPrint: function');
  assert.ok(at > 0, 'afterPrint is gone');
  const end = CORE.indexOf('}, 800);', at);
  assert.ok(end > at, 'afterPrint no longer has its deferred body');
  const body = CORE.slice(at, end);

  assert.match(body, /parts\[0\]\s*===\s*'kot'/,
    'the KOT screen is not held, so a printed bill deselects the table');

  /* The guard has to come before the reset, or it never runs. */
  const guard = body.indexOf("parts[0] === 'kot'");
  const reset = body.indexOf('hasher.setHash(parts[0])');
  assert.ok(reset > 0, 'the reset this guard protects against is gone');
  assert.ok(guard < reset, 'the KOT guard sits after the reset, so it is dead');
});

test('settling a bill refreshes the floor instead of rebuilding the app', () => {
  /*
   * refreshKOTData used to bounce through #/dashboard and back to force the
   * router to re-fire. That tore the page down, drew the dashboard for a
   * frame and rebuilt the KOT screen - the "page refreshed" the owner saw.
   */
  const at = KOT.indexOf('refreshKOTData: function');
  assert.ok(at > 0, 'refreshKOTData is gone');
  const end = KOT.indexOf('loadTableDetails: function', at);
  const body = KOT.slice(at, end);

  assert.ok(!/dashboard/.test(body),
    'the floor still refreshes by bouncing through another page');
  assert.match(body, /currentTableNumber = null/,
    'the settled table stays selected');
  assert.match(body, /loadTables\(/,
    'the table grid is never re-read, so a settled table stays on screen');
});
