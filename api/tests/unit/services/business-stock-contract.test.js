const { validateStockSummary } = require('../../../src/services/business-stock-contract');
const branch = { id: 'a'.repeat(24), license: 'b'.repeat(24) };
const now = () => Date.parse('2026-09-29T06:00:00.000Z');
const summary = () => ({
  schemaVersion: 1,
  metricDefinitionVersion: 'stored-stock-v1',
  license: branch.license,
  branchId: branch.id,
  observedFrom: '2026-09-29T05:59:59.000Z',
  preparedAt: '2026-09-29T06:00:00.000Z',
  sourceComplete: false,
  coverage: {
    scannedItems: 3,
    excludedItems: 1,
    verifiedItems: 1,
    unavailableItems: 1,
    reasons: { stock_tracking_unknown: 1 },
  },
  lowItemCount: 1,
  listTruncated: false,
  lowItems: [
    {
      itemId: 'c'.repeat(24),
      name: 'Rice',
      unit: 'kg',
      availableMilli: -125,
      thresholdMilli: 0,
      thresholdSource: 'item',
      low: true,
    },
  ],
});
const verify = (value) => validateStockSummary(value, branch, { now });
test('partial stock observations preserve negative quantities and explicit unknown coverage', () => {
  const value = summary();
  expect(verify(value)).toBe(value);
  const empty = summary();
  empty.coverage = {
    scannedItems: 0,
    excludedItems: 0,
    verifiedItems: 0,
    unavailableItems: 0,
    reasons: {},
  };
  empty.lowItemCount = 0;
  empty.lowItems = [];
  expect(verify(empty).sourceComplete).toBe(false);
});
test('scope, version, completeness and timestamps cannot be substituted', () => {
  for (const change of [
    { branchId: 'd'.repeat(24) },
    { license: 'd'.repeat(24) },
    { schemaVersion: 2 },
    { metricDefinitionVersion: 'future-stock' },
    { sourceComplete: true },
    { extra: 'hidden' },
    { preparedAt: '2026-09-29T06:00:00.001Z' },
    { observedFrom: '2026-09-29T06:00:01.000Z' },
    { observedFrom: '2026-09-29T05:59:44.000Z' },
    { preparedAt: '2026-09-29 06:00:00' },
  ])
    expect(() => verify({ ...summary(), ...change })).toThrow('invalid_stock_summary');
});
test('unknown rows cannot disappear from coverage or be disguised as verified healthy stock', () => {
  for (const change of [
    { scannedItems: 4 },
    { verifiedItems: 0 },
    { unavailableItems: 0 },
    { reasons: {} },
    { reasons: { unknown_future_reason: 1 } },
    { reasons: { stock_tracking_unknown: 0 } },
    { reasons: { stock_tracking_unknown: 2 } },
    { excludedItems: -1 },
    { scannedItems: 10001 },
    { scannedItems: '3' },
  ]) {
    const value = summary();
    Object.assign(value.coverage, change);
    expect(() => verify(value)).toThrow('invalid_stock_summary');
  }
});
test('stock rows reject unsafe quantities, extra fields, invented thresholds and missing units', () => {
  for (const change of [
    { availableMilli: 0.5 },
    { availableMilli: Number.MAX_SAFE_INTEGER + 1 },
    { availableMilli: 1 },
    { thresholdMilli: -1 },
    { thresholdSource: 'default' },
    { unit: '' },
    { name: ' Rice' },
    { low: false },
    { itemId: 'bad' },
    { secret: 'extra' },
  ]) {
    const value = summary();
    Object.assign(value.lowItems[0], change);
    expect(() => verify(value)).toThrow('invalid_stock_summary');
  }
});
test('bounded lists retain the full known low count and cannot hide missing or duplicate rows', () => {
  const value = summary();
  value.coverage = {
    scannedItems: 105,
    excludedItems: 0,
    verifiedItems: 105,
    unavailableItems: 0,
    reasons: {},
  };
  value.lowItemCount = 105;
  value.listTruncated = true;
  value.lowItems = Array.from({ length: 100 }, (_, i) => ({
    ...summary().lowItems[0],
    itemId: (i + 1).toString(16).padStart(24, '0'),
  }));
  expect(verify(value).lowItemCount).toBe(105);
  const broken = structuredClone(value);
  broken.lowItems[1].itemId = broken.lowItems[0].itemId;
  expect(() => verify(broken)).toThrow('invalid_stock_summary');
  expect(() => verify({ ...value, listTruncated: false })).toThrow('invalid_stock_summary');
  expect(() => verify({ ...value, lowItems: value.lowItems.slice(1) })).toThrow(
    'invalid_stock_summary'
  );
  expect(() => verify({ ...value, lowItems: [...value.lowItems].reverse() })).toThrow(
    'invalid_stock_summary'
  );
});
