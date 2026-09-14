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
  const dots = columns * CELL_W;
  const wBytes = Math.ceil(dots / 8);
  const bmp = Buffer.alloc(wBytes * CELL_H, 0);
  const chars = String(text).slice(0, columns);

  /* Glyphs first. Each one is 12 bits a row in the table, in the same bit
     order the raster wants, so this is a shift rather than a redraw. */
  for (let i = 0; i < chars.length; i += 1) {
    const code = chars.charCodeAt(i);
    if (code < f.first || code > f.last) continue;
    const at = (code - f.first) * f.cellH * 2;
    const left = i * CELL_W;
    for (let y = 0; y < CELL_H; y += 1) {
      const row = (f.glyphs[at + y * 2] << 8) | f.glyphs[at + y * 2 + 1];
      if (!row) continue;
      for (let x = 0; x < CELL_W; x += 1) {
        if (!(row & (0x8000 >> x))) continue;
        const dot = left + x;
        bmp[y * wBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
      }
    }
  }

  /* Then the stroke, over the top, which is the whole point of the exercise. */
  if (strike) {
    const cells = Math.min(
      columns,
      strikeCells === undefined ? wordCells(chars) : Math.max(0, strikeCells)
    );
    const end = cells * CELL_W;
    const top = Math.floor(CELL_H / 2) + STROKE_DROP;
    for (let y = top; y < Math.min(CELL_H, top + STROKE_THICKNESS); y += 1) {
      for (let dot = 0; dot < end; dot += 1) {
        bmp[y * wBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
      }
    }
  }

  return Buffer.concat([
    Buffer.from([0x1d, 0x76, 0x30, 0x00, wBytes & 0xff, (wBytes >> 8) & 0xff, CELL_H & 0xff, (CELL_H >> 8) & 0xff]),
    bmp,
  ]);
}

module.exports = { renderLine, wordCells, CELL_W, CELL_H, STROKE_THICKNESS, STROKE_DROP };
