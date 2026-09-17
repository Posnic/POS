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
 * So the line is rasterised. At first that cost 1,736 bytes against 49 for
 * text - the whole 48-column, 24-row grid, blank cells priced the same as
 * letters. With twenty metres of cable to the kitchen printer that was a wait
 * he could see: "new order print is so so fast. very immediate but cancel
 * order took some time." Three cuts, each printed on his POS-80C and the last
 * chosen off the paper ("B is good"), brought a 13-letter dish under 200
 * bytes: only the cells with text, only the rows with ink, and half the
 * columns with the printer doubling them back (GS v 0, m = 1).
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

/*
 * A struck line as pair() composes it: the name, TWO spaces, the count.
 * Cells 0-14 are the words, 15-16 the gap, 17-18 the count. The raster goes
 * at half width, so source dot x lands in output column x / 2: the words end
 * at column 89, the gap is 90-101, the count starts at 102.
 */
const LINE = 'BARBEQUE - FULL  x1';
const parsed = (buf) => ({
  m: buf[3],
  wBytes: buf[4] | (buf[5] << 8),
  h: buf[6] | (buf[7] << 8),
  body: buf.slice(8),
});
const dotAt = (buf, x, y) => {
  const { wBytes, body } = parsed(buf);
  return (body[y * wBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
};
/** The output row a cell row lands on once the blank rows above are cropped. */
const rowOf = (text, cellRow) => cellRow - raster.band(text).top;

test('the stroke is three dots thick and sits three below the middle', () => {
  assert.strictEqual(raster.STROKE_THICKNESS, 3);
  assert.strictEqual(raster.STROKE_DROP, 3);

  const { wBytes, body } = parsed(raster.renderLine(LINE, { columns: 48 }));
  /* 12 is the middle of a 24 dot cell, so the stroke owns 15, 16 and 17. */
  const [top, mid, bottom] = [15, 16, 17].map((r) => rowOf(LINE, r));
  for (const y of [top, mid, bottom]) {
    assert.ok(inkInRow(body, wBytes, y) >= 90, 'row ' + y + ' has no stroke');
  }
  /* And the rows either side are just letters. */
  assert.ok(inkInRow(body, wBytes, top - 1) < 60, 'the stroke is thicker than three dots');
  assert.ok(inkInRow(body, wBytes, bottom + 1) < 60);
});

test('the stroke stops at the words, not at the quantity', () => {
  /*
   * Owner, looking at a slip: "strick going from start to end x1. better
   * strick only one text". The stroke covers the words and stops in the gap.
   * The gap columns are the proof; the count has ink of its own.
   */
  const buf = raster.renderLine(LINE, { columns: 48 });
  const y = rowOf(LINE, 16);
  assert.ok(dotAt(buf, 0, y) && dotAt(buf, 89, y), 'the stroke does not cover the dish name');
  for (let x = 90; x < 102; x += 1) {
    assert.ok(!dotAt(buf, x, y), 'the stroke runs into the gap at column ' + x);
  }
});

test('a single space inside a name does not end the stroke', () => {
  /*
   * THE TRAP. "BARBEQUE - FULL" has two single spaces in it. Stopping at the
   * first space strikes one word; stopping at the LAST run of two stops just
   * before the quantity, which is the whole line again. Both were written
   * before the first run of two was.
   */
  assert.strictEqual(raster.wordCells(LINE), 15);
  assert.strictEqual(raster.wordCells('BARBEQUE - FULL'.padEnd(46) + 'x1'), 15);
  assert.strictEqual(raster.wordCells('ICE TEA  x1'), 7);
  /* Nothing to the right at all: the stroke runs to the end of the text. */
  assert.strictEqual(raster.wordCells('PLAIN DOSA'), 10);
  assert.strictEqual(raster.wordCells('PLAIN DOSA    '), 10, 'trailing space is not a word');
});

test('the stroke can be asked for explicitly, or not at all', () => {
  const line = 'ICE TEA  x1';
  const y = rowOf(line, 16);
  const { wBytes, body } = parsed(raster.renderLine(line, { columns: 48, strike: false }));
  assert.ok(inkInRow(body, wBytes, y) < 30, 'a line asked not to be struck was struck');

  /* 'ICE TEA' is 7 cells, so the gap is output columns 42-53. */
  assert.ok(!dotAt(raster.renderLine(line, { columns: 48 }), 48, y));
  assert.ok(dotAt(raster.renderLine(line, { columns: 48, strikeCells: 48 }), 48, y),
    'strikeCells did not widen the stroke');
});

/* ------------------------------------------------------------------ the bitmap */

test('the raster is a well formed GS v 0, and the printer doubles its width', () => {
  /*
   * m = 1 is double width. The bitmap carries half the columns and the
   * printer restores them: the largest of the three cuts, and the one he
   * chose off the paper. A parser that ignores m draws the line half as wide
   * as it prints.
   */
  const buf = raster.renderLine('ICE TEA', { columns: 48 });
  assert.deepStrictEqual([...buf.slice(0, 4)], [0x1d, 0x76, 0x30, 0x01]);
  const { wBytes, h } = parsed(buf);
  assert.strictEqual(wBytes, 6, '7 cells of 12 dots, halved, is 42 dots: 6 bytes a row');
  const band = raster.band('ICE TEA');
  assert.strictEqual(h, band.bottom - band.top + 1);
  assert.strictEqual(buf.length, 8 + wBytes * h);
  assert.strictEqual(preview.parse(buf, 48).rows[0].scale, 1, 'the preview does not carry m');
});

test('only the cells with text are sent', () => {
  /* Padding a count out to the right edge would raster thirty blank cells to
     carry one digit. The paper width plays no part in what a line costs. */
  const wide = raster.renderLine('ICE TEA', { columns: 48 });
  assert.strictEqual(raster.renderLine('ICE TEA', { columns: 32 }).length, wide.length);
  assert.strictEqual(raster.renderLine('ICE TEA      ', { columns: 48 }).length, wide.length,
    'trailing spaces were rasterised');
  assert.strictEqual(raster.renderLine('        ', { columns: 48 }).length, 0, 'a blank line was rasterised');
});

test('only the rows with ink are sent, measured from this line', () => {
  /*
   * The table's envelope reaches row 1, for an accented capital; an uppercase
   * dish name inks rows 6-23. Sending the envelope would cost blank rows on
   * nearly every line, and clipping to the common case would cut the top off
   * "Crème" the day a shop types it with the accent. So each line pays for
   * exactly its own ink.
   */
  const plain = raster.band('SUNSET COOLER');
  const accented = raster.band('Crème Brûlée');
  assert.ok(plain.top > 0, 'blank rows above the type are being sent');
  assert.ok(accented.top < plain.top, 'an accent above the cap height was cropped off');
  assert.strictEqual(plain.bottom, raster.CELL_H - 1);
  assert.strictEqual(parsed(raster.renderLine('Crème Brûlée', { columns: 48 })).h,
    accented.bottom - accented.top + 1);
  assert.ok(raster.band().top <= accented.top, 'the table envelope is narrower than a line in it');
});

test('a one dot stem survives the halving', () => {
  /*
   * Half width ORs each pair of source columns. Sampling every other column
   * instead would drop any stem that sits on an odd one, and the letters
   * would print with pieces missing. Checked dot for dot against the table.
   */
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'escpos-font-a.json'), 'utf8'));
  const glyphs = Buffer.from(meta.glyphs, 'base64');
  const text = 'ICE TEA';
  const srcDot = (x, y) => {
    const code = text.charCodeAt(Math.floor(x / 12)) - meta.firstByte;
    const byte = glyphs[code * 48 + y * 2 + ((x % 12) >> 3)];
    return (byte & (0x80 >> ((x % 12) & 7))) !== 0;
  };
  const buf = raster.renderLine(text, { columns: 48, strike: false });
  const { top } = raster.band(text);
  const { wBytes, h } = parsed(buf);
  let oneDotWide = 0;
  for (let y = 0; y < h; y += 1) {
    for (let ox = 0; ox < wBytes * 8; ox += 1) {
      const a = 2 * ox < text.length * 12 && srcDot(2 * ox, y + top);
      const b = 2 * ox + 1 < text.length * 12 && srcDot(2 * ox + 1, y + top);
      assert.strictEqual(dotAt(buf, ox, y), a || b, 'column ' + ox + ' row ' + y);
      if (a !== b) oneDotWide += 1;
    }
  }
  assert.ok(oneDotWide > 0, 'nothing in ICE TEA is one dot wide, so this proves nothing');
});

test('the letters are actually drawn, not just the stroke', () => {
  /* A table read with the wrong stride gives a page of nothing and every test
     above it still passes. */
  const { wBytes, h, body } = parsed(raster.renderLine('ICE TEA', { columns: 48, strike: false }));
  const all = [...Array(h).keys()].reduce((n, y) => n + inkInRow(body, wBytes, y), 0);
  assert.ok(all > 100, 'there is no type in the raster');
});

test('a character the table does not have is skipped, not drawn as rubbish', () => {
  assert.doesNotThrow(() => raster.renderLine('中文 TEA', { columns: 48 }));
});

test('a line longer than the paper is cut, not wrapped into the next row', () => {
  const buf = raster.renderLine('X'.repeat(200), { columns: 48 });
  assert.strictEqual(parsed(buf).wBytes, 36, '48 cells of 12 dots, halved, is 288 dots');
  assert.strictEqual(buf.length, raster.renderLine('X'.repeat(48), { columns: 48 }).length);
});

test('a struck line costs what it draws, and the whole grid never comes back', () => {
  /*
   * Owner: "kitche and desktop aroudn 20 meter. data transfer is matters."
   * 1,736 was the price of every struck line before, whatever the dish. It is
   * the number a regression lands on, so it is the number this test refuses.
   */
  const cost = (t) => raster.renderLine(t, { columns: 48 }).length;
  assert.ok(cost('SUNSET COOLER') < 200, 'SUNSET COOLER costs ' + cost('SUNSET COOLER'));
  assert.ok(cost('SUNSET COOLER  2') < 240, 'with its count: ' + cost('SUNSET COOLER  2'));
  assert.ok(cost('MIXED TANDOORI SEA FOOD PLATTER  1') < 500);
  assert.ok(cost('X'.repeat(48)) < 700, 'even a full line is under half the old price');
});

test('a struck pair is composed as the name, two spaces and the count', () => {
  /*
   * pair() pads a live line out to the right edge. A struck one is drawn as
   * dots and paid for by the column, so it is composed tight, and the two
   * spaces are what wordCells reads as the end of the words.
   */
  const { Receipt } = require(path.join(ROOT, 'src', 'escpos-receipt.js'));
  const r = new Receipt('80');
  r.pair('SUNSET COOLER', 'x2', { strike: true });
  const row = preview.parse(r.build(), 48).rows.find((x) => x.kind === 'raster');
  assert.strictEqual(row.wBytes, Math.ceil(('SUNSET COOLER  x2'.length * 12) / 2 / 8));
  assert.strictEqual(row.scale, 1);
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
   * The whole reason this path exists is speed. A struck dish is a few
   * hundred bytes; a new order, which is nearly every ticket, must not carry
   * any of them.
   */
  const plain = bytes({ cancelled: false }).length;
  const struck = bytes({ cancelled: true }).length;
  assert.ok(struck - plain > 100 && struck - plain < 400, 'unexpected cost: ' + (struck - plain));
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
