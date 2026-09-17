/*
 * THE HEADER FACTS BELONG IN A BLOCK, AND THE COUNT BELONGS WITH THE MONEY.
 *
 * Owner, holding a printed bill from Azure: "Table number, order type, covers,
 * total quantity all these information can organize better as per
 * international standards and may be two column or moving total quantity to
 * bottom."
 *
 * He is right on both counts, and they are two different mistakes.
 *
 *   FOUR FACTS TOOK FOUR LINES. Table, order type and covers are read at a
 *   glance, not down a list, and stacked one per line they pushed the items
 *   further down the paper than the things a guest is actually checking.
 *
 *   THE COUNT WAS IN THE WRONG PLACE ENTIRELY. Total quantity is not a fact
 *   about the table, it is part of the arithmetic - how many things, what they
 *   came to. It sat in the header beside the table number, which is where the
 *   restaurant looks and not where the guest does.
 *
 * Narrow paper keeps one row per line on purpose: a 58mm roll is 32 characters,
 * and halved that turns "Order type" into "Order ty.". Losing a word to save a
 * line is the wrong trade on the document the guest keeps.
 */

const test = require('node:test');
const assert = require('node:assert');

const { renderSale } = require('../src/escpos-receipt');
const { parse, asLines } = require('../src/escpos-preview');

const SALE = {
  shopName: 'Azure Coastal Kitchen',
  title: 'BILL',
  billNo: 'SB1D19-27-000001',
  date: '16/09/2026 18:50',
  serviceRows: [
    { label: 'Table', value: '6A' },
    { label: 'Order type', value: 'Dine-in' },
    { label: 'Covers', value: '4' },
  ],
  totalQty: '5',
  items: [{ name: 'Pallipalayam Chicken', rate: '280.00', qty: '1', amount: '280.00' }],
  subTotal: 2290,
  total: 2404.5,
};

const linesOf = (sale, width = '80') => asLines(parse(renderSale(sale, { paperWidth: width })));

test('THE SERVICE FACTS SHARE A LINE ON 80mm PAPER', () => {
  const lines = linesOf(SALE);
  const together = lines.find((l) => /Table/.test(l) && /Order type/.test(l));
  assert.ok(
    together,
    'Table and Order type are still on separate lines:\n' + lines.slice(0, 14).join('\n')
  );
  assert.match(together, /6A/, 'the table number was lost');
  assert.match(together, /Dine-in/, 'the order type was lost');
});

test('and an odd one out still gets its own line rather than being dropped', () => {
  const lines = linesOf(SALE);
  assert.ok(
    lines.some((l) => /Covers/.test(l) && /4/.test(l)),
    'the third row vanished when it had no partner'
  );
});

test('NARROW PAPER KEEPS ONE TO A LINE, because a word is worth more than a line', () => {
  const lines = linesOf(SALE, '58');
  const together = lines.find((l) => /Table/.test(l) && /Order type/.test(l));
  assert.ok(!together, 'two columns were forced onto 58mm, which truncates the labels');
  assert.ok(lines.some((l) => /Order type/.test(l) && /Dine-in/.test(l)), 'the order type was truncated away');
});

test('THE COUNT PRINTS WITH THE MONEY, NOT WITH THE TABLE', () => {
  const lines = linesOf(SALE);
  const qtyAt = lines.findIndex((l) => /Total Qty/.test(l));
  const subtotalAt = lines.findIndex((l) => /Subtotal/.test(l));
  const tableAt = lines.findIndex((l) => /Table/.test(l));

  assert.notStrictEqual(qtyAt, -1, 'the total quantity stopped printing altogether');
  assert.notStrictEqual(subtotalAt, -1, 'the subtotal is gone');
  assert.ok(qtyAt > tableAt, 'the count is still up in the header with the table number');
  assert.ok(qtyAt < subtotalAt, 'the count should sit immediately above the subtotal it belongs to');
  assert.strictEqual(subtotalAt - qtyAt, 1, 'something was printed between the count and the subtotal');
});

test('AND IT LINES UP WITH THE QUANTITIES IT TOTALS', () => {
  /*
   * Owner, on a printed bill: "total quantity just make it same alignment of
   * quantity column. not to the last. i think its better."
   *
   * He is right, and the reason is worth keeping. A count printed hard against
   * the right edge sits under AMOUNT - the one column on a bill where a number
   * must not be mistaken for money. Under the quantities it is obviously a
   * count of them.
   *
   * Asserted by column index rather than by eye, because a layout that looks
   * right in one sample and drifts on another is exactly what this table was
   * rebuilt to stop.
   */
  const lines = linesOf({
    ...SALE,
    items: [
      { name: 'Pallipalayam Chicken', rate: '280.00', qty: '1', amount: '280.00' },
      { name: 'Sunset Cooler', rate: '130.00', qty: '2', amount: '260.00' },
    ],
  });

  const itemRow = lines.find((l) => /Sunset Cooler/.test(l));
  const totalRow = lines.find((l) => /Total Qty/.test(l));
  assert.ok(itemRow && totalRow, 'the rows this compares are not both printed');

  const itemQtyAt = itemRow.indexOf('2', itemRow.indexOf('130.00'));
  const totalQtyAt = totalRow.lastIndexOf('5');
  assert.strictEqual(
    totalQtyAt,
    itemQtyAt,
    'the total sits in a different column from the quantities it adds up:' +
      String.fromCharCode(10) + itemRow + String.fromCharCode(10) + totalRow
  );

  /*
   * And emphatically NOT in the money column. Compared against the subtotal's
   * own digits rather than against the end of the string: the preview trims
   * trailing spaces, so "last character" is not "right edge of the paper".
   */
  const subtotalRow = lines.find((l) => /Subtotal/.test(l));
  assert.ok(subtotalRow, 'there is no subtotal to compare against');
  assert.notStrictEqual(
    totalQtyAt,
    subtotalRow.length - 1,
    'the count is back under the amount column, where it reads as money'
  );
});

test('a shop that asked for none of it gets none of it', () => {
  /* Every one of these is a per-shop switch, and the default is off. The block
     must vanish entirely rather than print an empty frame. */
  const bare = { ...SALE, serviceRows: [], totalQty: '' };
  const lines = linesOf(bare);
  assert.ok(!lines.some((l) => /Table|Order type|Covers|Total Qty/.test(l)), 'a row printed that nobody asked for');
  assert.ok(lines.some((l) => /Subtotal/.test(l)), 'the bill stopped printing its subtotal');
});

test('and the grid does not throw on anything a payload can hand it', () => {
  for (const rows of [undefined, null, [], [null], [{ label: '', value: '' }], [{ label: 'Table' }]]) {
    assert.doesNotThrow(() => linesOf({ ...SALE, serviceRows: rows }), `threw on ${JSON.stringify(rows)}`);
  }
});

test('a long label is cut rather than allowed to collide with its neighbour', () => {
  const lines = linesOf({
    ...SALE,
    serviceRows: [
      { label: 'An extremely long service label indeed', value: 'X' },
      { label: 'Covers', value: '4' },
    ],
  });
  const row = lines.find((l) => /Covers/.test(l));
  assert.ok(row, 'the second column was lost');
  assert.ok(row.length <= 48, `the line ran past the paper: ${row.length} characters`);
});
