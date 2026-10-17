'use strict';
const { taxRows } = require('../../../src/helpers/bill-payload');
const branch = { indian_gst: 'gst_on', state: 'Tamil Nadu', currencyCode: 'INR' };
const sale = {
  tax: 10,
  customer_state: 'Tamil Nadu',
  items: [{ item_quantity: 1, item_base_price: 200, item_tax: 10 }],
};
test('same-state GST splits and interstate supply uses IGST', () => {
  expect(taxRows(sale, branch)).toEqual([
    { label: 'CGST 2.5%', amount: 5 },
    { label: 'SGST 2.5%', amount: 5 },
  ]);
  expect(taxRows({ ...sale, customer_state: 'Karnataka' }, branch)).toEqual([
    { label: 'IGST 5%', amount: 10 },
  ]);
  expect(taxRows({ ...sale, customer_state: '33' }, branch)).toEqual(taxRows(sale, branch));
  expect(taxRows({ ...sale, place_of_supply: 'Karnataka' }, branch)[0].label).toBe('IGST 5%');
});
test('recorded components survive branch setting and address changes', () => {
  const saved = {
    ...sale,
    items: [{ item_quantity: 1, tax_components: [{ name: 'IGST', amount: 10 }] }],
  };
  expect(taxRows(saved, { ...branch, indian_gst: 'gst_off' })).toEqual([
    { label: 'IGST', amount: 10 },
  ]);
  expect(
    taxRows({ ...sale, items: [{ item_quantity: 1, cgst_tax: 5.01, sgst_tax: 4.99 }] }, branch)
  ).toEqual([
    { label: 'CGST', amount: 5.01 },
    { label: 'SGST', amount: 4.99 },
  ]);
});
test('GST off stays generic, zero stays empty, and rounding keeps the total', () => {
  expect(taxRows(sale, { ...branch, indian_gst: 'gst_off' })).toEqual([
    { label: 'Tax', amount: 10 },
  ]);
  expect(taxRows({ ...sale, tax: 0, items: [] }, branch)).toEqual([]);
  expect(taxRows({ ...sale, tax: 2.25, items: [] }, branch).map((r) => r.amount)).toEqual([
    1.13, 1.12,
  ]);
  expect(
    taxRows({ ...sale, customer_state: 'Chandigarh' }, { ...branch, state: '04' })[1].label
  ).toBe('UTGST 2.5%');
});
