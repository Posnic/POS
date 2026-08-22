'use strict';

const jsonld = require('../../../src/utils/product-jsonld');

const variant = (over = {}) => ({
  _id: 'a1',
  name: 'Shirt / L',
  itemid: 'SH-L',
  selling_price: 499,
  track_inventory: true,
  available_quantity: 5,
  variant_group_id: 'g1',
  variant_parent_name: 'Shirt',
  variant_axis: 'size',
  variant_value: 'L',
  ...over,
});

/*
 * The export exists to be consumed by somebody who cannot ask us questions.
 *
 * That is why most of these tests are about what it REFUSES to say. A missing
 * field costs a consumer one lookup; a confidently wrong one costs them their
 * own data, and us the trust that makes a shared database worth having.
 */
describe('product-jsonld', () => {
  describe('the two rules', () => {
    test('barcode_id NEVER becomes a gtin', () => {
      /*
       * barcode_id may be an in-store code, a supplier reference, or free text.
       * Promoting it would publish a number claiming to identify a product it
       * does not - and everyone matching against it inherits the error.
       */
      const out = jsonld.product({ name: 'Rice', barcode_id: '5000159484695' });
      expect(out.gtin).toBeUndefined();
      expect(out.gtin13).toBeUndefined();
      expect(JSON.stringify(out)).not.toContain('5000159484695');
    });

    test('an invalid gtin is omitted rather than passed through', () => {
      const out = jsonld.product({ name: 'Rice', gtin: '5000159484694' });
      expect(out.gtin).toBeUndefined();
    });

    test('a valid gtin appears both generically and by length', () => {
      /* Older consumers read gtin13; the vocabulary is moving to plain gtin. */
      const out = jsonld.product({ name: 'Rice', gtin: '5000159484695' });
      expect(out.gtin).toBe('5000159484695');
      expect(out.gtin13).toBe('5000159484695');
    });

    test('empty and absent fields are dropped, never defaulted', () => {
      /* No `weight: 0`, no invented currency. An absent field is honest; a
         defaulted one is a lie a machine will act on. */
      const out = jsonld.product({ name: 'Rice', description: '', brand: '', itemid: null });
      expect(out).not.toHaveProperty('description');
      expect(out).not.toHaveProperty('brand');
      expect(out).not.toHaveProperty('sku');
      expect(out.offers).not.toHaveProperty('priceCurrency');
    });
  });

  describe('availability', () => {
    test('an item that does not track stock states no availability', () => {
      /*
       * Saying OutOfStock because a field nobody maintains reads 0 would take a
       * product off the shelf in somebody else's system.
       */
      expect(jsonld.availability({ track_inventory: false, available_quantity: 0 })).toBeNull();
      const out = jsonld.product({ name: 'Rice', track_inventory: false });
      expect(out.offers).not.toHaveProperty('availability');
    });

    test('a tracked item reports in or out of stock', () => {
      expect(jsonld.availability({ track_inventory: true, available_quantity: 3 }))
        .toBe('https://schema.org/InStock');
      expect(jsonld.availability({ track_inventory: true, available_quantity: 0 }))
        .toBe('https://schema.org/OutOfStock');
    });

    test('an unreadable quantity states nothing', () => {
      expect(jsonld.availability({ track_inventory: true, available_quantity: 'many' })).toBeNull();
    });
  });

  describe('grouping', () => {
    test('a family becomes one ProductGroup with its variants inside', () => {
      const out = jsonld.serialize([variant(), variant({ _id: 'a2', variant_value: 'M' })]);
      expect(out['@graph']).toHaveLength(1);
      const g = out['@graph'][0];
      expect(g['@type']).toBe('ProductGroup');
      expect(g.productGroupID).toBe('g1');
      expect(g.name).toBe('Shirt');
      expect(g.variesBy).toEqual(['size']);
      expect(g.hasVariant).toHaveLength(2);
    });

    test('grouping is by id, never by name', () => {
      /* Two products can share a name. Grouping on it merges unrelated things
         and is the kind of error nobody notices until a customer does. */
      const out = jsonld.serialize([
        variant({ variant_group_id: 'g1' }),
        variant({ _id: 'b1', variant_group_id: 'g2', variant_value: 'M' }),
      ]);
      /* Two families of one each - so both fall back to plain Products. */
      expect(out['@graph'].every((n) => n['@type'] === 'Product')).toBe(true);
      expect(out['@graph']).toHaveLength(2);
    });

    test('a family of one is not a family', () => {
      /* A group with a single variant tells a consumer there are choices when
         there are none. */
      const out = jsonld.serialize([variant()]);
      expect(out['@graph'][0]['@type']).toBe('Product');
    });

    test('items with no family stay plain Products', () => {
      const out = jsonld.serialize([{ _id: 'x', name: 'Rice', selling_price: 80 }]);
      expect(out['@graph'][0]['@type']).toBe('Product');
    });

    test('the group carries no gtin', () => {
      /* Correct per the spec: a GTIN identifies a trade item, and a product
         concept in the abstract is not one. */
      const out = jsonld.serialize([
        variant({ gtin: '5000159484695' }),
        variant({ _id: 'a2', variant_value: 'M', gtin: '0036000291452' }),
      ]);
      const g = out['@graph'][0];
      expect(g).not.toHaveProperty('gtin');
      expect(g.hasVariant[0].gtin).toBe('5000159484695');
    });
  });

  describe('the variant axis', () => {
    test('the axis and its value are stated, not guessed at', () => {
      /*
       * variant_value is a display string. For one axis, mapping it to
       * schema.org's `size` or `color` is a guess at what the shop's axis name
       * means; for two it cannot be split at all, because the separator is a
       * legal character inside a value. Stating axis and value honestly beats
       * inventing structure that is wrong.
       */
      const out = jsonld.product(variant());
      const prop = out.additionalProperty.find((p) => p.name === 'size');
      expect(prop.value).toBe('L');
      expect(out).not.toHaveProperty('size');
    });
  });

  describe('shape', () => {
    test('the document is a valid JSON-LD graph', () => {
      const out = jsonld.serialize([variant()]);
      expect(out['@context']).toBe('https://schema.org');
      expect(Array.isArray(out['@graph'])).toBe(true);
    });

    test('nothing is emitted for an empty catalogue', () => {
      expect(jsonld.serialize([])['@graph']).toEqual([]);
      expect(jsonld.serialize(null)['@graph']).toEqual([]);
    });
  });
});
