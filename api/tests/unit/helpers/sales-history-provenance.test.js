const filter = require('../../../src/helpers/sales-history-provenance');
test('staff and devices are literal text, not executable query or regex input', () => {
  expect(JSON.stringify(filter({ ordered_by: 'a.*', order_device: '[x]' }))).toContain(
    'a\\.\\*'.replace(/\\/g, '\\\\')
  );
  expect(() => filter({ ordered_by: { $ne: null } })).toThrow();
  expect(() => filter({ order_device: 'x'.repeat(121) })).toThrow();
  expect(() => filter({ order_source: 'unknown' })).toThrow();
  expect(filter({})).toEqual([]);
});
test('source filtering includes legacy channel records', () => {
  expect(JSON.stringify(filter({ order_source: 'tableside' }))).toContain('Table-Order');
});
