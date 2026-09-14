/*
 * A CANCELLATION TICKET IS PRINTED THE WAY THAT CAN DRAW THE RULE.
 *
 * Owner: "whenever order cancel or item cancel those line item name should be
 * strick in the middle. it symbolic that we cancelled it." Then, having seen a
 * rule printed underneath the name instead of through it: "no no. this is not
 * what we want. can send as image ?" and "how about make pdf and send ?"
 *
 * Right on both counts. ESC/POS cannot draw a line THROUGH text: there is no
 * bit for it in `ESC !`, no command that draws one, and no way back over a
 * line the printer has already committed. The fast path can only put a rule
 * near the name, which is what he rejected.
 *
 * The window path renders HTML, and `.in.cx { text-decoration: line-through }`
 * has drawn it correctly since before any of this. So a cancellation takes
 * that path and everything else keeps the 124ms one.
 *
 * The trade is deliberate and worth writing down: the window costs about a
 * second more per ticket. A cancellation is rare, and it is the one ticket a
 * cook must not misread.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const KOT = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');

/* ------------------------------------------------- the rule is drawn */

test('the HTML ticket strikes a cancelled name through', () => {
  assert.match(KOT, /\.in\.cx\{text-decoration:line-through;?\}/,
    'the stylesheet no longer draws the rule');
  assert.match(KOT, /class="in \$\{isCancelled \? 'cx' : ''\}"/,
    'the class is never put on a cancelled line');
});

/* ----------------------------------------- and the right path is taken */

test('a cancellation does not take the ESC/POS path, which cannot strike', () => {
  const at = KOT.indexOf('const isCancellation =');
  assert.notStrictEqual(at, -1, 'nothing decides which path a cancellation takes');

  const decision = KOT.slice(at, KOT.indexOf('\n    }', at));
  assert.match(decision, /!isCancellation && this\.hardware/,
    'a cancellation still goes to the raw printer, where the rule cannot be drawn');
});

test('an ordinary ticket still takes the fast path', () => {
  /*
   * The whole reason this is a routing rule and not a switch: the window
   * costs 1,114ms of a 2,080ms order-to-paper time, measured on a real till.
   * Every new order must keep the 124ms path.
   */
  const at = KOT.indexOf('const isCancellation =');
  const decision = KOT.slice(at, KOT.indexOf('\n    }', at));
  assert.match(decision, /_printRaw\(sale, printKind, kotNumber, printerNames\)/,
    'nothing takes the fast path any more');
});

test('the decision is made from printKind, not from the sale', () => {
  /*
   * `printKind` is what the caller decided this ticket IS. Reading the sale
   * instead would mean a whole-order cancellation and a single removed line
   * take different paths, and the removed line is the commoner of the two.
   */
  assert.match(KOT, /const isCancellation = printKind === 'cancel';/);
});

test('the trade is written down where somebody will undo it', () => {
  /*
   * A future reader finding a slow path for one ticket kind will delete it
   * unless the reason is next to it. This has been undone once already, in
   * spirit: the rule went under the name because the fast path could not draw
   * it, and that was shipped and rejected.
   */
  const at = KOT.indexOf('A CANCELLATION GOES THE SLOW WAY');
  assert.notStrictEqual(at, -1, 'the reason is not recorded beside the rule');
  /* Unwrapped first: the sentence is split across comment lines, and a test
     that only matches it on one line fails the day somebody reflows it. */
  const why = KOT.slice(at, at + 1800)
    .replace(/^\s*\*\s?/gm, ' ')
    .replace(/\s+/g, ' ');
  assert.match(why, /ESC\/POS cannot draw a line THROUGH text/);
  assert.match(why, /rare/);
});
