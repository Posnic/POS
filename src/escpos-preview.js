'use strict';

/*
 * ESC/POS bytes, read back.
 *
 * WHY THIS EXISTS
 *
 * The kitchen ticket and the receipt are built as bytes and sent to a roll, and
 * until now the only way to see what a change did to them was to print one. So
 * the questions that come up - did the cancelled line get crossed out, does the
 * table number still fit at double width, what does a 58mm roll do to a long
 * dish name - were answered by walking to a printer, and on a day when the
 * printer was off or its queue was jammed they were not answered at all.
 *
 * This turns a stream of bytes into an ordered list of rows with the styling
 * that was in force when each one printed. From there a test can assert on the
 * layout, and a screen can draw a picture of the paper.
 *
 * IT ONLY UNDERSTANDS WHAT THIS CODEBASE EMITS, deliberately. A general
 * emulator has to guess at a hundred vendor extensions and gets the important
 * ones no more right for it; escpos-receipt.js sends about ten commands, and
 * ten commands can be read exactly. Anything unrecognised is skipped by its own
 * documented length rather than guessed at, so an unknown command shifts the
 * layout rather than corrupting every row after it.
 */

const ESC = 0x1b;
const GS = 0x1d;

/*
 * Code page 437 carries the box-drawing characters, and one of them is how a
 * cancelled line is struck through (see Receipt.strikeLine). Mapped back here
 * so the row reads as the line it prints as, not as the accented letter the
 * same byte means in WPC1252.
 */
const CP437 = { 0xc4: '─', 0xcd: '═', 0xb3: '│' };

/**
 * @param {Buffer} buf    what would go to the printer
 * @param {number} columns 48 for 80mm, 32 for 58mm
 * @returns {{columns: number, rows: Array<object>}}
 */
function parse(buf, columns = 48) {
  const rows = [];
  let i = 0;

  const style = { align: 0, bold: false, underline: 0, reverse: false, w: 1, h: 1 };
  let codepage = 16;
  /*
   * ESC 3 0 sets the line feed to zero dots, so the LF that follows does not
   * advance the paper and whatever prints next lands on the SAME row. That is
   * what a strike-through is made of, and reading it back is the only way a
   * test can tell a line that was crossed out from one with a rule under it.
   */
  let spacing = -1;
  let overlayNext = false;
  let line = '';
  let flushed = false;

  const flush = (force = false) => {
    if (line === '' && !force) return;
    /* A style change already ended this row; the newline that follows must not
       add an empty one under it. */
    if (line === '' && force && flushed) { flushed = false; return; }
    rows.push({ kind: 'text', text: line, ...style, overlay: overlayNext });
    line = '';
    flushed = true;
    overlayNext = false;
  };

  while (i < buf.length) {
    const b = buf[i];

    if (b === ESC) {
      const fn = buf[i + 1];
      if (fn === 0x40) { i += 2; continue; }                                   // initialise
      if (fn === 0x74) { flush(); codepage = buf[i + 2]; i += 3; continue; }   // code page
      if (fn === 0x61) { flush(); style.align = buf[i + 2]; i += 3; continue; }
      if (fn === 0x45) { flush(); style.bold = buf[i + 2] !== 0; i += 3; continue; }
      if (fn === 0x2d) { flush(); style.underline = buf[i + 2]; i += 3; continue; }
      if (fn === 0x33) { flush(); spacing = buf[i + 2]; i += 3; continue; }    // ESC 3 n
      if (fn === 0x32) { flush(); spacing = -1; i += 2; continue; }            // ESC 2
      if (fn === 0x4a) { flush(); i += 3; continue; }                          // ESC J n
      if (fn === 0x64) {                                                       // feed n lines
        flush();
        for (let n = 0; n < buf[i + 2]; n += 1) rows.push({ kind: 'blank' });
        i += 3; continue;
      }
      if (fn === 0x70) { i += 5; continue; }                                   // drawer
      if (fn === 0x7b) { i += 3; continue; }                                   // upside down
      i += 2; continue;
    }

    if (b === GS) {
      const fn = buf[i + 1];
      if (fn === 0x21) {                                                       // character size
        flush();
        const n = buf[i + 2];
        style.w = ((n >> 4) & 7) + 1;
        style.h = (n & 7) + 1;
        i += 3; continue;
      }
      if (fn === 0x42) { flush(); style.reverse = buf[i + 2] !== 0; i += 3; continue; }
      if (fn === 0x56) { flush(); rows.push({ kind: 'cut' }); i += 4; continue; }
      if (fn === 0x76 && buf[i + 2] === 0x30) {                                // GS v 0, raster
        flush();
        const wBytes = buf[i + 4] | (buf[i + 5] << 8);
        const h = buf[i + 6] | (buf[i + 7] << 8);
        const start = i + 8;
        rows.push({
          kind: 'raster',
          wBytes,
          h,
          /* m: 1 and 3 are double width, 2 and 3 double height. A struck line
             travels at half width and the printer doubles it; a preview that
             ignores this draws it half as wide as it prints. */
          scale: buf[i + 3] & 0x03,
          data: buf.slice(start, start + wBytes * h).toString('base64'),
          overlay: overlayNext,
        });
        overlayNext = false;
        i = start + wBytes * h; continue;
      }
      i += 3; continue;
    }

    if (b === 0x0a) {
      flush(true);
      flushed = false;
      if (spacing === 0) overlayNext = true;
      i += 1; continue;
    }
    if (b < 0x20) { i += 1; continue; }

    line += (codepage === 0 && CP437[b]) ? CP437[b] : String.fromCharCode(b);
    i += 1;
  }
  flush();
  return { columns, rows };
}

/**
 * The paper as plain text, one row per line, for a test that wants to read the
 * layout rather than assert on bytes. An overprinted row is marked, because
 * "BARBEQUE" and a rule over "BARBEQUE" are the same characters otherwise.
 */
function asLines(doc) {
  return doc.rows.map((r) => {
    if (r.kind === 'blank') return '';
    if (r.kind === 'cut') return '--- cut ---';
    if (r.kind === 'raster') return `[raster ${r.wBytes * 8}x${r.h}]`;
    return r.overlay ? `[over] ${r.text}` : r.text;
  });
}

/** Every row that had something printed over it, paired with what covered it. */
function struckRows(doc) {
  const out = [];
  doc.rows.forEach((row, n) => {
    if (!row.overlay || n === 0) return;
    const under = doc.rows[n - 1];
    if (under && under.kind === 'text') out.push({ text: under.text, over: row.text || '' });
  });
  return out;
}

module.exports = { parse, asLines, struckRows, CP437 };
