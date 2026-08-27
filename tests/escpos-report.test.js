const test = require('node:test');
const assert = require('node:assert');
const { renderReport, COLUMNS } = require('../src/escpos-report');

/*
 * A cash-up slip has to fit the roll and say the right things in the right
 * order. Both are checked here by decoding the byte stream back into the lines
 * a printer would render, the same way the receipt tests do - what matters is
 * what reaches the paper, not what the buffer contains.
 */
const ESC = 0x1b, GS = 0x1d;

function decode(buf) {
  const lines = [];
  let line = '';
  let i = 0;
  let doubled = false;
  const big = new Set();

  while (i < buf.length) {
    const b = buf[i];
    if (b === ESC) {
      const c = buf[i + 1];
      if (c === 0x40) { i += 2; continue; }
      if (c === 0x61 || c === 0x45 || c === 0x74) { i += 3; continue; }
      if (c === 0x64) { lines.push(line); line = ''; i += 3; continue; }
      if (c === 0x70) { i += 5; continue; }
      i += 2; continue;
    }
    if (b === GS) {
      const c = buf[i + 1];
      if (c === 0x21) { doubled = buf[i + 2] !== 0; i += 3; continue; }
      if (c === 0x56) { i += 4; continue; }
      i += 2; continue;
    }
    if (b === 0x0a) {
      if (doubled) big.add(lines.length);
      lines.push(line); line = ''; i += 1; continue;
    }
    line += String.fromCharCode(b);
    i += 1;
  }
  if (line) lines.push(line);
  return { lines, big };
}

const DOC = {
  shop: 'TONCA SALES CENTRE',
  title: 'DAILY SALES',
  meta: [
    { label: 'From', value: '01/08/2026' },
    { label: 'To', value: '01/08/2026' },
    { label: 'Printed', value: '01/08/2026, 9:40:00 pm' },
    { label: 'By', value: 'Operator 99' },
  ],
  sections: [
    { type: 'pairs', name: 'SALES', rows: [
      { label: 'Items sold', value: '612' },
      { label: 'Subtotal', value: '84250.00' },
    ] },
    { type: 'total', label: 'TOTAL SALES', value: '86967.70' },
    { type: 'pairs', name: 'PAYMENTS', rows: [
      { label: 'Cash', value: '38400.00' },
      { label: 'UPI', value: '41200.70' },
      { label: 'Card', value: '7367.00' },
    ], total: { label: 'Total received', value: '86967.70' } },
    { type: 'blanks', name: 'HANDOVER', rows: [
      { label: 'Cash sales', value: '38400.00' },
      'Opening float', 'Cash counted', 'Difference', 'Handed to', 'Signature',
    ] },
    { type: 'items', name: 'TOP ITEMS BY VALUE', rows: [
      { name: 'Rice 5kg premium sona masoori basmati', qty: '48', amount: '23040.00' },
      { name: 'Sugar 1kg', qty: '110', amount: '5005.00' },
    ] },
    { type: 'note', text: 'Full item detail is on the A4 copy and the emailed PDF.' },
  ],
};

test('the slip fits both rolls', () => {
  for (const width of ['58', '80']) {
    const { lines } = decode(renderReport(DOC, { paperWidth: width }));
    for (const line of lines) {
      assert.ok(line.length <= COLUMNS[width],
        `${width}mm: "${line}" is ${line.length} of ${COLUMNS[width]} columns`);
    }
  }
});

test('every figure ends flush against the right margin', () => {
  for (const width of ['58', '80']) {
    const cols = COLUMNS[width];
    const { lines } = decode(renderReport(DOC, { paperWidth: width }));
    for (const amount of ['38400.00', '41200.70', '86967.70', '612']) {
      const line = lines.find((l) => l.endsWith(amount));
      assert.ok(line, `${width}mm: nothing ends with ${amount}`);
      assert.strictEqual(line.length, cols,
        `${width}mm: "${line}" stops at ${line.length}, not the ${cols}th column`);
    }
  }
});

test('cash and UPI are both named, because that is what the slip is for', () => {
  const { lines } = decode(renderReport(DOC, { paperWidth: '80' }));
  assert.ok(lines.some((l) => l.startsWith('Cash') && l.endsWith('38400.00')));
  assert.ok(lines.some((l) => l.startsWith('UPI') && l.endsWith('41200.70')));
});

test('the handover block leaves room to write', () => {
  // The app cannot know what is physically in the drawer, so the slip asks
  // rather than asserting.
  const { lines } = decode(renderReport(DOC, { paperWidth: '80' }));
  for (const label of ['Opening float', 'Cash counted', 'Signature']) {
    const line = lines.find((l) => l.startsWith(label));
    assert.ok(line, 'no line for ' + label);
    assert.ok(/\.{5,}$/.test(line), 'no room to write on: ' + line);
  }
});

test('the shop name and the total are the only enlarged lines', () => {
  // Two things carry size on a slip: whose till it came from, and the figure
  // it is about. Anything else competing with them dilutes both.
  const { lines, big } = decode(renderReport(DOC, { paperWidth: '80' }));
  const enlarged = [...big].map((n) => lines[n]).filter((l) => l && l.trim());
  assert.deepStrictEqual(enlarged.map((l) => l.split(/\s{2,}/)[0]),
    ['TONCA SALES CENTRE', 'TOTAL SALES']);
});

test('an empty section prints nothing rather than a bare heading', () => {
  // A day with no card sales should not print a PAYMENTS heading with
  // nothing under it - that reads as a fault.
  const doc = { shop: 'S', title: 'T', sections: [
    { type: 'pairs', name: 'PAYMENTS', rows: [] },
    { type: 'items', name: 'TOP ITEMS', rows: [] },
  ] };
  const { lines } = decode(renderReport(doc, { paperWidth: '80' }));
  assert.ok(!lines.some((l) => l.startsWith('PAYMENTS')), 'empty heading printed');
  assert.ok(!lines.some((l) => l.startsWith('TOP ITEMS')), 'empty heading printed');
});

test('an unknown section is skipped, not thrown on', () => {
  // A report that prints without one section beats a till that cannot print.
  const doc = { shop: 'S', title: 'T', sections: [
    { type: 'chart', data: [1, 2, 3] },
    { type: 'pairs', name: 'SALES', rows: [{ label: 'Total', value: '10.00' }] },
  ] };
  const { lines } = decode(renderReport(doc, { paperWidth: '80' }));
  assert.ok(lines.some((l) => l.startsWith('Total') && l.endsWith('10.00')));
});

test('a long item name wraps instead of losing its tail', () => {
  const { lines } = decode(renderReport(DOC, { paperWidth: '58' }));
  const joined = lines.join(' ').replace(/\s+/g, ' ');
  assert.ok(joined.includes('Rice 5kg premium sona masoori basmati'), joined);
});
