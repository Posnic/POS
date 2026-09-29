const { itemSaleContribution } = require('../../../src/services/business-item-metrics');
const { originalItemFacts } = require('../../../src/services/business-item-origin');
const a = 'a'.repeat(24),
  b = 'b'.repeat(24);
const branch = {
  id: '1'.repeat(24),
  license: '2'.repeat(24),
  currency: 'INR',
  currencyDigits: 2,
  timezone: 'Asia/Kolkata',
};
const line = (item_id = a, item_quantity = '2', total_amount = '2', item_unit = 'qty') => ({
  item_id,
  item_name: item_id === a ? 'Tea' : 'Cake',
  item_quantity,
  total_amount,
  item_unit,
});
function sale() {
  return {
    _id: '3'.repeat(24),
    branch_id: branch.id,
    license: branch.license,
    sale_process: 'Add',
    date: '2026-09-01T18:45:00Z',
    sales_total: '3.01',
    items: [line(), line(b)],
  };
}
function returned() {
  const value = sale();
  value.business_item_origin = originalItemFacts(value, '2026-09-03T00:00:00Z');
  value.items = [];
  value.sale_process = 'FullReturn';
  value.items_return_total = '3.01';
  value.items_return = [
    {
      returnArray: {
        returnObjId: '4'.repeat(24),
        returnDate: '2026-09-03T20:00:00Z',
        itemsTotalAmount: '3.01',
        returnValue: [line(), line(b)],
      },
    },
  ];
  return value;
}
test('header-discount allocation conserves recorded revenue and respects local invoice and refund dates', () => {
  const value = returned(),
    before = structuredClone(value);
  expect(itemSaleContribution(value, branch).entries).toEqual([
    {
      businessDate: '2026-09-02',
      itemId: a,
      name: 'Tea',
      billedSalesMinor: 151,
      refundsMinor: 0,
      quantities: [{ unit: 'qty', soldMilli: 2000, returnedMilli: 0 }],
    },
    {
      businessDate: '2026-09-02',
      itemId: b,
      name: 'Cake',
      billedSalesMinor: 150,
      refundsMinor: 0,
      quantities: [{ unit: 'qty', soldMilli: 2000, returnedMilli: 0 }],
    },
    {
      businessDate: '2026-09-04',
      itemId: a,
      name: 'Tea',
      billedSalesMinor: 0,
      refundsMinor: 151,
      quantities: [{ unit: 'qty', soldMilli: 0, returnedMilli: 2000 }],
    },
    {
      businessDate: '2026-09-04',
      itemId: b,
      name: 'Cake',
      billedSalesMinor: 0,
      refundsMinor: 150,
      quantities: [{ unit: 'qty', soldMilli: 0, returnedMilli: 2000 }],
    },
  ]);
  expect(value).toEqual(before);
});
test('duplicate items retain unit distinctions and line-order-independent allocations', () => {
  const value = sale();
  value.items = [line(a, '0.125', '1', 'kg'), line(a, '1', '1', 'pack'), line(b)];
  const first = itemSaleContribution(value, branch);
  value.items.reverse();
  expect(itemSaleContribution(value, branch)).toEqual(first);
  expect(first.entries[0].quantities).toEqual([
    { unit: 'kg', soldMilli: 125, returnedMilli: 0 },
    { unit: 'pack', soldMilli: 1000, returnedMilli: 0 },
  ]);
});
test('missing or corrupted original snapshots never produce plausible partial rankings', () => {
  for (const change of [
    (v) => {
      delete v.business_item_origin;
    },
    (v) => {
      v.business_item_origin.branchId = '5'.repeat(24);
    },
    (v) => {
      v.business_item_origin.salesTotal = '3';
    },
    (v) => {
      v.business_item_origin.invoiceDate = '2026-09-01T00:00:00.000Z';
    },
    (v) => {
      v.business_item_origin.lines[0].quantity = '-1';
    },
    (v) => {
      v.business_item_origin.lines[0].itemId = b.toUpperCase();
    },
    (v) => {
      v.business_item_origin.schemaVersion = 2;
    },
  ]) {
    const value = returned();
    change(value);
    expect(() => itemSaleContribution(value, branch)).toThrow(/original_items/);
  }
});
test('unknown items, changed units, and cumulative excessive returns fail closed', () => {
  for (const change of [
    (v) => {
      v.items_return[0].returnArray.returnValue[0].item_id = 'c'.repeat(24);
    },
    (v) => {
      v.items_return[0].returnArray.returnValue[0].item_unit = 'kg';
    },
    (v) => {
      v.items_return[0].returnArray.returnValue[0].item_quantity = '3';
    },
    (v) => {
      const refund = structuredClone(v.items_return[0]);
      refund.returnArray.returnObjId = '5'.repeat(24);
      refund.returnArray.itemsTotalAmount = 0;
      v.items_return.push(refund);
    },
  ]) {
    const value = returned();
    change(value);
    expect(() => itemSaleContribution(value, branch)).toThrow('unreconciled_item_quantities');
  }
});
test('zero-value returns retain quantities, ignored sales need no item facts, and precision is never rounded silently', () => {
  const value = returned();
  value.sales_total = value.business_item_origin.salesTotal = '0';
  value.items_return_total = value.items_return[0].returnArray.itemsTotalAmount = '0';
  expect(
    itemSaleContribution(value, branch).entries.every(
      (entry) => entry.billedSalesMinor === 0 && entry.refundsMinor === 0
    )
  ).toBe(true);
  expect(
    itemSaleContribution({ ...sale(), sale_process: 'Hold', items: [] }, branch).entries
  ).toEqual([]);
  const precise = sale();
  precise.items[0].total_amount = '2.001';
  expect(() => itemSaleContribution(precise, branch)).toThrow('unsupported_precision');
  expect(
    itemSaleContribution(precise, { ...branch, currency: 'KWD', currencyDigits: 3 }).entries.reduce(
      (sum, entry) => sum + entry.billedSalesMinor,
      0
    )
  ).toBe(3010);
});
