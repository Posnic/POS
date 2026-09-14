'use strict';

/*
 * A cancelled dish is crossed out on the roll.
 *
 * Owner, with a screenshot of a word with a line through it: "i need to check
 * like strick throug in the cancelled item. esc/pos instruction i want to see".
 *
 * There is no instruction. ESC/POS has bold, underline, reverse video and
 * character size, and that is the entire list of text effects. The HTML ticket
 * had `text-decoration: line-through` and never had to think about it; when the
 * ticket became bytes to get from 2,080 ms to 184 ms, that was the one thing
 * the fast path could not carry.
 *
 * FOUR WAYS WERE PRINTED ON HIS POS-80C BEFORE THIS ONE, and three of them are
 * cheaper. All three are wrong on the hardware:
 *
 *   A rule overprinted on the text, holding the paper still with ESC 3 0. 109
 *   bytes, and correct by the specification - the standard says a zero line
 *   feed does not advance. This printer advances anyway: "no. 2 line is in
 *   below text". Every overprint idea dies there, and only paper could say so.
 *   A version of it was merged and had to be taken back out.
 *
 *   Reverse video, GS B. Four bytes and perfectly crisp, but the printer
 *   applies it to the WHOLE line however the run is bracketed - tried for the
 *   full line and again for the dish name alone, and both came back "i see
 *   full black as background".
 *
 *   Underline, ESC - 2. Under the words, not through them.
 *
 * So the line is rasterised, at 1,736 bytes against 49 for text. Only a
 * cancelled dish pays it, and a cancellation is rare.
 *
 * THE SHAPE OF THE TYPE TOOK FOUR MORE ROUNDS, all of them on paper:
 *
 *   "text is small"                -> 17.5px is the em box, not the letter.
 *   "little strong but not big"    -> 28px matches the printer's cap height.
 *   "text without strong looks
 *    good"                         -> regular weight, not bold.
 *   "strick going from start to
 *    end x1. better strick only
 *    one text"                     -> the stroke stops at the words.
 *   "reduce line width little"     -> three dots thick, three below centre.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { renderKitchenTicket } = require(path.join(ROOT, 'src', 'escpos-kot.js'));
const raster = require(path.join(ROOT, 'src', 'escpos-raster-text.js'));
const preview = require(path.join(ROOT, 'src', 'escpos-preview.js'));

const TICKET = {
  title: 'Item Cancelled',
  number: 12,
  dateText: '14-09-2026 02:10 AM',
  tableNo: '6A',
  dineType: 'Dine-in',
  saleId: 'SB1D12-000038',
  items: [{ name: 'Barbeque - Full', quantity: 1 }],
};
const bytes = (over = {}, options = {}) => renderKitchenTicket({ ...TICKET, ...over }, options);

/** Dots set in one row of a raster body. */
function inkInRow(body, wBytes, y) {
  let n = 0;
  for (let i = 0; i < wBytes; i += 1) {
    for (let bit = 0; bit < 8; bit += 1) if (body[y * wBytes + i] & (1 << bit)) n += 1;
  }
  return n;
}

/* ------------------------------------------------------------- the baked face */

test('the font travels with the app, because the till cannot draw text', () => {
  /*
   * There is no canvas in the Electron main process, and rendering through a
   * hidden window is the 1,114 ms step this whole path exists to avoid. The
   * face is baked by scripts/build-escpos-font.ps1 and committed - which also
   * means a ticket looks the same in every shop instead of depending on which
   * fonts that Windows happens to have.
   */
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'escpos-font-a.json'), 'utf8'));
  assert.strictEqual(meta.cellWidth, 12, 'font A on an 80mm roll is a 12 dot cell');
  assert.strictEqual(meta.cellHeight, 24);
  assert.strictEqual(meta.encoding, 'windows-1252', 'the app selects this code page with ESC t 16');
  assert.strictEqual(meta.firstByte, 0x20);
  assert.strictEqual(meta.lastByte, 0xff);
  const glyphs = Buffer.from(meta.glyphs, 'base64');
  assert.strictEqual(glyphs.length, (0xff - 0x20 + 1) * 24 * 2, 'the table is not the size it claims');
  assert.ok(glyphs.some((b) => b !== 0), 'the table is blank');
});

test('the generator is committed beside what it generates', () => {
  /* CI cannot rebuild it - an Ubuntu runner has no Consolas - so the recipe has
     to be readable next to the result or nobody can ever change the type. */
  const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'build-escpos-font.ps1'), 'utf8');
  assert.match(gen, /\$FontPx = 28/, 'the size settled on paper is not what the generator uses');
  assert.match(gen, /\$Threshold = 640/);
  assert.match(gen, /FontStyle\]::Regular/, 'bold was tried and rejected on paper');
});

/* ----------------------------------------------------------------- the stroke */

test('the stroke is three dots thick and sits three below the middle', () => {
  assert.strictEqual(raster.STROKE_THICKNESS, 3);
  assert.strictEqual(raster.STROKE_DROP, 3);

  const line = 'BARBEQUE - FULL'.padEnd(46) + 'x1';
  const buf = raster.renderLine(line, { columns: 48 });
  const body = buf.slice(8);
  const wBytes = 72;

  /* 12 is the middle of a 24 dot cell, so the stroke owns 15, 16 and 17. */
  for (const y of [15, 16, 17]) {
    assert.ok(inkInRow(body, wBytes, y) >= 180, 'row ' + y + ' has no stroke');
  }
  /* And the rows either side are just letters. */
  assert.ok(inkInRow(body, wBytes, 14) < 120, 'the stroke is thicker than three dots');
  assert.ok(inkInRow(body, wBytes, 18) < 120);
});

test('the stroke stops at the words, not at the quantity', () => {
  /*
   * Owner, looking at a slip: "strick going from start to end x1. better
   * strick only one text". A line laid out by pair() is a dish name, a run of
   * spaces, then a count hard against the right edge, and a stroke that
   * reaches the count crosses out the count.
   */
  const line = 'BARBEQUE - FULL'.padEnd(46) + 'x1';
  const buf = raster.renderLine(line, { columns: 48 });
  const body = buf.slice(8);
  const wBytes = 72;
  const dot = (x) => (body[16 * wBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

  assert.ok(dot(0) && dot(179), 'the stroke does not cover the dish name');
  assert.ok(!dot(180), 'the stroke runs past the end of the words');
  assert.ok(!dot(560), 'the stroke reaches the quantity');
});

test('a single space inside a name does not end the stroke', () => {
  /*
   * THE TRAP. "BARBEQUE - FULL" has two single spaces in it. Stopping at the
   * first space strikes one word; stopping at the LAST run of two stops just
   * before the quantity, which is the whole line again. Both were written
   * before the first run of two was.
   */
  assert.strictEqual(raster.wordCells('BARBEQUE - FULL'.padEnd(46) + 'x1'), 15);
  assert.strictEqual(raster.wordCells('ICE TEA'.padEnd(46) + 'x1'), 7);
  /* Nothing to the right at all: the stroke runs to the end of the text. */
  assert.strictEqual(raster.wordCells('PLAIN DOSA'), 10);
  assert.strictEqual(raster.wordCells('PLAIN DOSA    '), 10, 'trailing space is not a word');
});

test('the stroke can be asked for explicitly, or not at all', () => {
  const line = 'ICE TEA'.padEnd(46) + 'x1';
  const withNone = raster.renderLine(line, { columns: 48, strike: false }).slice(8);
  assert.ok(inkInRow(withNone, 72, 16) < 60, 'a line asked not to be struck was struck');

  const wide = raster.renderLine(line, { columns: 48, strikeCells: 48 }).slice(8);
  const dot = (x) => (wide[16 * 72 + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  assert.ok(dot(570), 'strikeCells did not widen the stroke');
});

/* ------------------------------------------------------------------ the bitmap */

test('the raster is a well formed GS v 0 of the right size', () => {
  const buf = raster.renderLine('ICE TEA', { columns: 48 });
  assert.deepStrictEqual([...buf.slice(0, 4)], [0x1d, 0x76, 0x30, 0x00]);
  assert.strictEqual(buf[4] | (buf[5] << 8), 72, '80mm is 576 dots, so 72 bytes a row');
  assert.strictEqual(buf[6] | (buf[7] << 8), 24);
  assert.strictEqual(buf.length, 8 + 72 * 24);

  const narrow = raster.renderLine('ICE TEA', { columns: 32 });
  assert.strictEqual(narrow[4] | (narrow[5] << 8), 48, '58mm is 384 dots');
  assert.strictEqual(narrow.length, 8 + 48 * 24);
});

test('the letters are actually drawn, not just the stroke', () => {
  /* A table read with the wrong stride gives a page of nothing and every test
     above it still passes. */
  const body = raster.renderLine('ICE TEA', { columns: 48, strike: false }).slice(8);
  const above = [...Array(14).keys()].reduce((n, y) => n + inkInRow(body, 72, y), 0);
  assert.ok(above > 100, 'there is no type above the stroke line');
});

test('a character the table does not have is skipped, not drawn as rubbish', () => {
  assert.doesNotThrow(() => raster.renderLine('中文 TEA', { columns: 48 }));
});

test('a line longer than the paper is cut, not wrapped into the next row', () => {
  const buf = raster.renderLine('X'.repeat(200), { columns: 48 });
  assert.strictEqual(buf.length, 8 + 72 * 24, 'an overlong line grew the raster');
});

/* ------------------------------------------------------------------ the ticket */

test('a cancelled dish is rasterised and a live one is text', () => {
  const cancelled = preview.parse(bytes({ cancelled: true }), 48);
  const normal = preview.parse(bytes({ cancelled: false }), 48);

  assert.strictEqual(cancelled.rows.filter((r) => r.kind === 'raster').length, 1);
  assert.strictEqual(normal.rows.filter((r) => r.kind === 'raster').length, 0);
  assert.ok(preview.asLines(normal).some((l) => /^BARBEQUE - FULL\s+x1$/.test(l)),
    'a live dish should still be ordinary text');
});

test('none of the three approaches that failed on paper is still in the bytes', () => {
  /* Each of these was printed and rejected. A merge that quietly brought one
     back would look right in a diff and wrong on the roll. */
  const out = bytes({ cancelled: true });
  assert.ok(!out.includes(Buffer.from([0x1b, 0x33, 0x00])), 'zero line feed is back');
  assert.ok(!out.includes(Buffer.from([0x1d, 0x42, 0x01])), 'reverse video is back');
  assert.ok(!out.includes(Buffer.alloc(8, 0xc4)), 'the CP437 rule is back');
});

test('the rest of the ticket still reads as a ticket', () => {
  const lines = preview.asLines(preview.parse(bytes({ cancelled: true }), 48));
  assert.ok(lines.includes('Item Cancelled'), 'the heading is gone');
  assert.ok(lines.includes('#12'), 'the serial the pass shouts is gone');
  assert.ok(lines.includes('TABLE 6A'), 'the table is gone');
});

test('only the cancelled dish pays for it', () => {
  /*
   * The whole reason this path exists is speed. One raster is 1,736 bytes; a
   * new order, which is nearly every ticket, must not carry any.
   */
  const plain = bytes({ cancelled: false }).length;
  const struck = bytes({ cancelled: true }).length;
  assert.ok(struck - plain > 1500 && struck - plain < 1800, 'unexpected cost: ' + (struck - plain));
  assert.ok(plain < 800, 'a normal ticket has grown: ' + plain + ' bytes');
});

test('a printer that cannot take a raster can be switched back to plain', () => {
  const off = bytes({ cancelled: true }, { strikeCancelled: false });
  assert.strictEqual(preview.parse(off, 48).rows.filter((r) => r.kind === 'raster').length, 0);
});

test('absent means on, because that is what was asked for', () => {
  assert.strictEqual(preview.parse(bytes({ cancelled: true }, {}), 48)
    .rows.filter((r) => r.kind === 'raster').length, 1);
});

test('the till passes the shop setting and the cancelled flag through', () => {
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /cancelled: f\.isCancelled/, 'the ticket never learns it is a cancellation');
  assert.match(kot, /strikeCancelled: !\(this\.config && this\.config\.strikeCancelled === false\)/);
});

test('the receipt builder still has the methods a ticket needs', () => {
  /* Replacing strikeLine once took cut() and openDrawer() out with it, and the
     ticket threw at the very last line it builds. */
  const { Receipt } = require(path.join(ROOT, 'src', 'escpos-receipt.js'));
  const r = new Receipt('80');
  for (const method of ['cut', 'openDrawer', 'strikeLine', 'pair', 'rule', 'line', 'centre']) {
    assert.strictEqual(typeof r[method], 'function', method + ' is missing');
  }
});

test('both new files are in the packaged build', () => {
  /* build.files is an allowlist. A missing module throws "Cannot find module"
     on a customer's counter and nowhere else - and a missing font table would
     take the kitchen ticket down with it. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/escpos-raster-text.js'));
  assert.ok(pkg.build.files.includes('src/escpos-font-a.json'));
  assert.ok(pkg.build.files.includes('src/escpos-preview.js'));
});
