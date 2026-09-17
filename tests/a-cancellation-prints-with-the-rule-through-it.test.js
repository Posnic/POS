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

test('EVERY TICKET TAKES THE FAST PATH, cancellations included', () => {
  /*
   * This test used to assert the opposite, and it was right when it was
   * written. The routing said `!isCancellation && this.hardware`, because
   * ESC/POS cannot draw a line THROUGH text and only the HTML window could.
   *
   * The bytes learned to draw it eleven hours later the same day -
   * strikeCancelled into the byte builder at 12:46, escpos-raster-text at
   * 13:16, against an exclusion written at 01:24 - and nobody came back to
   * flip the switch. Every cancellation since paid for a BrowserWindow it no
   * longer needed, which is what a shop finally noticed on paper: "new order
   * print is so so fast. very immediate but cancel order took some time."
   *
   * So the assertion is inverted rather than deleted. A future reader who
   * reintroduces the exclusion should fail here.
   */
  const at = KOT.indexOf('if (this.hardware && typeof this.hardware.sendRawToPrinter');
  assert.notStrictEqual(at, -1, 'nothing routes a ticket to the raw printer any more');

  const decision = KOT.slice(at, KOT.indexOf('\n    }', at));
  assert.match(decision, /_printRaw\(sale, printKind, kotNumber, printerNames\)/,
    'nothing takes the fast path any more');

  assert.ok(
    !/!isCancellation\s*&&\s*this\.hardware/.test(KOT),
    'a cancellation is excluded from the fast path again, and the bytes can draw the rule now'
  );
});

test('and the bytes are told to strike it, or the fast path would print a lie', () => {
  /*
   * The whole reason a cancellation could take the slow path safely was that
   * the slow path struck the name. Taking the fast path without
   * strikeCancelled would print a cancelled dish that looks live, which is
   * worse than slow.
   */
  assert.match(KOT, /strikeCancelled:/, 'the byte builder is no longer told to strike');
  assert.match(KOT, /cancelled: f\.isCancelled/, 'the bytes are not told which line was cancelled');
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
