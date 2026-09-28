const {
  originalItemFacts,
  withOriginalItemFacts,
} = require('../../../src/services/business-item-origin');
const at = new Date('2026-09-29T01:00:00Z');
const sale = () => ({
  _id: 'a'.repeat(24),
  branch_id: 'b'.repeat(24),
  license: 'c'.repeat(24),
  sale_process: 'Add',
  date: new Date('2026-09-28T01:00:00Z'),
  sales_total: 9,
  items_return: [],
  items_return_total: 0,
  items: [
    {
      item_id: 'd'.repeat(24),
      item_name: 'Test item',
      item_unit: 'kg',
      item_quantity: '0.500',
      total_amount: '10.00',
    },
  ],
});
test('original item facts preserve scope, invoice date, decimal quantities and post-line-discount weights', () => {
  const source = sale(),
    result = originalItemFacts(source, at);
  expect(result).toEqual({
    schemaVersion: 1,
    saleId: source._id,
    branchId: source.branch_id,
    businessId: source.license,
    invoiceDate: source.date.toISOString(),
    capturedAt: at.toISOString(),
    salesTotal: '9',
    lines: [
      { itemId: 'd'.repeat(24), name: 'Test item', unit: 'kg', quantity: '0.5', grossAmount: '10' },
    ],
  });
  source.items[0].item_quantity = 0;
  expect(result.lines[0].quantity).toBe('0.5');
});
test('existing or ambiguous return history and contradictory aliases are never promoted to original facts', () => {
  for (const change of [
    { business_item_origin: {} },
    { sale_process: 'FullReturn' },
    { sale_process: 'PartialReturn' },
    { items_return: [{}] },
    { items_return_total: 1 },
    { return_refund_transactions: [{}] },
    { date: null },
    { date: '2026-09-28' },
    { items: [] },
    { sales_total: NaN },
  ])
    expect(originalItemFacts({ ...sale(), ...change }, at)).toBeNull();
  for (const line of [
    { quantity: 1 },
    { total: 1 },
    { item: 'e'.repeat(24) },
    { item_quantity: -1 },
    { item_quantity: 0.0001 },
  ]) {
    const source = sale();
    Object.assign(source.items[0], line);
    expect(originalItemFacts(source, at)).toBeNull();
  }
  const source = sale();
  Object.assign(source.items[0], { quantity: 0.5, total: 10, item: 'd'.repeat(24) });
  expect(originalItemFacts(source, at)).not.toBeNull();
});
test('origin joins the return write without changing it or exceeding BSON document limits', () => {
  const source = sale(),
    update = { $push: { items_return: { returnArray: { returnObjId: 'e'.repeat(24) } } } };
  const result = withOriginalItemFacts(source, update, at);
  expect(result.$set.business_item_origin.lines).toHaveLength(1);
  expect(result.$push).toBe(update.$push);
  expect(update.$set).toBeUndefined();
  expect(
    withOriginalItemFacts(
      { ...source, business_item_origin: result.$set.business_item_origin },
      update,
      at
    )
  ).toBe(update);
  expect(
    withOriginalItemFacts({ ...source, largeLegacyField: 'x'.repeat(16 * 1024 * 1024) }, update, at)
  ).toBe(update);
  const huge = sale();
  huge.items = Array.from({ length: 1000 }, () => ({
    ...huge.items[0],
    item_name: 'x'.repeat(300),
  }));
  expect(originalItemFacts(huge, at)).toBeNull();
});
