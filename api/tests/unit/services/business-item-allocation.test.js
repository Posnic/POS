const {
  allocateItemRevenue,
  MAX_LINES,
} = require('../../../src/services/business-item-allocation');
const a = 'a'.repeat(24),
  b = 'b'.repeat(24),
  c = 'c'.repeat(24);
const line = (itemId, grossMinor) => ({ itemId, grossMinor });

test('header discounts and rounding allocate exactly and consistently across reordered or split lines', () => {
  const expected = [
    { itemId: a, amountMinor: 34 },
    { itemId: b, amountMinor: 33 },
    { itemId: c, amountMinor: 33 },
  ];
  expect(allocateItemRevenue(100, [line(c, 100), line(a, 100), line(b, 100)])).toEqual(expected);
  expect(
    allocateItemRevenue(100, [line(a, 40), line(b, 100), line(a.toUpperCase(), 60), line(c, 100)])
  ).toEqual(expected);
  expect(allocateItemRevenue(301, [line(a, 100), line(b, 200)])).toEqual([
    { itemId: a, amountMinor: 100 },
    { itemId: b, amountMinor: 201 },
  ]);
});

test('zero and three-decimal minor units and free items preserve the recorded total', () => {
  expect(allocateItemRevenue(1234, [line(a, 1000), line(b, 1000), line(c, 0)])).toEqual([
    { itemId: a, amountMinor: 617 },
    { itemId: b, amountMinor: 617 },
    { itemId: c, amountMinor: 0 },
  ]);
  expect(allocateItemRevenue(0, [line(a, 0), line(b, 0)])).toEqual([
    { itemId: a, amountMinor: 0 },
    { itemId: b, amountMinor: 0 },
  ]);
  expect(allocateItemRevenue(0, [line(a, 500)])[0].amountMinor).toBe(0);
});

test('large values use exact products even when the sum of weights exceeds safe integer arithmetic', () => {
  const n = Number.MAX_SAFE_INTEGER;
  const rows = allocateItemRevenue(n, [line(b, n), line(a, n)]);
  expect(rows).toEqual([
    { itemId: a, amountMinor: 4503599627370496 },
    { itemId: b, amountMinor: 4503599627370495 },
  ]);
  expect(rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)).toBe(BigInt(n));
});

test('bounded exhaustive small allocations conserve cents and keep each share within one unit of its exact proportion', () => {
  for (let x = 0; x <= 9; x++)
    for (let y = 0; y <= 9; y++) {
      if (!x && !y) continue;
      for (let amount = 0; amount <= 19; amount++) {
        const rows = allocateItemRevenue(amount, [line(a, x), line(b, y)]);
        expect(rows.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(amount);
        for (const [index, weight] of [x, y].entries())
          expect(Math.abs(rows[index].amountMinor * (x + y) - amount * weight)).toBeLessThan(x + y);
      }
    }
});

test('invalid money, IDs, unassignable totals and unbounded line lists are rejected', () => {
  for (const amount of [-1, 1.5, NaN, Infinity, '100', Number.MAX_SAFE_INTEGER + 1])
    expect(() => allocateItemRevenue(amount, [line(a, 1)])).toThrow('invalid_item_allocation');
  for (const lines of [
    null,
    [],
    [line('constructor', 1)],
    [line(a, -1)],
    [line(a, 0.5)],
    [line(a, NaN)],
    [line(a, 0)],
    Array.from({ length: MAX_LINES + 1 }, () => line(a, 1)),
  ])
    expect(() => allocateItemRevenue(1, lines)).toThrow('invalid_item_allocation');
});
