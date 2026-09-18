'use strict';

/*
 * WHICH CODE PAGE DOES THIS PRINTER ACTUALLY HAVE?
 *
 * escpos-receipt.js sends `ESC t 16` and then byte 0x80 for a euro sign,
 * because 16 is WPC1252 in Epson's table and 0x80 is the euro there. On a real
 * POS-80C that came out as "C" with a cedilla, which is 0x80 in PC437 - the
 * printer's own default. So it either does not implement `ESC t`, or numbers
 * its pages differently, and a comment in the source asserting otherwise is
 * worth nothing next to a strip of paper.
 *
 * This prints one line per candidate page: the page number, then the bytes
 * that carry a euro in the pages that have one. Read the paper and look for
 * the line where a euro appears.
 *
 *   npx electron tests/tools/which-code-page-does-this-printer-have.js \
 *     --printer "POS-80C"
 *
 * Deliberately a tool and not a test. No assertion can read a roll of paper.
 */

const path = require('path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const at = argv.indexOf('--' + n);
  return at > -1 && argv[at + 1] ? argv[at + 1] : d;
};
const PRINTER = argOf('printer', 'POS-80C');

const ESC = 0x1b;
const GS = 0x1d;

/*
 * The pages worth asking about, and why.
 *
 *   0   PC437       the default on nearly every clone. No euro at all.
 *   2   PC850       western europe, no euro.
 *  16   WPC1252     Epson's number for it. Euro at 0x80.
 *  19   PC858       PC850 plus a euro, at 0xD5. The usual answer on clones.
 *  32   ISO8859-15  latin-9, euro at 0xA4. Some firmware numbers it here.
 *  47   WPC1252     a second number some clones use for the same page.
 *
 * Plus a sweep, because a clone's table is whatever its firmware author had
 * that afternoon and guessing from a datasheet is how this went wrong.
 */
const CANDIDATES = [0, 2, 16, 17, 18, 19, 20, 21, 22, 23, 29, 30, 31, 32, 33, 34, 40, 47];

/* The three places a euro lives across those pages. */
const EURO_BYTES = [0x80, 0xd5, 0xa4];

function strip() {
  const out = [];
  const raw = (...b) => out.push(Buffer.from(b));
  const text = (s) => out.push(Buffer.from(s, 'latin1'));
  const line = (s) => {
    text(s);
    raw(0x0a);
  };

  raw(ESC, 0x40);
  raw(ESC, 0x61, 1);
  raw(GS, 0x21, 0x11);
  line('CODE PAGE');
  raw(GS, 0x21, 0x00);
  line('which one has a euro?');
  raw(ESC, 0x61, 0);
  line('-'.repeat(48));
  line('page   0x80  0xD5  0xA4');
  line('-'.repeat(48));

  for (const page of CANDIDATES) {
    raw(ESC, 0x74, page);
    text(String(page).padStart(4) + '   ');
    for (const b of EURO_BYTES) {
      raw(b);
      text('     ');
    }
    raw(0x0a);
  }

  /* Back to the default so the next receipt is not left on page 47. */
  raw(ESC, 0x74, 0);
  line('-'.repeat(48));
  line('Read down the three columns.');
  line('The row showing a euro names the page');
  line('this printer wants.');
  raw(ESC, 0x64, 3);
  raw(GS, 0x56, 66, 0);

  return Buffer.concat(out);
}

app.whenReady().then(async () => {
  const bytes = strip();
  console.log('\nWHICH CODE PAGE DOES THIS PRINTER HAVE\n');
  console.log('  ' + CANDIDATES.length + ' pages, ' + bytes.length + ' bytes');
  console.log('  printer: ' + PRINTER);

  const { HardwareManager } = require(path.join(ROOT, 'src', 'hardware-manager'));
  const said = await new HardwareManager().sendRawToPrinter(PRINTER, bytes, 'Posnic code page probe');
  console.log('  ' + JSON.stringify(said));
  console.log(said.success ? '\n  SENT - read the paper\n' : '\n  NOT SENT\n');
  app.exit(said.success ? 0 : 1);
});
