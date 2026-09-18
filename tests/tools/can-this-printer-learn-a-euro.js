'use strict';

/*
 * CAN THIS PRINTER LEARN A CHARACTER IT DOES NOT HAVE?
 *
 * The euro prints as "EUR" because this printer's font has no euro in it and
 * it ignores `ESC t`, the command to change fonts. That is settled: eighteen
 * code pages, every row identical.
 *
 * But a thermal printer draws dots, and ESC/POS has a command for exactly this
 * problem. `ESC & ` DOWNLOADS a glyph into a character slot and `ESC % 1`
 * switches the user-defined set on, after which that slot prints your bitmap
 * as an ordinary character - one column wide, so nothing about the column
 * arithmetic changes. It is how a printer is taught a symbol its ROM lacks.
 *
 * Whether THIS printer implements it is a separate question from `ESC t`, and
 * the only way to find out is to send it and look at the paper.
 *
 *   npx electron tests/tools/can-this-printer-learn-a-euro.js --printer "POS-80C"
 *
 * Read the paper:
 *   line 2 shows a euro  -> it works, and amounts can carry the symbol
 *   line 2 shows a grave -> the download was ignored; EUR stays
 *   line 3 must ALWAYS show a grave, or the printer was left in the
 *          user-defined set and every later receipt is wrong
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

/* The slot to teach. A backtick is the one printable ASCII character that
   never appears on a receipt, so borrowing it costs nothing. */
const SLOT = 0x60;

/*
 * A euro, 12 dots wide and 24 tall, which is Font A.
 *
 * Drawn as rows because that is how a person reads it; the printer wants
 * columns, so it is transposed below. The two bars run wider than the C on
 * purpose - that overhang is what makes it a euro rather than a C with
 * stripes at receipt size.
 */
const GLYPH = [
  '............',
  '............',
  '............',
  '.....######.',
  '....########',
  '...###....##',
  '...##.......',
  '..###.......',
  '..###.......',
  '############',
  '############',
  '..###.......',
  '..###.......',
  '############',
  '############',
  '..###.......',
  '..###.......',
  '...##.......',
  '...###....##',
  '....########',
  '.....######.',
  '............',
  '............',
  '............',
];

/**
 * `ESC & y c1 c2 x d1..dn` - y bytes tall, one character, x columns wide,
 * then x*y bytes read top-to-bottom, most significant bit at the top.
 */
function defineGlyph(rows, slot) {
  const height = rows.length;
  const width = rows[0].length;
  const y = height / 8;
  const data = [];
  for (let col = 0; col < width; col++) {
    for (let band = 0; band < y; band++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (rows[band * 8 + bit][col] === '#') byte |= 0x80 >> bit;
      }
      data.push(byte);
    }
  }
  return Buffer.from([ESC, 0x26, y, slot, slot, width, ...data]);
}

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
  line('A EURO?');
  raw(GS, 0x21, 0x00);
  raw(ESC, 0x61, 0);
  line('-'.repeat(48));

  /* 1. the slot as the printer ships it */
  raw(ESC, 0x25, 0);
  line('1 before   : ` <- should be a grave accent');

  /* 2. taught, and switched on */
  out.push(defineGlyph(GLYPH, SLOT));
  raw(ESC, 0x25, 1);
  line('2 taught   : ` <- a EURO if this works');
  text('2 in use   : Subtotal ');
  raw(SLOT);
  line('13.00');

  /* 3. switched off again - the state MUST NOT leak into the next receipt */
  raw(ESC, 0x25, 0);
  line('3 after    : ` <- must be a grave again');

  line('-'.repeat(48));
  line('line 2 euro -> amounts can show the symbol');
  line('line 2 grave -> the download was ignored');
  line('line 3 MUST be a grave either way');
  raw(ESC, 0x64, 3);
  raw(GS, 0x56, 66, 0);

  return Buffer.concat(out);
}

app.whenReady().then(async () => {
  const bytes = strip();
  console.log('\nCAN THIS PRINTER LEARN A EURO\n');
  console.log('  glyph  : ' + GLYPH[0].length + ' x ' + GLYPH.length + ' dots into slot 0x' + SLOT.toString(16));
  console.log('  bytes  : ' + bytes.length);
  console.log('  printer: ' + PRINTER);

  const { HardwareManager } = require(path.join(ROOT, 'src', 'hardware-manager'));
  const said = await new HardwareManager().sendRawToPrinter(PRINTER, bytes, 'Posnic glyph probe');
  console.log('  ' + JSON.stringify(said));
  console.log(said.success ? '\n  SENT - read the paper\n' : '\n  NOT SENT\n');
  app.exit(said.success ? 0 : 1);
});
