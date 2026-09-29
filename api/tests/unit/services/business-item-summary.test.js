const { createItemSummary, MAX_UNITS } = require('../../../src/services/business-item-summary');
const { originalItemFacts } = require('../../../src/services/business-item-origin');
const branch = {
  id: '1'.repeat(24),
  license: '2'.repeat(24),
  currency: 'INR',
  currencyDigits: 2,
  timezone: 'UTC',
};
function sale(n, unit = 'qty') {
  return {
    _id: '3'.repeat(24),
    branch_id: branch.id,
    license: branch.license,
    sale_process: 'Add',
    date: '2026-09-01T00:00:00Z',
    sales_total: n,
    items: [
      {
        item_id: n.toString(16).padStart(24, '0'),
        item_name: `Item ${n}`,
        item_unit: unit,
        item_quantity: 1,
        total_amount: n,
      },
    ],
  };
}
test('top twenty ranks only after aggregating all invoices, with deterministic ties and explicit truncation', () => {
  const summary = createItemSummary(branch, '2026-09-01');
  for (let n = 1; n <= 25; n++) summary.add(sale(n));
  summary.add(sale(1));
  const result = summary.finish({ billedSalesMinor: 32600, refundsMinor: 0 });
  expect(result.state).toBe('available');
  expect(result.totalItems).toBe(25);
  expect(result.truncated).toBe(true);
  expect(result.items).toHaveLength(20);
  expect(result.items[0].salesAfterReturnsMinor).toBe(2500);
  expect(result.items[19].salesAfterReturnsMinor).toBe(600);
});
test('refund-only days retain negative allocated revenue and returned units', () => {
  const value = sale(1);
  value.business_item_origin = originalItemFacts(value, value.date);
  value.items_return = [
    {
      returnArray: {
        returnObjId: '4'.repeat(24),
        returnDate: '2026-09-02T00:00:00Z',
        itemsTotalAmount: 1,
        returnValue: value.items,
      },
    },
  ];
  value.items_return_total = 1;
  value.items = [];
  value.sale_process = 'FullReturn';
  const summary = createItemSummary(branch, '2026-09-02');
  summary.add(value);
  const result = summary.finish({ billedSalesMinor: 0, refundsMinor: 100 });
  expect(result.items[0].salesAfterReturnsMinor).toBe(-100);
  expect(result.items[0].quantities[0]).toEqual({ unit: 'qty', soldMilli: 0, returnedMilli: 1000 });
});
test('excessive units suppress the whole ranking, and unavailable sources continue to be counted', () => {
  const summary = createItemSummary(branch, '2026-09-01');
  for (let n = 0; n <= MAX_UNITS; n++) summary.add(sale(1, `unit${n}`));
  summary.add({ ...sale(1), items: [] });
  const result = summary.finish({ billedSalesMinor: 1800, refundsMinor: 0 });
  expect(result.state).toBe('incomplete');
  expect(result.reason).toBe('item_budget_exceeded');
  expect(result.unavailableSales).toBe(2);
  expect(result.items).toEqual([]);
});
test('empty days are valid but inconsistent canonical totals cannot be published', () => {
  const summary = createItemSummary(branch, '2026-09-01');
  expect(summary.finish({ billedSalesMinor: 0, refundsMinor: 0 }).totalItems).toBe(0);
  expect(() => summary.finish({ billedSalesMinor: 1, refundsMinor: 0 })).toThrow(
    'unreconciled_item_revenue'
  );
});
