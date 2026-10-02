'use strict';
const contract = require('../../../src/services/captain-price-contract');
const pricing = require('../../../src/services/pricing-authority');
const product = { _id: 'dish', name: 'Paratha', selling_price: 45, tax: 5, tax_type: 'exclusive' };
const base = { product, branch: {}, extras: 0, staffOrder: true, client: { app: 'captain', app_version: '1.3.32 (73a4d0e)' } };
const submit = (amount, overrides = {}) => contract.submittedPrice({ ...base, item: { item_price: amount }, ...overrides });

test('released Captain gross amount is validated then taxed once', () => {
  const submitted = submit(47.25);
  expect(submitted).toBe(45);
  expect(pricing.calculate(pricing.resolve({ product, submitted }), 2)).toMatchObject({ unit_price: 45, total: 94.5, tax_amount: 4.5 });
});
test('legacy stale and arbitrary prices remain errors', () => {
  expect(() => submit(48)).toThrow(/does not match/);
  expect(() => submit(45)).toThrow(/does not match/);
  expect(() => submit('NaN')).toThrow(/finite/);
});
test.each([
  { staffOrder: false }, { client: {} },
  { client: { app: 'mobile-pos', app_version: '1.3.32' } },
  { client: { app: 'captain', app_version: '1.3.33' } },
  { item: { item_price: 47.25, price_basis: 'selling_price' } },
])('other contracts retain strict selling-price validation: %j', overrides => {
  const submitted = submit(47.25, overrides);
  expect(() => pricing.resolve({ product, submitted })).toThrow(/does not match/);
});
test('inclusive water and discounted dish use the server menu quote', () => {
  expect(submit(30, { product: { ...product, selling_price: 30, tax_type: 'inclusive' } })).toBe(30);
  expect(submit(94.5, { product: { ...product, selling_price: 100, discount_amount: 10 } })).toBe(100);
});
test('variable and quick quotes remain entered prices', () => {
  expect(submit(850, { product: { ...product, open_price: true } })).toBe(850);
  expect(submit(60, { product: { ...product, item_status: 'instant' } })).toBe(60);
});
test('validated modifiers are applied once after legacy menu validation', () => {
  expect(submit(47.25, { extras: 20 })).toBe(65);
});
