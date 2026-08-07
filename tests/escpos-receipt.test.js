const test = require('node:test');
const assert = require('node:assert');
const { renderSale, COLUMNS } = require('../escpos-receipt');

/*
 * A receipt is only correct if it fits the paper, and the paper is the one
 * thing these tests can check without a printer. So they decode the byte
 * stream back into the lines a printer would render and measure them.
 *
 * Decoding rather than pattern-matching the buffer matters: control codes are
 * consumed by their own length, so a stray 0x0a inside a command cannot be
 * mistaken for a line break and a line's width is what the paper will see.
 */
const ESC = 0x1b, GS = 0x1d;

function decode(buf) {
  const lines = [];
  const notes = [];
  let line = '';
  let i = 0;
  // GS ! packs width in the high nibble and height in the low one, so a line
  // can be enlarged in either direction independently: the store name is
  // double both, the total is double height only and keeps the full width.
  let doubled = false;
  const wide = new Set();

  while (i < buf.length) {
    const b = buf[i];
    if (b === ESC) {
      const c = buf[i + 1];
      if (c === 0x40) { notes.push('init'); i += 2; continue; }
      if (c === 0x61 || c === 0x45 || c === 0x74) { i += 3; continue; }
      if (c === 0x64) { lines.push(line); line = ''; i += 3; continue; }
      if (c === 0x70) { notes.push('drawer'); i += 5; continue; }
      i += 2; continue;
    }
    if (b === GS) {
      const c = buf[i + 1];
      if (c === 0x21) { doubled = buf[i + 2] !== 0; i += 3; continue; }
      if (c === 0x56) { notes.push('cut'); i += 4; continue; }
      i += 2; continue;
    }
    if (b === 0x0a) {
      if (doubled) wide.add(lines.length);
      lines.push(line);
      line = '';
      i += 1;
      continue;
    }
    line += String.fromCharCode(b);
    i += 1;
  }
  if (line) lines.push(line);
  return { lines, notes, wide };
}

const SALE = {
  storeName: 'TONCA SALES CENTRE',
  storeAddress: '12 Main Road, Neermulai, Goa 403001',
  storePhone: '98765 43210',
  gstin: '33AAICP7199L1ZP',
  title: 'SALES RECEIPT',
  billNo: 'Bill #00182',
  date: '31/07/2026 12:21',
  customer: ['Ramesh Kumar', '99441 22334'],
  items: [
    { name: 'ONION', qty: '4.055 kg', amount: 150.03 },
    { name: 'Rice 5kg premium sona masoori basmati', qty: '1 qty', amount: 480 },
  ],
  subTotal: 644.66,
  taxes: [{ label: 'CGST ( 9% )', amount: 29.01 }, { label: 'SGST ( 9% )', amount: 29.01 }],
  total: 703,
  extras: [{ label: 'Payment', value: 'Cash' }, { label: 'Payments/Credits', value: '₹ 800.00' }],
  footer: 'Goods once sold are not returnable after 7 days.',
};

test('no line is wider than the paper, on either roll', () => {
  for (const width of ['58', '80']) {
    const { lines } = decode(renderSale(SALE, { paperWidth: width }));
    for (const line of lines) {
      assert.ok(line.length <= COLUMNS[width],
        `${width}mm: "${line}" is ${line.length} of ${COLUMNS[width]} columns`);
    }
  }
});

test('amounts end flush against the right margin', () => {
  // The failure this guards against printed the amounts off the edge of the
  // paper, so their position is the whole point of the layout.
  for (const width of ['58', '80']) {
    const cols = COLUMNS[width];
    const { lines } = decode(renderSale(SALE, { paperWidth: width }));
    for (const amount of ['644.66', '703.00', '150.03', '480.00', '29.01']) {
      const line = lines.find((l) => l.endsWith(amount));
      assert.ok(line, `${width}mm: no line ends with ${amount}`);
      assert.strictEqual(line.length, cols,
        `${width}mm: "${line}" stops at ${line.length}, not the ${cols}th column`);
    }
  }
});

test('a name too long for the paper wraps instead of being cut', () => {
  const { lines } = decode(renderSale(SALE, { paperWidth: '58' }));
  const joined = lines.join(' ').replace(/\s+/g, ' ');
  assert.ok(joined.includes('Rice 5kg premium sona masoori basmati'),
    'the item name lost its tail: ' + joined);
});

test('the rupee sign becomes Rs., because the code page has no glyph for it', () => {
  // Sent as a byte, U+20B9 truncates to 0xB9 and prints as a superscript one.
  const { lines } = decode(renderSale(SALE, { paperWidth: '80' }));
  const line = lines.find((l) => l.startsWith('Payments/Credits'));
  assert.ok(line.includes('Rs. 800.00'), line);
  assert.ok(!line.includes('¹'), 'a superscript one reached the paper: ' + line);
  assert.strictEqual(line.length, COLUMNS['80'],
    'substituting the symbol moved the amount off the margin: ' + line);
});

test('the total is the one line printed double height', () => {
  const { lines, wide } = decode(renderSale(SALE, { paperWidth: '80' }));
  const totals = [...wide].map((n) => lines[n]).filter((l) => l.startsWith('TOTAL'));
  assert.strictEqual(totals.length, 1, 'expected exactly one enlarged TOTAL line');
});

test('a drawer opens only when asked, and the paper is always cut', () => {
  assert.ok(!decode(renderSale(SALE, {})).notes.includes('drawer'));
  assert.ok(decode(renderSale(SALE, { openDrawer: true })).notes.includes('drawer'));
  assert.ok(decode(renderSale(SALE, {})).notes.includes('cut'));
  assert.ok(!decode(renderSale(SALE, { cut: false })).notes.includes('cut'));
});

test('rows the shop added to its own template still print', () => {
  // The receipt template is editable, so anything it carried that this code
  // does not recognise has to survive rather than be dropped.
  const sale = Object.assign({}, SALE, {
    extras: [{ label: 'Loyalty points', value: '128' }],
  });
  const { lines } = decode(renderSale(sale, { paperWidth: '80' }));
  assert.ok(lines.some((l) => l.startsWith('Loyalty points') && l.endsWith('128')));
});

test('nothing optional leaves an empty line behind', () => {
  // A walk-in sale has no customer and no GSTIN; a blank line where a name
  // would go reads as a fault rather than as an absence.
  const bare = { items: [{ name: 'TEA', qty: '1', amount: 10 }], total: 10 };
  const { lines } = decode(renderSale(bare, { paperWidth: '58' }));
  const body = lines.slice(0, lines.findIndex((l) => l.startsWith('TOTAL')));
  assert.ok(!body.some((l) => l.trim() === ''), 'blank line in: ' + JSON.stringify(body));
});
