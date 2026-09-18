'use strict';

/*
 * HOW MUCH PAPER DOES A CUT COST?
 *
 * Owner, holding a printed receipt: "above logo there is gap almost one inch
 * in the print paper. please check. that area might be waste."
 *
 * Reading the byte stream first, because it splits the question in two:
 *
 *   THE TOP GAP IS NOT OURS. The receipt begins `ESC @`, `ESC t`, then the
 *   logo raster - no feed, nothing before it. The gap is the distance between
 *   the print head and the cutter blade: when the previous receipt was cut,
 *   that inch of paper had already travelled past the head, and nothing can be
 *   printed on it afterwards. Every thermal printer does this and no command
 *   changes it.
 *
 *   THE BOTTOM MIGHT BE. The receipt ends `ESC d 4` - feed four lines - and
 *   then `GS V 66 0`, which by the spec FEEDS TO THE CUTTING POSITION and
 *   cuts. If the printer honours that, the four lines are fifteen millimetres
 *   of blank roll on every single receipt, paid for twice a day by every shop.
 *
 * "If the printer honours that" is the whole question, and this printer has
 * already ignored one command that looked just as standard. Getting it wrong
 * loses the last lines of a receipt, which is far worse than wasting paper, so
 * it is asked on paper rather than assumed.
 *
 *   npx electron tests/tools/how-much-paper-does-a-cut-cost.js --printer "POS-80C"
 *
 * Three strips come out. On each, measure from the LAST LINE to the cut:
 *   FEED 4  what ships today
 *   FEED 1  the saving, with a line of margin left
 *   FEED 0  the most that can be saved
 * If FEED 0 still shows its last line, the feed is pure waste. If it is cut
 * off or missing, the feed is load-bearing and stays.
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

function strip(feedLines) {
  const out = [];
  const raw = (...b) => out.push(Buffer.from(b));
  const line = (s) => {
    out.push(Buffer.from(s, 'latin1'));
    raw(0x0a);
  };

  raw(ESC, 0x40);
  raw(ESC, 0x61, 1);
  line('FEED ' + feedLines);
  raw(ESC, 0x61, 0);
  line('-'.repeat(48));
  line('Measure from the line below to the cut.');
  line('If this strip is missing its last line, the');
  line('feed is doing something and must stay.');
  line('-'.repeat(48));
  line('>>> LAST LINE, FEED ' + feedLines + ' <<<');

  if (feedLines > 0) raw(ESC, 0x64, feedLines);
  raw(GS, 0x56, 66, 0);
  return Buffer.concat(out);
}

app.whenReady().then(async () => {
  const { HardwareManager } = require(path.join(ROOT, 'src', 'hardware-manager'));
  const hardware = new HardwareManager();

  console.log('\nHOW MUCH PAPER DOES A CUT COST\n');
  console.log('  printer: ' + PRINTER);
  console.log('  the top gap is the head-to-blade distance and is not ours');
  console.log('  this measures the bottom, which is\n');

  let bad = 0;
  for (const feed of [4, 1, 0]) {
    const bytes = strip(feed);
    /* eslint-disable-next-line no-await-in-loop -- printers are serial. */
    const said = await hardware.sendRawToPrinter(PRINTER, bytes, 'Posnic cut test ' + feed);
    console.log('  FEED ' + feed + ': ' + bytes.length + ' bytes -> ' + JSON.stringify(said));
    if (!said.success) bad += 1;
  }

  console.log('\n  read the three strips: does FEED 0 still show its last line?\n');
  app.exit(bad ? 1 : 0);
});
