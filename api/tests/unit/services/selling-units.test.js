const units = require('../../../src/helpers/selling-units');
const pipe = {
  unit: 'm',
  selling_price: 100,
  selling_units: [{ unit: 'ft', factor: 0.3048, price: 32 }],
};
test('feet use an explicit conversion and returns retain the sale snapshot', () => {
  const snapshot = units.resolve(pipe, 'ft');
  expect(snapshot).toMatchObject({ unit: 'ft', base_unit: 'm', factor: 0.3048, price: 32 });
  expect(units.stockQuantity({ unit_conversion: snapshot }, 10)).toBe(3.048);
  expect(units.stockQuantity({ unit_conversion: snapshot }, 2)).toBe(0.6096);
  expect(
    units.resolve({ ...pipe, selling_units: [] }, 'ft', { unit_conversion: snapshot })
  ).toEqual(snapshot);
  expect(() => units.resolve(pipe, 'm', { unit_conversion: snapshot })).toThrow(
    /original selling unit/
  );
});
test('base-unit and historical lines retain their quantity convention', () => {
  expect(units.resolve(pipe, 'm').factor).toBe(1);
  expect(units.stockQuantity({ item_quantity: 2.5 })).toBe(2.5);
  expect(() => units.resolve(pipe, 'ft', { item_unit: 'm' })).toThrow();
});
test('invalid or duplicate configurations cannot silently change stock', () => {
  for (const value of [
    [{ unit: 'm', factor: 1 }],
    [{ unit: 'ft', factor: 0 }],
    [{ unit: 'ft', factor: -1 }],
    [{ unit: 'ft', factor: 0.3048, price: -5 }],
  ]) {
    expect(() => units.normalize(value, 'm')).toThrow();
  }
  expect(() => units.resolve(pipe, 'yard')).toThrow();
  expect(units.normalize([{ unit: 'ft', factor: 0.3048, price: '' }], 'm')[0].price).toBe(null);
});

test('removing the last alternate unit rejects stale new sales without changing historical conversions', () => {
  const saved = units.resolve(pipe, 'ft');
  for (const product of [{ ...pipe, selling_units: [] }, { unit: 'm' }]) {
    expect(() => units.resolve(product, 'ft')).toThrow(/no longer configured/);
    expect(units.resolve(product, undefined)).toEqual({ unit: 'm', base_unit: 'm', factor: 1 });
    expect(units.resolve(product, 'm').factor).toBe(1);
    expect(units.resolve(product, 'ft', { unit_conversion: saved })).toEqual(saved);
    expect(units.stockQuantity({ unit_conversion: saved }, 10)).toBe(3.048);
  }
});

test('whole lengths reject fractions and keep their constraint after catalogue changes', () => {
  const product = {
    unit: 'm',
    selling_units: [{ unit: 'length', factor: 6, price: 550, whole_units: true }],
  };
  const snapshot = units.resolve(product, 'length');
  expect(units.stockQuantity({ unit_conversion: snapshot }, 2)).toBe(12);
  expect(() => units.stockQuantity({ unit_conversion: snapshot }, 0.5)).toThrow(/whole number/);
  const old = units.resolve({ unit: 'm' }, 'length', { unit_conversion: snapshot });
  expect(old.whole_units).toBe(true);
});
