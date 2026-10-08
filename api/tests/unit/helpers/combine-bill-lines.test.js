'use strict';
const combine = require('../../../src/helpers/combine-bill-lines');
const Money = require('../../../src/utils/currency');
const { itemLines, buildBillPayload } = require('../../../src/helpers/bill-payload');
const policy = Money.policy({ currency: '₹' });
const source = (quantity) => ({
  item_id: 'phulka',
  item_name: 'Phulka',
  item_quantity: quantity,
  item_base_price: 25,
  tax_type: 'exclusive',
  tax: 5,
  item_discount: 0,
});

test('6 + 1 + 1 kitchen rounds display as eight without modifying the saved lines', () => {
  const items = [source(6), source(1), source(1)];
  items.forEach((item, index) => {
    item._id = 'line-' + index;
    item.kot_round_id = index;
    item.item_tax = item.item_quantity * 1.25;
  });
  const before = JSON.stringify(items);
  const rows = itemLines({ items }, {});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: 'Phulka', qty: '8', amount: 200 });
  expect(JSON.stringify(items)).toBe(before);
});

test.each([
  'item_id',
  'item_base_price',
  'tax',
  'tax_type',
  'item_discount',
  'variant_id',
  'modifiers',
  'kitchen_note',
  'guest_id',
  'item_unit',
])('different %s cannot combine', (field) => {
  const items = [
    source(1),
    {
      ...source(1),
      [field]:
        field === 'item_base_price' || field === 'tax' || field === 'item_discount'
          ? 10
          : 'different',
    },
  ];
  expect(itemLines({ items }, {})).toHaveLength(2);
});

test('sum the prepared amounts without recalculating quantity times rate or tax', () => {
  const rows = [
    { name: 'Phulka', qty: '1', rate: '0.33', amount: 0.33 },
    { name: 'Phulka', qty: '1', rate: '0.33', amount: 0.34 },
  ];
  expect(combine([source(1), source(1)], rows, policy)[0]).toMatchObject({
    qty: '2',
    amount: 0.67,
  });
  expect(rows[0].qty).toBe('1');
});

test('items without catalogue identity stay separate and returned rows remain excluded', () => {
  const unknown = { ...source(1), item_id: undefined };
  expect(itemLines({ items: [unknown, unknown] }, {})).toHaveLength(2);
  expect(itemLines({ items: [source(1), { ...source(1), return: true }] }, {})).toHaveLength(1);
});

test('bill totals remain supplied by the sale, not recomputed from grouping', () => {
  const bill = buildBillPayload(
    { items: [source(6), source(1), source(1)], sales_sub_total: 200, sales_total: 210, tax: 10 },
    {}
  );
  expect(bill.items).toHaveLength(1);
  expect(bill.total).toBe(210);
  expect(bill.subTotal).toBe(200);
});

test('guest allocation retains each original line even when customer bill rows combine', () => {
  const { snapshotFrom, billForGuest } = require('../../../src/services/guest-bill.service');
  const sale = {
    _id: 'sale-one',
    items: [source(6), source(1), source(1)],
    sales_sub_total: 200,
    sales_total: 200,
  };
  const snapshot = snapshotFrom([sale], {}, 'T1');
  expect(snapshot.lines).toHaveLength(3);
  expect(snapshot.lines.map((line) => line.quantity)).toEqual([6, 1, 1]);
  const guest = {
    index: 0,
    name: 'Guest',
    totalMinor: snapshot.totalMinor,
    components: { base: 20000 },
    lines: snapshot.lines.map((line) => ({
      ...line,
      weight: 1,
      weightTotal: 1,
      components: Object.fromEntries(line.components.map((part) => [part.key, part.minor])),
    })),
  };
  const bill = billForGuest(snapshot, guest, {}, sale, 'bill-one');
  expect(bill.items).toHaveLength(1);
  expect(bill.items[0]).toMatchObject({ qty: '8', amount: 200 });
  expect(snapshot.lines).toHaveLength(3);
});
