'use strict';
const { buildBillPayload } = require('../../../src/helpers/bill-payload');
const { snapshotFrom } = require('../../../src/services/guest-bill.service');
const branch = { currencyCode: 'INR', indian_gst: 'enable', bill_print_total_qty: true };
const active = {
  item_id: 'corn',
  item_name: 'Baby corn',
  item_quantity: 2,
  item_base_price: 100,
  item_tax: 10,
};
test.each([
  { cancelled: true },
  { return: true },
  { status: 'cancelled' },
  { status: 'CANCELED' },
  { item_quantity: 0 },
])('inactive historical line %j cannot appear on a bill or alter its tax rate label', (flags) => {
  const sale = {
    _id: 'source',
    sales_sub_total: 200,
    sales_total: 210,
    tax: 10,
    items: [
      active,
      {
        ...active,
        item_id: 'old',
        item_name: 'Cancelled dish',
        item_quantity: 4,
        item_tax: 72,
        ...flags,
      },
    ],
  };
  const bill = buildBillPayload(sale, branch);
  expect(bill.items).toHaveLength(1);
  expect(bill.items[0].name).toBe('Baby corn');
  expect(bill.totalQty).toBe('2');
  expect(bill.subTotal).toBe(200);
  expect(bill.total).toBe(210);
  expect(bill.taxes).toEqual([
    { label: 'CGST 2.5%', amount: 5 },
    { label: 'SGST 2.5%', amount: 5 },
  ]);
  const snapshot = snapshotFrom([sale], branch, '1');
  expect(snapshot.lines.map((line) => line.name)).toEqual(bill.items.map((line) => line.name));
  expect(snapshot.totalMinor).toBe(21000);
});
test('subtotal fallback and quantity count use only active items without changing recorded money', () => {
  const bill = buildBillPayload(
    { sales_total: 195, discount: 5, items: [active, { ...active, cancelled: true }] },
    branch
  );
  expect(bill.subTotal).toBe(200);
  expect(bill.totalQty).toBe('2');
  expect(bill.total).toBe(195);
  expect(bill.discount).toBe(5);
});

test.each([
  ['INR', 5.01],
  ['JPY', 5],
  ['KWD', 5.001],
])('split tax rows conserve odd minor units for %s', (currencyCode, tax) => {
  const Money = require('../../../src/utils/currency'),
    shop = { ...branch, currencyCode },
    policy = Money.policy(shop);
  const sale = {
    _id: 'source',
    items: [{ ...active, item_tax: tax }],
    sales_sub_total: 200,
    sales_total: 200 + tax,
    tax,
  };
  const bill = buildBillPayload(sale, shop);
  const components = bill.taxes.map((row) => Money.toMinor(row.amount, policy));
  expect(components.reduce((sum, value) => sum + value, 0)).toBe(Money.toMinor(tax, policy));
  expect(Math.abs(components[0] - components[1])).toBeLessThanOrEqual(1);
  const snapshot = snapshotFrom([sale], shop, '1');
  expect(snapshot.lines[0].components.find((row) => row.key === 'adjustment').minor).toBe(0);
});

test('queued bills carry the saved desktop design and only printable data', () => {
  const design = { version: 1 };
  const bill = buildBillPayload(
    {
      sales_id: 'S-123',
      sales_sub_total: 250,
      sales_total: 262.5,
      tax: 12.5,
      items: [
        {
          item_name: 'Rice',
          item_quantity: 1,
          item_base_price: 250,
          item_price: 250,
          total_amount: 262.5,
        },
        { item_name: 'Cancelled', item_quantity: 1, item_price: 999, cancelled: true },
      ],
    },
    { ...branch, receipt_designs: design, api_key: 'never-print-this', currency: 'Rs' }
  );
  expect(bill.receiptDocument.receipt_designs).toEqual(design);
  expect(bill.receiptDocument.items_total).toBe(262.5);
  expect(bill.receiptDocument.receipt_line_rows).toHaveLength(1);
  expect(bill.receiptDocument.receipt_line_rows[0].amount).toBe(250);
  expect(bill.receiptDocument.receipt_tax_rows).toEqual(bill.taxes);
  expect(bill.receiptDocument.api_key).toBeUndefined();
});
