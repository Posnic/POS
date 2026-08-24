'use strict';

const demo = require('../../../utils/demoData');

/*
 * Which demo pack a new shop receives.
 *
 * THE BUG THIS EXISTS FOR: the vocabulary is not ours alone. The business type
 * arrives from the cloud signup, whose list is retail, supermarket, restaurant,
 * cafe, bakery, pharmacy, hardware, electronics, textile, other. This file was
 * written against a different list, and the two disagreed silently -
 * "electronics" matched nothing, so the electrical pack was unreachable and an
 * electronics shop was handed groceries.
 *
 * Silent because the default returns something plausible. Every shop got a
 * supermarket, which reads as a decision rather than a miss, and two of the
 * seven packs could not be reached by any real signup at all.
 *
 * So these tests are written against the SIGNUP's words, not this module's.
 */

const packName = (() => {
  const byRef = new Map([
    [demo.iceCreamDemoData, 'iceCream'],
    [demo.cafeDemoData, 'cafe'],
    [demo.bakeryDemoData, 'bakery'],
    [demo.supermarketDemoData, 'supermarket'],
    [demo.textileDemoData, 'textile'],
    [demo.electricalDemoData, 'electrical'],
    [demo.hardwareDemoData, 'hardware'],
  ]);
  return (t) => byRef.get(demo.getDemoDataByType(t)) || 'UNKNOWN';
})();

/* The exact list in web-api's BUSINESS_TYPES. If that list changes, this one
   must too - which is the point of writing it out rather than importing it. */
const SIGNUP_TYPES = [
  'retail',
  'supermarket',
  'restaurant',
  'cafe',
  'bakery',
  'pharmacy',
  'hardware',
  'electronics',
  'textile',
  'other',
];

describe('getDemoDataByType', () => {
  describe('every word the signup can send', () => {
    test.each(SIGNUP_TYPES)('%s resolves to a real pack', (type) => {
      const pack = demo.getDemoDataByType(type);
      expect(pack).toBeTruthy();
      expect(Array.isArray(pack.categories)).toBe(true);
      expect(pack.categories.length).toBeGreaterThan(0);
      expect(Array.isArray(pack.products)).toBe(true);
      expect(pack.products.length).toBeGreaterThan(0);
    });

    test('an electronics shop gets the electrical pack, not groceries', () => {
      /* The original bug, named. */
      expect(packName('electronics')).toBe('electrical');
    });

    test('a restaurant gets prepared food, not groceries', () => {
      /* The cafe pack is drinks and made-to-order food, which is nearer to a
         restaurant than a supermarket shelf. */
      expect(packName('restaurant')).toBe('cafe');
    });

    test('trades with no pack of their own fall back, and say so by behaviour', () => {
      /* retail, pharmacy and other have no pack yet. A supermarket set fits a
         general shop, so the fallback is a real answer rather than an error. */
      for (const t of ['retail', 'pharmacy', 'other']) {
        expect(packName(t)).toBe('supermarket');
      }
    });
  });

  describe('packs that were unreachable', () => {
    test('the ice cream pack can be selected', () => {
      expect(packName('icecream')).toBe('iceCream');
      expect(packName('ice cream')).toBe('iceCream');
    });

    test('the electrical pack can be selected by either word', () => {
      expect(packName('electrical')).toBe('electrical');
      expect(packName('electronics')).toBe('electrical');
    });
  });

  describe('normalising the input', () => {
    test('case and surrounding space do not change the answer', () => {
      expect(packName('Cafe')).toBe('cafe');
      expect(packName('  BAKERY  ')).toBe('bakery');
      expect(packName(' Electronics ')).toBe('electrical');
    });

    test('nothing at all still returns a usable pack', () => {
      for (const v of [null, undefined, '', '   ', 42, {}]) {
        const pack = demo.getDemoDataByType(v);
        expect(pack).toBeTruthy();
        expect(pack.products.length).toBeGreaterThan(0);
      }
    });

    test('an unknown trade does not throw or return nothing', () => {
      expect(packName('locksmith')).toBe('supermarket');
    });
  });

  describe('the packs themselves', () => {
    const ALL = [
      'iceCreamDemoData',
      'cafeDemoData',
      'bakeryDemoData',
      'supermarketDemoData',
      'textileDemoData',
      'electricalDemoData',
      'hardwareDemoData',
    ];

    test.each(ALL)('%s has categories and products that agree', (name) => {
      const pack = demo[name];
      const categories = new Set(pack.categories.map((c) => c.name));
      for (const p of pack.products) {
        /* A product whose category is not in the pack is dropped by the
           installer - it checks categoryMap - so it would simply never
           appear, with nothing to say why. */
        expect(categories.has(p.category)).toBe(true);
      }
    });

    test.each(ALL)('%s prices and stock are numbers, not strings', (name) => {
      for (const p of demo[name].products) {
        expect(typeof p.price).toBe('number');
        expect(Number.isFinite(p.price)).toBe(true);
        expect(p.price).toBeGreaterThan(0);
        expect(typeof p.stock).toBe('number');
      }
    });

    test.each(ALL)('%s has no duplicate product names', (name) => {
      /* Two identical names in one shop is the same confusion as two variants
         sharing a value: nothing on screen tells them apart. */
      const names = demo[name].products.map((p) => p.name.trim().toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    });
  });
});
