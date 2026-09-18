'use strict';

/*
 * CAN THIS PRINTER GO BACKWARDS?
 *
 * Owner: "can you print without top space".
 *
 * The inch above the logo is geometry, not a setting. The print head and the
 * cutter blade are about 25mm apart, and the paper between them cannot be
 * printed on:
 *
 *   the last line of a receipt is at the HEAD
 *   to cut after it, that line must travel 25mm to reach the BLADE
 *   so 25mm of blank passes the head - the bottom margin
 *   the cut happens at the blade; the paper left in the printer now runs from
 *     the cut edge back 25mm to the head
 *   the next receipt starts printing at the head, so that 25mm is its top
 *     margin
 *
 * The same 25mm is therefore paid TWICE per receipt, once at each end, and no
 * forward command changes either. There is one lever: if the printer can pull
 * paper BACKWARDS, the next receipt can start closer to the cut edge.
 *
 *   ESC e n   print and reverse feed n LINES
 *   ESC K n   print and reverse feed n dot rows
 *
 * Both are optional in ESC/POS and most cheap printers ignore them - and a few
 * mis-feed or smear, which is why this is asked on paper rather than shipped.
 * This printer has already ignored one standard command (ESC t, the code page)
 * and honoured another that looked no more likely (ESC &, downloaded glyphs),
 * so guessing has a bad record here.
 *
 *   npx electron tests/tools/can-this-printer-go-backwards.js --printer "POS-80C"
 *
 * Three strips. On each, measure from the TOP EDGE of the paper to the text:
 *   A  no reverse feed        - what ships today
 *   B  ESC e 3               - three lines back
 *   C  ESC K 120             - 120 dot rows back, about 15mm
 *
 * If B or C starts visibly closer to the edge, the top margin can be reclaimed.
 * If all three are identical, it cannot, and the honest answer is that the inch
 * is the hardware.
 *
 * CHECK THE PAPER FEEDS CLEANLY AFTERWARDS. A reverse feed that drags the roll
 * is worse than a wasted inch.
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

function strip(label, rewind) {
  const out = [];
  const raw = (...b) => out.push(Buffer.from(b));
  const line = (s) => {
    out.push(Buffer.from(s, 'latin1'));
    raw(0x0a);
  };

  raw(ESC, 0x40);
  /* Before anything is printed, which is the only moment it could help. */
  if (rewind) raw(...rewind);

  raw(ESC, 0x61, 1);
  raw(GS, 0x21, 0x11);
  line(label);
  raw(GS, 0x21, 0x00);
  raw(ESC, 0x61, 0);
  line('^ measure from the TOP EDGE to that');
  line('-'.repeat(48));
  line('If this sits closer to the edge than A,');
  line('the top margin can be reclaimed.');
  line('Check the paper still feeds cleanly.');

  /* The same ending on all three, so only the start differs. */
  raw(ESC, 0x64, 4);
  raw(GS, 0x56, 66, 0);
  return Buffer.concat(out);
}

const CASES = [
  ['A  NO REWIND', null],
  ['B  ESC e 3', [ESC, 0x65, 3]],
  ['C  ESC K 120', [ESC, 0x4b, 120]],
];

app.whenReady().then(async () => {
  const { HardwareManager } = require(path.join(ROOT, 'src', 'hardware-manager'));
  const hardware = new HardwareManager();

  console.log('\nCAN THIS PRINTER GO BACKWARDS\n');
  console.log('  printer: ' + PRINTER);
  console.log('  the inch above the logo is head-to-blade distance;');
  console.log('  reverse feed is the only command that could reclaim it\n');

  let bad = 0;
  for (const [label, rewind] of CASES) {
    const bytes = strip(label, rewind);
    /* eslint-disable-next-line no-await-in-loop -- printers are serial. */
    const said = await hardware.sendRawToPrinter(PRINTER, bytes, 'Posnic rewind test');
    console.log('  ' + label.padEnd(14) + bytes.length + ' bytes -> ' + JSON.stringify(said));
    if (!said.success) bad += 1;
  }

  console.log('\n  compare the top margins. identical means the inch is the hardware.\n');
  app.exit(bad ? 1 : 0);
});
