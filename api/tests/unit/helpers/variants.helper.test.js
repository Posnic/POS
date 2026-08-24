'use strict';

const { normalizeVariantFields } = require('../../../src/helpers/variants.helper');

/*
 * A variant's values are a SET. The bug these cover: "Size" saved as 38, 40, 40
 * offered 40 twice in the item form, both copies were selectable, and saving
 * created two items called "Shirt / 40" - identical names, separate stock, and
 * nothing to say which one a barcode meant.
 */
describe('normalizeVariantFields', () => {
  const names = (input) => normalizeVariantFields(input).map((f) => f.name);

  test('a repeated value is kept once', () => {
    expect(names(['38', '40', '40'])).toEqual(['38', '40']);
  });

  test('duplicates are matched ignoring case and surrounding space', () => {
    /* Someone typing "Red" and " red " meant one colour, not two. */
    expect(names(['Red', ' red ', 'RED', 'Blue'])).toEqual(['Red', 'Blue']);
  });

  test('the first spelling is the one that survives', () => {
    /* The shop's own capitalisation is on its printed labels. Keeping the
       later entry would let a stray lowercase typo rename an existing value. */
    expect(names(['XL', 'xl'])).toEqual(['XL']);
  });

  test('blank and whitespace-only entries are dropped, not stored as empty', () => {
    expect(names(['40', '', '   ', null, undefined, '42'])).toEqual(['40', '42']);
  });

  test('values that merely LOOK alike are both kept', () => {
    /* Over-eager matching is the worse failure: silently losing a real size
       is invisible until someone cannot sell it. */
    expect(names(['40', '40.5', '400', '4 0'])).toEqual(['40', '40.5', '400', '4 0']);
  });

  test('objects and plain strings are both accepted', () => {
    /* Stored fields are {name}; the form posts strings. Both reach this. */
    expect(names([{ name: 'S' }, 'M', { name: ' s ' }])).toEqual(['S', 'M']);
  });

  test('the result is always the {name} shape the model stores', () => {
    expect(normalizeVariantFields(['S'])).toEqual([{ name: 'S' }]);
  });

  test('a non-array is an empty list, not a crash', () => {
    expect(normalizeVariantFields(undefined)).toEqual([]);
    expect(normalizeVariantFields(null)).toEqual([]);
    expect(normalizeVariantFields('40')).toEqual([]);
  });

  test('the input is left alone', () => {
    const input = ['40', '40'];
    normalizeVariantFields(input);
    expect(input).toEqual(['40', '40']);
  });
});
