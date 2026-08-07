const test = require('node:test');
const assert = require('node:assert');
const { renderSale, COLUMNS } = require('../escpos-receipt');

/*
 * The item table is a table, and every row uses the same columns.
 *
 * A printed receipt came back from the shop with this in it:
 *
 *     GREEN BANANA         2 kg 188.00
 *     MALLIKA MANGO        2 kg 40.00
 *
 * Both quantities are "2 kg" and they are not in the same place. The name
 * column was being sized per row from the width of that row's own amount, so a
 * three-figure price and a two-figure price produced two different tables
 * printed on top of each other. Nothing was wrong with either line alone.
 *
 * These tests read the bytes that go to the printer and check the columns by
 * character position, because that is the only thing the customer sees.
 */

const ESC = 0x1b, GS = 0x1d;

/*
 * Walk the buffer, consuming each control code by its own length, so a byte
 * inside a command can never be mistaken for text or for a line break. A
 * column position is only meaningful if it is the position the paper will see.
 */
function decode(buf) {
  const LEN = {
    [ESC]: { 0x40: 2, 0x74: 3, 0x61: 3, 0x45: 3, 0x64: 3, 0x70: 5, 0x21: 3, 0x4d: 3, 0x2d: 3 },
    [GS]: { 0x21: 3, 0x56: 4, 0x42: 3 },
  };
  let out = '';
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    const table = LEN[b];
    if (table) {
      const n = table[buf[i + 1]];
      if (n) { i += n; continue; }
    }
    out += String.fromCharCode(b);
    i += 1;
  }
  return out;
}

/* The receipt the shop actually printed. */
const SALE = {
  storeName: 'Greenfield Horticultural Corporation',
  billNo: '#SID000066',
  date: '08/03/2026 09:54 pm',
  items: [
    { name: 'GRAPES W', qty: '2 kg', amount: 188 },
    { name: 'GREEN BANANA', qty: '2 kg', amount: 40 },
    { name: 'MALLIKA MANGO', qty: '1 kg', amount: 99 },
    { name: 'GAUVA', qty: '1 kg', amount: 55 },
    { name: 'B GRAPES', qty: '1 kg', amount: 147 },
  ],
  subTotal: 529,
  total: 529,
};

function itemLines(sale, roll) {
  const text = decode(renderSale(sale, { paperWidth: roll }));
  const lines = text.split('\n');
  const names = sale.items.map((i) => i.name);
  return lines.filter((l) => names.some((n) => l.startsWith(n)));
}

for (const roll of ['58', '80']) {
  const width = COLUMNS[roll];

  test(`every quantity starts in the same column (${roll})`, () => {
    const lines = itemLines(SALE, roll);
    assert.strictEqual(lines.length, SALE.items.length, 'one line per item');

    const positions = lines.map((l) => l.indexOf('kg'));
    assert.ok(positions.every((p) => p > 0), 'each line shows its unit');
    assert.strictEqual(new Set(positions).size, 1,
      'kg must be at one column, got ' + JSON.stringify(positions) + '\n' + lines.join('\n'));
  });

  test(`every amount ends in the same column (${roll})`, () => {
    const lines = itemLines(SALE, roll);
    const ends = lines.map((l) => l.replace(/\s+$/, '').length);

    assert.strictEqual(new Set(ends).size, 1,
      'amounts must end flush, got ' + JSON.stringify(ends));
  });

  test(`the decimal point is in one column (${roll})`, () => {
    // 188.00 and 40.00 have different widths; right-alignment is what makes
    // the decimals line up, and it is the decimals a person scans down.
    const lines = itemLines(SALE, roll);
    const dots = lines.map((l) => l.lastIndexOf('.'));

    assert.strictEqual(new Set(dots).size, 1,
      'decimal points must line up, got ' + JSON.stringify(dots));
  });

  test(`no line is wider than the paper (${roll})`, () => {
    const text = decode(renderSale(SALE, { paperWidth: roll }));
    for (const line of text.split('\n')) {
      assert.ok(line.length <= width,
        'line of ' + line.length + ' on ' + width + ' columns: ' + JSON.stringify(line));
    }
  });

  test(`the header sits over the columns it names (${roll})`, () => {
    const text = decode(renderSale(SALE, { paperWidth: roll }));
    const header = text.split('\n').find((l) => l.includes('AMOUNT'));
    const firstItem = itemLines(SALE, roll)[0];

    assert.strictEqual(header.replace(/\s+$/, '').length,
      firstItem.replace(/\s+$/, '').length,
      'AMOUNT must end where the amounts end');
  });
}

test('a receipt mixing weighed and counted goods keeps both columns true', () => {
  const mixed = {
    ...SALE,
    items: [
      { name: 'ONION', qty: '0.250 kg', amount: 12.5 },
      { name: 'SOAP', qty: '2 pcs', amount: 90 },
      { name: 'RICE', qty: '10.000 kg', amount: 1250 },
    ],
  };
  const lines = itemLines(mixed, '58');

  // The unit gets its own column, so kg sits under kg and pcs under pcs
  // instead of every unit floating on the width of the number before it.
  const unitStarts = lines.map((l) => l.search(/(kg|pcs)/));
  assert.strictEqual(new Set(unitStarts).size, 1,
    'units must share a column, got ' + JSON.stringify(unitStarts) + '\n' + lines.join('\n'));

  const ends = lines.map((l) => l.replace(/\s+$/, '').length);
  assert.strictEqual(new Set(ends).size, 1, 'amounts must still end flush');
});

test('a long name runs on underneath without moving the numbers', () => {
  const long = {
    ...SALE,
    items: [
      { name: 'Rice 5kg premium sona masoori basmati', qty: '1 kg', amount: 1250 },
      { name: 'SALT', qty: '2 kg', amount: 40 },
    ],
  };
  const text = decode(renderSale(long, { paperWidth: '58' }));
  const lines = text.split('\n');

  const withNumbers = lines.filter((l) => /\d\.\d\d$/.test(l.replace(/\s+$/, '')));
  const ends = withNumbers.map((l) => l.replace(/\s+$/, '').length);
  assert.strictEqual(new Set(ends).size, 1, 'numbers stay in column while the name wraps');

  // and the whole name survives somewhere on the receipt
  assert.ok(text.includes('sona masoori'), 'the name is not truncated');
});

test('the quantity column lines up on the decimal for weights', () => {
  const weighed = {
    ...SALE,
    items: [
      { name: 'ONION', qty: '0.250 kg', amount: 12.5 },
      { name: 'POTATO', qty: '1.000 kg', amount: 30 },
      { name: 'TOMATO', qty: '12.500 kg', amount: 400 },
    ],
  };
  const lines = itemLines(weighed, '80');
  const qtyDots = lines.map((l) => l.indexOf('.'));

  assert.strictEqual(new Set(qtyDots).size, 1,
    'weights line up on their decimal, got ' + JSON.stringify(qtyDots));
});
