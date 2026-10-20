const { buildBillPayload, receiptDocument, taxRows } = require('../../../src/helpers/bill-payload');

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
  const bill = buildBillPayload(sale(), {});
  expect(bill.charges).toEqual([{ name: 'Room service charge (5%)', amount: 50 }]);
  expect(bill.taxes.reduce((sum, row) => sum + row.amount, 0)).toBe(52.5);
  expect(bill.total).toBe(1102.5);
  expect(receiptDocument(sale(), {}, bill).charges[0]).toMatchObject({
    source: 'room',
    percent: 5,
    amount: 50,
    tax_amount: 2.5,
    tax_name: 'GST',
  });
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
