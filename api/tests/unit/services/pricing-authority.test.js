'use strict';
const pricing = require('../../../src/services/pricing-authority');
const product = {
  _id: 'paratha',
  name: 'Paratha',
  selling_price: 45,
  tax: 5,
  tax_type: 'exclusive',
};
const quote = (changes = {}) => pricing.resolve({ product, ...changes });

test('rejects the exact double-tax receipt input and never silently substitutes a price', () => {
  expect(() => quote({ submitted: 47.25 })).toThrow(/does not match/);
  expect(pricing.calculate(quote({ submitted: 45 }), 2)).toMatchObject({
    unit_price: 45,
    total: 94.5,
    tax_amount: 4.5,
  });
});
test('inclusive water stays 30 including tax, including after quantity changes', () => {
  const q = quote({
    product: { ...product, selling_price: 30, tax_type: 'inclusive' },
    submitted: 30,
  });
  expect(pricing.calculate(q, 2)).toMatchObject({ total: 60, tax_amount: 2.86 });
});
test('a channel label does not authorize an arbitrary price', () => {
  expect(() => quote({ channel: 'online', submitted: 60 })).toThrow(/does not match/);
});
test('configured outlet and customer prices are enforced', () => {
  expect(quote({ outlet: { id: 'room', markup_percent: 20 }, submitted: 54 }).source).toBe(
    'outlet'
  );
  expect(() => quote({ outlet: { id: 'room', markup_percent: 20 }, submitted: 45 })).toThrow();
  expect(
    quote({ priceList: { _id: 'wholesale', percent_off: 10 }, submitted: 40.5 }).selling_price
  ).toBe(40.5);
});
test('stored snapshots preserve agreed price and tax after catalogue edits', () => {
  const previous = { pricing: quote() };
  expect(
    quote({ product: { ...product, selling_price: 60, tax: 18 }, previous, submitted: 45 })
  ).toEqual(previous.pricing);
  expect(() => quote({ previous, submitted: 1 })).toThrow();
});
test.each(['variable', 'quick'])('%s is explicit and bounded', (kind) => {
  const p = {
    ...product,
    ...(kind === 'quick' ? { item_status: 'instant' } : { open_price: true }),
  };
  expect(quote({ product: p, submitted: 250 }).selling_price).toBe(250);
  for (const invalid of [
    ...(kind === 'quick' ? [] : [undefined]),
    '',
    null,
    -1,
    0,
    NaN,
    Infinity,
    1000001,
    true,
    {},
  ])
    expect(() => quote({ product: p, submitted: invalid })).toThrow();
});
test('modifiers are part of the validated price before tax', () => {
  const q = quote({ extras: 10, submitted: 55 });
  expect(pricing.calculate(q, 2)).toMatchObject({ total: 115.5, tax_amount: 5.5 });
});
test('unknown venue configuration on a local server fails closed', async () => {
  const db = { collection: () => ({ findOne: async () => null }) };
  await expect(pricing.loadContext(db, { venue: { venue_code: 'missing' } })).rejects.toMatchObject(
    { code: 'pricing_rule_unavailable' }
  );
});

test('menu quote and admission share exclusive/inclusive/venue/discount arithmetic', () => {
  for (const tax_type of ['exclusive', 'inclusive']) {
    const p = { ...product, selling_price: 130, tax_type, discount_amount: 10 };
    const venue = { code: 'hotel', price_adjust_percent: 20 };
    const menu = pricing.menuQuote(p, {}, venue);
    const accepted = pricing.resolve({ product: p, submitted: menu.price, venue });
    expect(pricing.calculate(accepted, 1, {}, 10).total).toBe(menu.final_price);
    expect(menu.price_basis).toBe('selling_price');
  }
});
test('inclusive quantity subtotal reconciles even when the rounded unit does not multiply exactly', () => {
  const p = quote({ product: { ...product, selling_price: 30, tax_type: 'inclusive' } });
  const line = pricing.calculate(p, 99);
  expect(line.total).toBe(2970);
  expect(line.item_subtotal + line.tax_amount).toBeCloseTo(line.total, 2);
});
