const { buildBillPayload, receiptDocument, taxRows } = require('../../../src/helpers/bill-payload');
const { recalculate } = require('../../../src/services/room-charge');

const india = { indian_gst: 'gst_on', currencyCode: 'INR', state: 'Tamil Nadu' };

function sale() {
  return {
    sales_id: 'ROOM-207',
    dine_type: 'Room',
    table_number: 'SA - 207',
    sales_sub_total: 1000,
    sales_total: 1102.5,
    tax: 52.5,
    items: [
      {
        item_name: 'Meal',
        item_quantity: 1,
        item_base_price: 1000,
        item_price: 1050,
        total_amount: 1050,
        item_tax: 50,
        tax_components: [
          { name: 'CGST', amount: 25 },
          { name: 'SGST', amount: 25 },
        ],
      },
    ],
    charges: [
      {
        source: 'room',
        name: 'Room service charge',
        percent: 5,
        amount: 50,
        tax_amount: 2.5,
        tax_name: 'GST',
        taxed: true,
      },
    ],
  };
}

test('room bill prints the saved 5% charge and all tax without double counting', () => {
  const bill = buildBillPayload(sale(), india);
  expect(bill.charges).toEqual([{ name: 'Room service charge (5%)', amount: 50 }]);
  expect(bill.taxes).toEqual([
    { label: 'CGST', amount: 26.25 },
    { label: 'SGST', amount: 26.25 },
  ]);
  expect(bill.total).toBe(1102.5);
  expect(receiptDocument(sale(), india, bill).charges[0]).toMatchObject({
    source: 'room',
    percent: 5,
    amount: 50,
    tax_amount: 2.5,
    tax_name: 'GST',
  });
});

test('₹100 food plus 5% service charge has GST on ₹105 and totals ₹110.25', () => {
  const charge = recalculate(
    {
      source: 'room',
      name: 'Room service charge',
      percent: 5,
      tax_rate: 5,
      taxed: true,
      tax_name: '5% Tax',
    },
    100,
    india
  );
  expect(charge).toMatchObject({ amount: 5, tax_amount: 0.25 });
  const saved = {
    ...sale(),
    sales_sub_total: 100,
    sales_total: 110.25,
    tax: 5.25,
    items: [
      {
        item_name: 'Biryani',
        item_quantity: 1,
        item_base_price: 100,
        item_price: 105,
        total_amount: 105,
        item_tax: 5,
        tax_components: [
          { name: 'CGST', amount: 2.5 },
          { name: 'SGST', amount: 2.5 },
        ],
      },
    ],
    charges: [charge],
  };
  const bill = buildBillPayload(saved, india);
  expect(bill.charges).toEqual([{ name: 'Room service charge (5%)', amount: 5 }]);
  expect(bill.taxes).toEqual([
    { label: 'CGST', amount: 2.63 },
    { label: 'SGST', amount: 2.62 },
  ]);
  expect(bill.total).toBe(110.25);
  expect(
    bill.subTotal + bill.charges[0].amount + bill.taxes.reduce((sum, row) => sum + row.amount, 0)
  ).toBe(110.25);
  expect(receiptDocument(saved, india, bill).receipt_tax_rows).toEqual(bill.taxes);
});

test('interstate GST on room charge is included in IGST for saved bills and split allocations', () => {
  const interstate = sale();
  interstate.items[0].tax_components = [{ name: 'IGST', amount: 50 }];
  expect(taxRows(interstate, india)).toEqual([{ label: 'IGST', amount: 52.5 }]);
  expect(
    taxRows(interstate, india, {
      components: { 'tax:IGST': 5000, 'tax:GST · Room service charge': 250 },
    })
  ).toEqual([{ label: 'IGST', amount: 52.5 }]);
});

test('older split bills fold a separate charge tax row into local GST', () => {
  expect(
    taxRows(sale(), india, {
      components: {
        'tax:CGST': 2500,
        'tax:SGST': 2500,
        'tax:GST · Room service charge': 53,
      },
    })
  ).toEqual([
    { label: 'CGST', amount: 25.27 },
    { label: 'SGST', amount: 25.26 },
  ]);
});

test('non-GST tax on charges retains its own receipt row', () => {
  const nonIndian = sale();
  nonIndian.items[0].tax_components = [{ name: 'VAT', amount: 50 }];
  expect(taxRows(nonIndian, { currencyCode: 'GBP', country: 'GB' })).toEqual([
    { label: 'VAT', amount: 50 },
    { label: 'GST · Room service charge', amount: 2.5 },
  ]);
});

test('odd paise of room-charge GST remains in CGST and SGST totals', () => {
  const saved = sale();
  saved.charges[0].tax_amount = 0.53;
  expect(taxRows(saved, india)).toEqual([
    { label: 'CGST', amount: 25.27 },
    { label: 'SGST', amount: 25.26 },
  ]);
});

test('the pictured ₹210 receipt keeps its ₹232 rounded total without a charge-tax row', () => {
  const pictured = sale();
  pictured.sales_sub_total = 210;
  pictured.sales_total = 232;
  pictured.round_off = 0.47;
  pictured.tax = 11.03;
  pictured.items = [
    {
      item_name: 'Vegetable Sandwich and Aerated Drinks',
      item_quantity: 1,
      item_base_price: 210,
      item_price: 220.5,
      total_amount: 220.5,
      item_tax: 10.5,
      tax_components: [
        { name: 'CGST', amount: 5.25 },
        { name: 'SGST', amount: 5.25 },
      ],
    },
  ];
  pictured.charges[0].amount = 10.5;
  pictured.charges[0].tax_amount = 0.53;
  pictured.charges[0].tax_name = '5% Tax';
  const bill = buildBillPayload(pictured, india);
  expect(bill.taxes).toEqual([
    { label: 'CGST', amount: 5.52 },
    { label: 'SGST', amount: 5.51 },
  ]);
  expect(bill.charges).toEqual([{ name: 'Room service charge (5%)', amount: 10.5 }]);
  expect(bill.subTotal + 11.03 + 10.5 + bill.roundOff).toBe(232);
  expect(bill.total).toBe(232);
});

test('legacy combined tax and untaxed room bills do not acquire extra tax', () => {
  const legacy = sale();
  delete legacy.items[0].tax_components;
  expect(taxRows(legacy, {}).reduce((sum, row) => sum + row.amount, 0)).toBe(52.5);
  const untaxed = sale();
  untaxed.charges[0].tax_amount = 0;
  untaxed.charges[0].taxed = false;
  untaxed.tax = 50;
  expect(taxRows(untaxed, {}).reduce((sum, row) => sum + row.amount, 0)).toBe(50);
});
