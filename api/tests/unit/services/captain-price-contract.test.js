'use strict';
const contract = require('../../../src/services/captain-price-contract');
const pricing = require('../../../src/services/pricing-authority');
const product = {
  _id: 'dish',
  name: 'Fresh Fruit Juice',
  selling_price: 45,
  tax: 5,
  tax_type: 'exclusive',
};
const base = { product, branch: {}, extras: 0, staffOrder: true };
const admit = (amount, overrides = {}) => {
  const context = { ...base, ...overrides, item: { item_price: amount } };
  return pricing.resolve({ ...context, submitted: contract.submittedPrice(context) });
};

test.each(['1.3.31', '1.3.32', '1.3.72', undefined])(
  'staff stale quotes do not block the kitchen (%s)',
  (version) => {
    const resolved = admit(47.25, { client: { app: 'captain', app_version: version } });
    expect(resolved.selling_price).toBe(45);
    expect(pricing.calculate(resolved, 2)).toMatchObject({
      unit_price: 45,
      total: 94.5,
      tax_amount: 4.5,
    });
  }
);

test.each([48, 1, 99999, 'NaN'])(
  'fixed staff lines use the catalogue instead of the submitted quote %s',
  (amount) => {
    expect(admit(amount).selling_price).toBe(45);
  }
);

test('public checkout still rejects changed or forged fixed prices', () => {
  expect(() => admit(47.25, { staffOrder: false })).toThrow(/does not match/);
  expect(() => admit('NaN', { staffOrder: false })).toThrow(/finite/);
  expect(admit(45, { staffOrder: false }).selling_price).toBe(45);
});

test('inclusive prices, modifiers and discounts are calculated once on the server', () => {
  expect(
    pricing.calculate(
      admit(999, { product: { ...product, selling_price: 30, tax_type: 'inclusive' } }),
      2
    ).total
  ).toBe(60);
  expect(pricing.calculate(admit(47.25, { extras: 20 }), 1).total).toBe(68.25);
  expect(
    pricing.calculate(admit(94.5, { product: { ...product, selling_price: 100 } }), 1, {}, 10).total
  ).toBe(94.5);
});

test('variable prices remain explicit and invalid variable prices still fail', () => {
  expect(admit(850, { product: { ...product, open_price: true } }).selling_price).toBe(850);
  expect(admit(60, { product: { ...product, item_status: 'instant' } }).selling_price).toBe(60);
  expect(() => admit(0, { product: { ...product, open_price: true } })).toThrow(
    /valid entered price/
  );
});
