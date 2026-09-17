'use strict';

/*
 * A line of text drawn as dots, so something can be drawn THROUGH it.
 *
 * WHY THIS EXISTS AT ALL
 *
 * ESC/POS has no strike-through. Bold, underline, reverse video, character
 * size: that is the entire list of text effects, and none of them puts a line
 * across the words. The HTML kitchen ticket had `text-decoration: line-through`
 * and never had to think about it; the byte path, which is what made a ticket
 * 184 ms instead of 2,080 ms, could not carry it.
 *
 * Four ways were tried on real paper before this one. Three are cheaper and all
 * three are wrong on the hardware:
 *
 *   a rule overprinted on the text, using ESC 3 0 to hold the paper still.
 *   109 bytes, and the right answer by the specification - the standard says a
 *   zero line feed does not advance. The owner's POS-80C advances anyway and
 *   prints the rule on the next line: "no. 2 line is in below text". Every
 *   overprint trick dies on that, and only paper could say so.
 *
 *   reverse video, GS B. Four bytes, crisp, and the printer applies it to the
 *   WHOLE line however the run is bracketed: "i see full black as background",
 *   for a dish name and again for a name-only attempt. All or nothing.
 *
 *   underline, ESC - 2. Under the words, not through them.
 *
 * So the line is rasterised. It costs 1,736 bytes against 49 for text, which is
 * only spent on a cancelled dish, and a cancellation is rare - a new order,
 * which is nearly every ticket, is untouched.
 *
 * WHY THE GLYPHS COME OUT OF A TABLE
 *
 * The till cannot render text. There is no canvas in the Electron main process
 * and a hidden window is the 1,114 ms step this path exists to avoid. So the
 * face is baked into src/escpos-font-a.json by scripts/build-escpos-font.ps1
 * and shipped with the app, which also means a ticket looks the same in every
 * shop rather than depending on that machine's fonts.
 *
 * THE SHAPE OF THE TYPE WAS SETTLED ON PAPER, over four rounds:
 *
 *   "text is small"          - 17.5px is the em box, not the letter. 28px
 *                              matches the printer's own cap height.
 *   "little strong"          - bold was tried and dropped: "text without
 *                              strong looks good".
 *   "strick going from
 *    start to end x1"        - the stroke stops at the words now, not at the
 *                              quantity.
 *   "reduce line width"      - three dots, sitting three below the middle.
 */

const fs = require('fs');
const path = require('path');

const CELL_W = 12;
const CELL_H = 24;

/*
 * How the stroke sits. Every one of these came off a printed slip rather than
 * a screen, and changing one means printing again - see the header.
 */
const STROKE_THICKNESS = 3;   // dots
const STROKE_DROP = 3;        // dots below the middle of the cell

let _font = null;

/*
 * WHERE THE INK IS.
 *
 * A 24-dot cell leaves room above the cap height and below the baseline that
 * no printable glyph in the table actually uses. Sending those rows costs the
 * same as sending letters, and on a cancelled line every row is paid for
 * twice - once to draw and once over twenty metres of cable to the kitchen.
 *
 * Measured rather than assumed, so a re-baked font with a taller face moves
 * this on its own. The stroke rows are folded in, in case a face ever sat
 * above them. inkBand is the envelope of the whole table; renderLine uses
 * lineBand, the rows of the characters actually on the line.
 */
function inkBand(f) {
  let every = '';
  for (let code = f.first; code <= f.last; code += 1) every += String.fromCharCode(code);
  return lineBand(f, every);
}

/** The rows this particular text inks, plus the stroke rows. */
function lineBand(f, chars) {
  let top = f.cellH;
  let bottom = -1;
  for (let i = 0; i < chars.length; i += 1) {
    const code = chars.charCodeAt(i);
    if (code < f.first || code > f.last) continue;
    const at = (code - f.first) * f.cellH * 2;
    for (let y = 0; y < f.cellH; y += 1) {
      if (f.glyphs[at + y * 2] || f.glyphs[at + y * 2 + 1]) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const strokeTop = Math.floor(f.cellH / 2) + STROKE_DROP;
  const strokeBottom = Math.min(f.cellH - 1, strokeTop + STROKE_THICKNESS - 1);
  if (bottom < 0) return { top: strokeTop, bottom: strokeBottom };
  return { top: Math.min(top, strokeTop), bottom: Math.max(bottom, strokeBottom) };
}

/** The baked table, read once. */
function font() {
  if (_font) return _font;
  const file = path.join(__dirname, 'escpos-font-a.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  _font = {
    first: meta.firstByte,
    last: meta.lastByte,
    cellW: meta.cellWidth,
    cellH: meta.cellHeight,
    glyphs: Buffer.from(meta.glyphs, 'base64'),
  };
  if (_font.cellW !== CELL_W || _font.cellH !== CELL_H) {
    throw new Error(`escpos-font-a.json is ${_font.cellW}x${_font.cellH}, expected ${CELL_W}x${CELL_H}`);
  }
  _font.band = inkBand(_font);
  return _font;
}

/*
 * Where the stroke stops.
 *
 * A line laid out by Receipt.pair is a dish name, a run of spaces, then a
 * quantity hard against the right edge. A stroke that runs the whole width
 * crosses out the count as well as the dish - the owner, looking at exactly
 * that: "strick going from start to end x1. better strick only one text".
 *
 * The FIRST run of two or more spaces is that gap. One space is not enough:
 * "BARBEQUE - FULL" has two of them inside the name, and stopping at the first
 * would strike one word. Taking the LAST run instead stops just before the
 * quantity, which is the whole line again - both were tried.
 */
function wordCells(text) {
  const trimmed = String(text).replace(/\s+$/, '');
  const gap = trimmed.indexOf('  ');
  return gap > 0 ? gap : trimmed.length;
}

/**
 * One line as a GS v 0 raster.
 *
 * @param {string} text     already laid out and already the paper's width
 * @param {object} opts
 *   columns  48 for 80mm, 32 for 58mm
 *   strike   draw the stroke (the only reason to be here, but tested both ways)
 *   strikeCells  how far the stroke runs; default is where the words stop
 * @returns {Buffer} the command and its bitmap, ready to send
 */
function renderLine(text, { columns = 48, strike = true, strikeCells } = {}) {
  const f = font();

  /*
   * ONLY WHAT IS THERE, ONLY THE ROWS WITH INK, AT HALF WIDTH.
   *
   * Owner, with a 20-metre run to the kitchen printer: "i dont want this delay.
   * i want same as new order." A struck line used to cost 1,736 bytes however
   * short the dish name - the whole 48-column, 24-row grid, blank cells and
   * blank rows priced the same as letters. Three cuts, each proven on his
   * printer and the last one chosen by him off the paper:
   *
   *   trailing padding is not sent          a 13-letter dish is 13 cells wide
   *   rows above and below the ink are not  uppercase inks 18 of 24 rows
   *   HALF THE COLUMNS are sent and the printer doubles them (GS v 0, m = 1)
   *
   * "SUNSET COOLER" went from 1,736 bytes to 198 on the paper he compared,
   * and to 188 once the rows were measured per line. He printed the
   * full-width, full-resolution and half-width versions side by side and
   * picked the half-width one: "B is good. A also fine but not better than b."
   *
   * Half width ORs each pair of source columns, so a one-dot stem still
   * prints rather than vanishing on an odd column. Overprinting was ruled out
   * first - this firmware enforces a minimum line advance, tested with every
   * feed value and both feed commands, all of which put the rule underneath.
   */
  const chars = String(text).slice(0, columns).trimEnd();
  const cells = chars.length;
  if (!cells) return Buffer.alloc(0);

  /*
   * The band is measured from THIS line's characters, not from the whole
   * table. The table's envelope is rows 1-23 because an accented capital
   * reaches row 1; an uppercase dish name inks rows 5-23. Sending the
   * envelope for every line would cost four blank rows on nearly all of them,
   * and clipping to the common case would cut the top off "Creme" the day a
   * shop types it with an accent. So each line pays for exactly its own ink.
   */
  const { top, bottom } = lineBand(f, chars);
  const rows = bottom - top + 1;

  const srcDots = cells * CELL_W;
  const outDots = Math.ceil(srcDots / 2);
  const wBytes = Math.ceil(outDots / 8);
  const bmp = Buffer.alloc(wBytes * rows, 0);

  /* Glyphs first, at half width: output column ox is source columns 2ox and
     2ox+1, either of which inked. */
  const srcRow = (i, y) => {
    const code = chars.charCodeAt(i);
    if (code < f.first || code > f.last) return 0;
    const at = (code - f.first) * f.cellH * 2;
    return (f.glyphs[at + y * 2] << 8) | f.glyphs[at + y * 2 + 1];
  };
  for (let y = 0; y < rows; y += 1) {
    const sy = y + top;
    for (let ox = 0; ox < outDots; ox += 1) {
      const sx = ox * 2;
      const a = srcRow(Math.floor(sx / CELL_W), sy) & (0x8000 >> (sx % CELL_W));
      const sx2 = sx + 1;
      const b =
        sx2 < srcDots ? srcRow(Math.floor(sx2 / CELL_W), sy) & (0x8000 >> (sx2 % CELL_W)) : 0;
      if (a || b) bmp[y * wBytes + (ox >> 3)] |= 0x80 >> (ox & 7);
    }
  }

  /* Then the stroke, over the top, which is the whole point of the exercise. */
  if (strike) {
    const strokeCellCount = Math.min(
      cells,
      strikeCells === undefined ? wordCells(chars) : Math.max(0, strikeCells)
    );
    const endDots = Math.ceil((strokeCellCount * CELL_W) / 2);
    const strokeTop = Math.floor(CELL_H / 2) + STROKE_DROP;
    for (let sy = strokeTop; sy < Math.min(CELL_H, strokeTop + STROKE_THICKNESS); sy += 1) {
      const y = sy - top;
      if (y < 0 || y >= rows) continue;
      for (let ox = 0; ox < endDots; ox += 1) {
        bmp[y * wBytes + (ox >> 3)] |= 0x80 >> (ox & 7);
      }
    }
  }

  /* GS v 0 m xL xH yL yH: m = 1 is double width, so the printer restores the
     columns this halved. */
  return Buffer.concat([
    Buffer.from([0x1d, 0x76, 0x30, 0x01, wBytes & 0xff, (wBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]),
    bmp,
  ]);
}

/**
 * The rows that carry ink: of this text when given, of the whole table when
 * not. What renderLine crops to, for anything that wants to check.
 */
function band(text) {
  const f = font();
  if (text === undefined) return { ...f.band };
  return lineBand(f, String(text).trimEnd());
}

module.exports = { renderLine, wordCells, band, CELL_W, CELL_H, STROKE_THICKNESS, STROKE_DROP };
