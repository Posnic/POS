require('mongoose');

/*
 * A weighed quantity has to survive the schema, not just the screen.
 *
 * The till was fixed to keep grams and then the server refused the sale:
 * "Path `quantity` (0.3) is less than minimum allowed value (1)". The minimum
 * was one whole unit, which for anything sold by weight is one whole kilo - so
 * 300g of guava could be rung up, priced, and rejected at the moment of
 * payment, after the customer had handed over the money.
 *
 * These tests validate against the real schemas rather than a copy, so the rule
 * cannot be tightened back without something failing here.
 */

describe('a sale line accepts a weight', () => {
  let Sale;

  beforeAll(() => {
    jest.resetModules();
    Sale = require('../../../src/models/sale.model');
    Sale = Sale.Sale || Sale;
  });

  const minimumOf = (model, path) => {
    const schemaPath = model.schema.path(path);
    const validators = (schemaPath && schemaPath.validators) || [];
    const min = validators.find((v) => v.type === 'min');
    return min ? min.min : undefined;
  };

  it('allows three hundred grams', () => {
    // The exact quantity that was refused on a live counter.
    const min = minimumOf(Sale, 'items.quantity');
    expect(min).toBeLessThanOrEqual(0.3);
  });

  it('allows a single gram, which is what the scale reports', () => {
    const min = minimumOf(Sale, 'items.quantity');
    expect(min).toBeLessThanOrEqual(0.001);
  });

  it('still refuses nothing at all', () => {
    // A line of zero is not a sale, and negatives are a returns concern with
    // its own path.
    const min = minimumOf(Sale, 'items.quantity');
    expect(min).toBeGreaterThan(0);
  });
});

describe('a purchase line accepts a weight', () => {
  it('allows a fraction of a unit', () => {
    // Stock arrives by weight too - 2.5kg of tomatoes is an ordinary delivery.
    jest.resetModules();
    let Receiving = require('../../../src/models/receiving.model');
    Receiving = Receiving.Receiving || Receiving;

    const path =
      Receiving.schema.path('items.quantity') ||
      (Receiving.schema.path('items') &&
        Receiving.schema.path('items').schema &&
        Receiving.schema.path('items').schema.path('quantity'));

    const validators = (path && path.validators) || [];
    const min = validators.find((v) => v.type === 'min');
    expect(min).toBeDefined();
    expect(min.min).toBeLessThanOrEqual(0.001);
    expect(min.min).toBeGreaterThan(0);
  });
});
