const tables = require('../../../src/utils/table-details');
test('legacy tables remain usable until capacity is configured', () => {
  expect(tables.view({})).toEqual({ capacity: 0, max_capacity: 0, area: '', shape: 'square' });
  expect(tables.accommodates({}, 12)).toBe(true);
  expect(tables.update({ tableorder_value: 'T1' }, { capacity: 4 })).toEqual({});
});
test('normal seats and maximum seats have separate valid limits', () => {
  const row = tables.update({ capacity: '4', max_capacity: '6', area: ' Garden ', shape: 'round' });
  expect(row).toEqual({ capacity: 4, max_capacity: 6, area: 'Garden', shape: 'round' });
  expect(tables.accommodates(row, 6)).toBe(true);
  expect(tables.accommodates(row, 7)).toBe(false);
  expect(() => tables.update({ capacity: '8', max_capacity: '4' })).toThrow();
  expect(() => tables.update({ capacity: '1.5' })).toThrow();
  expect(() => tables.update({ capacity: '1001' })).toThrow();
  expect(() => tables.update({ shape: 'script' })).toThrow();
});
