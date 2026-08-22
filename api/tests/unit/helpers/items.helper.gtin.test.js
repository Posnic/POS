'use strict';

const { sanitizeItemData } = require('../../../src/helpers/items.helper');

/*
 * sanitizeItemData is the single funnel every item create and edit passes
 * through, which makes it the only place the GTIN rule can be enforced once.
 *
 * The rule: a gtin is stored only when it validates, and gtin14 is DERIVED
 * from it rather than accepted. Both matter. A caller that could set gtin14
 * directly could make one product match another.
 */
describe('sanitizeItemData - gtin', () => {
  test('a valid barcode is stored with its comparison form', () => {
    const out = sanitizeItemData({ gtin: '5000159484695' });
    expect(out.gtin).toBe('5000159484695');
    expect(out.gtin14).toBe('05000159484695');
  });

  test('spacing and hyphens survive being pasted', () => {
    expect(sanitizeItemData({ gtin: '5-000159-484695' }).gtin).toBe('5000159484695');
  });

  test('an invalid barcode CLEARS the field rather than being ignored', () => {
    /*
     * Leaving the previous value would mean a shop that corrected a mistyped
     * barcode still has the wrong global identifier attached - which is exactly
     * the error a shared database cannot recover from, because everyone who
     * matched against it has already inherited it.
     */
    const out = sanitizeItemData({ gtin: '5000159484694' });
    expect(out.gtin).toBe('');
    expect(out.gtin14).toBe('');
  });

  test('clearing the field clears both', () => {
    const out = sanitizeItemData({ gtin: '' });
    expect(out.gtin).toBe('');
    expect(out.gtin14).toBe('');
  });

  test('an item that never mentions gtin is left alone', () => {
    /* An edit that does not touch the field must not erase it. */
    const out = sanitizeItemData({ name: 'Rice' });
    expect(out).not.toHaveProperty('gtin');
    expect(out).not.toHaveProperty('gtin14');
  });

  test('the comparison form cannot be supplied by the caller', () => {
    /* gtin14 is what two products are matched on. A caller able to set it
       could make one product answer to another product's identity. */
    const forged = sanitizeItemData({ gtin: '5000159484695', gtin14: 'FORGED' });
    expect(forged.gtin14).toBe('05000159484695');

    const alone = sanitizeItemData({ gtin14: 'FORGED' });
    expect(alone).not.toHaveProperty('gtin14');
  });

  test('an in-store code is stored, because it is the shop real barcode', () => {
    /* Storing is right; PUBLISHING is not. The scope distinction lives in
       utils/gtin.js and is applied by whatever exports, not here. */
    const out = sanitizeItemData({ gtin: '2012345678903' });
    expect(out.gtin).toBe('2012345678903');
  });

  test('barcode_id is never promoted to a gtin', () => {
    /* barcode_id may be an in-store code, a supplier reference or free text.
       Promoting it is how a public database gets poisoned. */
    const out = sanitizeItemData({ barcode_id: '5000159484695' });
    expect(out).not.toHaveProperty('gtin');
  });
});
