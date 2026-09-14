'use strict';

/*
 * A cancelled dish is crossed out on the roll.
 *
 * Owner, with a screenshot of a word with a line through it: "i need to check
 * like strick throug in the cancelled item. esc/pos instruction i want to see".
 *
 * There is no ESC/POS instruction. The standard has bold, underline, reverse
 * video and character size, and that is the entire list of text effects. The
 * HTML ticket had `text-decoration: line-through` and never had to think about
 * it; when the ticket became bytes to get from 2,080 ms to 184 ms, that was the
 * one thing the fast path could not carry, and the heading took over the whole
 * job of saying a sheet was a cancellation.
 *
 * THE LINE IS DRAWN BY HAND. ESC 3 0 sets the line feed to zero dots, so the LF
 * after the text does not advance the paper and the next thing printed lands on
 * the same row. That next thing is a rule. ESC 2 puts the spacing back.
 *
 * Owner again, which is where the cheap version came from: "how about line
 * image on the text line or line text on the text ?" - both, and the text one
 * wins. Four ways were built and rendered at true dot pitch before choosing:
 *
 *   hyphens over the text             103 bytes   dashed, gaps at every cell
 *   a CP437 rule over the text        109 bytes   solid            <- this one
 *   the stroke alone as a raster      999 bytes   solid
 *   the whole line rasterised       1,737 bytes   solid
 *
 * Thirty-five times the bytes for the same picture, on the one print whose
 * whole complaint was that it was slow.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { renderKitchenTicket } = require(path.join(ROOT, 'src', 'escpos-kot.js'));
const preview = require(path.join(ROOT, 'src', 'escpos-preview.js'));

const TICKET = {
  title: 'Item Cancelled',
  number: 12,
  dateText: '14-09-2026 01:20 AM',
  tableNo: '6A',
  dineType: 'Dine-in',
  saleId: 'SB1D12-000038',
  items: [{ name: 'Barbeque - Full', quantity: 1 }],
};

const bytes = (over = {}, options = {}) =>
  renderKitchenTicket({ ...TICKET, ...over }, options);

/* ------------------------------------------------------- the bytes themselves */

test('a cancelled dish carries the overprint, and a live one does not', () => {
  const cancelled = bytes({ cancelled: true });
  const normal = bytes({ cancelled: false });

  /* ESC 3 0 - zero line feed - is the whole mechanism. Without it the rule
     lands on the next line and reads as a divider. */
  assert.ok(cancelled.includes(Buffer.from([0x1b, 0x33, 0x00])), 'no zero line feed');
  assert.ok(cancelled.includes(Buffer.from([0x1b, 0x32])), 'the line spacing is never put back');
  assert.ok(!normal.includes(Buffer.from([0x1b, 0x33, 0x00])),
    'a ticket that is not a cancellation is overprinting something');
});

test('the rule is the box-drawing character, not a hyphen', () => {
  /*
   * THE DETAIL THE WHOLE LOOK TURNS ON. A hyphen is drawn inside its own
   * 12-dot cell with space either side, so a row of them prints dashed and
   * reads as a dotted line rather than a deletion. 0xC4 in code page 437 joins
   * edge to edge, and sits at the middle of the cell.
   */
  const out = bytes({ cancelled: true });
  assert.ok(out.includes(Buffer.from([0x1b, 0x74, 0x00])), 'code page 437 is never selected');
  assert.ok(out.includes(Buffer.alloc(20, 0xc4)), 'the rule is not the box-drawing character');
  assert.ok(out.includes(Buffer.from([0x1b, 0x74, 0x10])),
    'the code page is left on 437, so every rupee sign after this is wrong');
});

test('the code page goes back straight after the rule', () => {
  /* Leaving the printer on 437 would corrupt the next receipt, not just this
     ticket: the page is printer state and survives the job. */
  const out = bytes({ cancelled: true });
  const to437 = out.indexOf(Buffer.from([0x1b, 0x74, 0x00]));
  const back = out.indexOf(Buffer.from([0x1b, 0x74, 0x10]), to437);
  assert.ok(to437 > -1 && back > to437, 'the code page is not restored after the rule');
  const between = out.slice(to437 + 3, back);
  assert.ok(between.every((b) => b === 0xc4), 'ordinary text is being printed in code page 437');
});

test('the rule is exactly as long as the line it crosses', () => {
  /* Shorter and the strike stops early; longer and it runs off into the
     margin. Both look like a fault rather than a cancellation. */
  const out = bytes({ cancelled: true });
  const to437 = out.indexOf(Buffer.from([0x1b, 0x74, 0x00]));
  const back = out.indexOf(Buffer.from([0x1b, 0x74, 0x10]), to437);
  assert.strictEqual(back - (to437 + 3), 48, '80mm is 48 columns, so the rule should be 48 wide');

  const narrow = renderKitchenTicket({ ...TICKET, cancelled: true }, { paperWidth: '32' });
  const n437 = narrow.indexOf(Buffer.from([0x1b, 0x74, 0x00]));
  const nBack = narrow.indexOf(Buffer.from([0x1b, 0x74, 0x10]), n437);
  assert.strictEqual(nBack - (n437 + 3), 32, 'a 58mm roll is 32 columns');
});

test('it stays cheap, which was the point of this path existing', () => {
  /*
   * The ticket became bytes to get off a 2,080 ms HTML-and-PDF round trip. A
   * strike-through that rasterised the line would put 1,737 bytes back per
   * cancelled dish. Sixty is the price of this one.
   */
  const cost = bytes({ cancelled: true }).length - bytes({ cancelled: false }).length;
  assert.ok(cost > 0 && cost < 200, 'the strike costs ' + cost + ' bytes, which is not a rule any more');
});

/* --------------------------------------------------------------- the escape */

test('a printer that will not overprint can be switched off the strike', () => {
  /*
   * Zero line feed is a hardware behaviour, not a guarantee. A printer that
   * advances anyway prints the rule on the NEXT line, where it reads as a
   * divider - so the shop needs a way out that is not a release.
   */
  const off = bytes({ cancelled: true }, { strikeCancelled: false });
  assert.ok(!off.includes(Buffer.from([0x1b, 0x33, 0x00])), 'the strike cannot be switched off');
  assert.ok(!off.includes(Buffer.alloc(8, 0xc4)));
});

test('absent means on, because that is what was asked for', () => {
  assert.ok(bytes({ cancelled: true }, {}).includes(Buffer.from([0x1b, 0x33, 0x00])));
  assert.ok(bytes({ cancelled: true }, { strikeCancelled: true }).includes(Buffer.from([0x1b, 0x33, 0x00])));
});

test('the till passes the shop setting and the cancelled flag through', () => {
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /cancelled: f\.isCancelled/, 'the ticket never learns it is a cancellation');
  assert.match(kot, /strikeCancelled: !\(this\.config && this\.config\.strikeCancelled === false\)/);
});

/* ------------------------------------------------------- reading it back out */

test('the paper can be read back, and says the line was crossed out', () => {
  /*
   * This is the half that makes the rest checkable. Without it, the only way
   * to know a change did what it says is to walk to a printer - and on the
   * night this was written, the printer was offline with a jammed queue.
   */
  const doc = preview.parse(bytes({ cancelled: true }), 48);
  const struck = preview.struckRows(doc);
  assert.strictEqual(struck.length, 1, 'expected exactly one struck line');
  assert.match(struck[0].text, /^BARBEQUE - FULL\s+x1$/);
  assert.strictEqual(struck[0].over, '─'.repeat(48), 'the cover is not a solid rule');
});

test('and says nothing was crossed out on a live ticket', () => {
  assert.deepStrictEqual(preview.struckRows(preview.parse(bytes({ cancelled: false }), 48)), []);
});

test('the rest of the ticket still reads as a ticket', () => {
  /* A strike that quietly ate the heading or the table number would pass every
     test above. */
  const lines = preview.asLines(preview.parse(bytes({ cancelled: true }), 48));
  assert.ok(lines.includes('Item Cancelled'), 'the heading is gone');
  assert.ok(lines.includes('#12'), 'the serial the pass shouts is gone');
  assert.ok(lines.includes('TABLE 6A'), 'the table is gone');
  assert.ok(lines.some((l) => l.startsWith('[over]')), 'nothing is marked as overprinted');
});

test('the preview reads the styling, not just the words', () => {
  const doc = preview.parse(bytes({ cancelled: true }), 48);
  const serial = doc.rows.find((r) => r.text === '#12');
  assert.strictEqual(serial.h, 3, 'the serial is no longer the biggest thing on the sheet');
  assert.strictEqual(serial.align, 1, 'the serial is not centred');
  const heading = doc.rows.find((r) => r.text === 'Item Cancelled');
  assert.strictEqual(heading.bold, true);
});

test('an unknown command shifts a row rather than corrupting the rest', () => {
  /*
   * Every command is skipped by its own documented length. Guessing one byte
   * wrong turns the next command into text and every row after it into
   * nonsense, which is the failure that makes a reader worse than useless.
   */
  const doc = preview.parse(Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x56, 0x00]),        // not a command we emit
    Buffer.from('STILL HERE\n', 'latin1'),
  ]), 48);
  assert.ok(preview.asLines(doc).includes('STILL HERE'));
});

test('the preview is in the packaged build', () => {
  /* build.files is an allowlist, and this one is required by a test today and
     by the Hardware Manager preview next. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/escpos-preview.js'));
});
