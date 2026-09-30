'use strict';
const {
  minorUnits,
  businessDate,
  saleContribution,
} = require('../../../src/services/business-metrics');
const branch = {
  id: 'a'.repeat(24),
  license: 'b'.repeat(24),
  currency: 'INR',
  currencyDigits: 2,
  timezone: 'Asia/Kolkata',
};
const sale = (extra) => ({
  _id: 'c'.repeat(24),
  license: branch.license,
  branch_id: branch.id,
  sale_process: 'Add',
  payment_status: 'Paid',
  sales_total: 170.25,
  date: new Date('2026-09-27T19:00:00Z'),
  ...extra,
});
const returned = (id, at, amount) => ({
  returnArray: { returnObjId: id.repeat(24), returnDate: new Date(at), itemsTotalAmount: amount },
});
test('decimal money handles zero and three-decimal currencies without rounding away mismatches', () => {
  expect(minorUnits('100.10', 2)).toBe(10010);
  expect(minorUnits('1.234', 3)).toBe(1234);
  expect(minorUnits('105.00', 0)).toBe(105);
  for (const value of [NaN, Infinity, -1, '', [], null, '1e3', '1.001'])
    expect(() => minorUnits(value, 2)).toThrow();
  expect(() => minorUnits('9007199254740992', 0)).toThrow();
});
test('business dates use the configured zone across midnight and daylight-saving changes', () => {
  expect(businessDate(new Date('2026-09-27T19:00:00Z'), branch.timezone)).toBe('2026-09-28');
  expect(businessDate(new Date('2026-03-08T04:30:00Z'), 'America/New_York')).toBe('2026-03-07');
  expect(() => businessDate('2026-03-08', branch.timezone)).toThrow();
  expect(() => businessDate(new Date(), 'invalid-zone')).toThrow();
});
test('billed total already includes tax, discounts and roundoff; refunds belong to their own dates', () => {
  const result = saleContribution(
    sale({
      tax: 9,
      discount: 20,
      coupon_discount_value: 5,
      tip_amount: 30,
      sale_process: 'PartialReturn',
      items_return_total: 50,
      items_return: [
        returned('d', '2026-09-28T10:00:00Z', 20),
        returned('e', '2026-09-29T10:00:00Z', 30),
      ],
    }),
    branch
  );
  expect(result.entries).toEqual([
    { businessDate: '2026-09-28', billedSalesMinor: 17025, refundsMinor: 2000, completedSales: 1 },
    { businessDate: '2026-09-29', billedSalesMinor: 0, refundsMinor: 3000, completedSales: 0 },
  ]);
});
test('paid table bills are included; open tables, holds, cancelled and training sales are excluded', () => {
  expect(saleContribution(sale({ sale_process: 'KOT' }), branch).entries).toHaveLength(1);
  for (const extra of [
    { sale_process: 'KOT', payment_status: 'Unpaid' },
    { sale_process: 'Hold' },
    { sale_process: 'Cancel' },
    { training: true },
  ])
    expect(saleContribution(sale(extra), branch).entries).toEqual([]);
  expect(
    saleContribution(sale({ payment_status: 'Unpaid' }), branch).entries[0].billedSalesMinor
  ).toBe(17025);
});
test('duplicate, malformed and mismatched refunds or scope fail closed instead of becoming zero sales', () => {
  const r = returned('d', '2026-09-28T10:00:00Z', 20);
  for (const extra of [
    { branch_id: 'f'.repeat(24) },
    { license: 'f'.repeat(24) },
    { sale_process: 'unknown' },
    { items_return_total: 20 },
    { items_return: [r, r], items_return_total: 40 },
    { items_return: [r], items_return_total: 10 },
    { sales_total: 10, items_return: [r], items_return_total: 20 },
  ])
    expect(() => saleContribution(sale(extra), branch)).toThrow();
});
