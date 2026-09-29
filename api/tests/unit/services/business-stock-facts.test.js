const { stockFact } = require('../../../src/services/business-stock-facts');
const branch = { id: 'a'.repeat(24), license: 'b'.repeat(24), notificationRange: '5' };
const item = () => ({
  _id: 'c'.repeat(24),
  license: branch.license,
  branch_id: branch.id,
  branch_access: [{ branch_id: branch.id }],
  name: 'Rice',
  unit: 'kg',
  item_status: 'regular',
  track_inventory: true,
  available_quantity: '5',
});
test('stock facts preserve exact unit quantities and item threshold precedence including zero', () => {
  expect(stockFact(item(), branch)).toMatchObject({
    availableMilli: 5000,
    thresholdMilli: 5000,
    thresholdSource: 'branch',
    low: true,
  });
  expect(
    stockFact({ ...item(), available_quantity: '1.125', reorder_point: '1.124' }, branch)
  ).toMatchObject({
    availableMilli: 1125,
    thresholdMilli: 1124,
    thresholdSource: 'item',
    low: false,
  });
  expect(
    stockFact({ ...item(), available_quantity: '-0.125', reorder_point: 0 }, branch)
  ).toMatchObject({ availableMilli: -125, thresholdMilli: 0, low: true });
});
test('unknown quantities or thresholds never become zero or a guessed reorder level', () => {
  for (const value of [
    null,
    undefined,
    '',
    'abc',
    '1e3',
    Infinity,
    NaN,
    true,
    '0.0001',
    Number.MAX_SAFE_INTEGER,
    1000000000000.0001,
  ])
    expect(() => stockFact({ ...item(), available_quantity: value }, branch)).toThrow();
  for (const value of ['', 'bad', -1, false, '1.0001'])
    expect(() => stockFact({ ...item(), reorder_point: value }, branch)).toThrow();
  expect(() => stockFact(item(), { ...branch, notificationRange: null })).toThrow(
    'stock_threshold_unconfigured'
  );
});
test('scope is exact and shared catalogue access does not invent branch stock', () => {
  expect(() => stockFact({ ...item(), license: 'd'.repeat(24) }, branch)).toThrow(
    'invalid_stock_scope'
  );
  expect(() =>
    stockFact({ ...item(), branch_id: 'd'.repeat(24), branch_access: [] }, branch)
  ).toThrow('invalid_stock_scope');
  expect(() =>
    stockFact({ ...item(), branch_access: [{ branch_id: 'd'.repeat(24) }] }, branch)
  ).toThrow('ambiguous_branch_stock');
  const legacy = item();
  delete legacy.branch_id;
  expect(stockFact(legacy, branch).low).toBe(true);
});
test('deleted, nontracked and inactive products are excluded while unknown tracking and units fail', () => {
  for (const changed of [
    { del_status: 1 },
    { del_status: '1' },
    { del_status: true },
    { track_inventory: false },
    { item_status: 'instant' },
    { item_status: 'inactive' },
    { item_status: 'draft' },
  ])
    expect(stockFact({ ...item(), ...changed }, branch)).toBeNull();
  for (const changed of [
    { track_inventory: undefined },
    { track_inventory: 'yes' },
    { unit: '' },
    { item_status: 'unknown' },
  ])
    expect(() => stockFact({ ...item(), ...changed }, branch)).toThrow();
});
