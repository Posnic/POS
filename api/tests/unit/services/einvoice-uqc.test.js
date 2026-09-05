'use strict';

/*
 * Unit Quantity Codes (INDIA_EINVOICING_DESIGN.md PR 2).
 *
 * Two things are worth pinning, and the second is the one that will be
 * argued about:
 *
 *   - the units this application actually seeds into a new shop must map,
 *     or the feature is unusable on day one for a shop that changed nothing;
 *   - a unit nobody can map must produce NOTHING, not OTH. Sending OTHERS is
 *     a decision about what a shop declares to a tax authority, and it is the
 *     shop's to make. Silence becomes a visible question (EI-105); a guess
 *     becomes a filed invoice nobody reviewed.
 */

const uqc = require('../../../src/services/einvoice/uqc');

describe('the units this application seeds', () => {
  /* Straight from the UNIT_LABELS map in install.service.js - the words a
     shop gets without typing anything. */
  const seeded = {
    Quantity: 'NOS',
    Pieces: 'PCS',
    Piece: 'PCS',
    Kilogram: 'KGS',
    Gram: 'GMS',
    Litre: 'LTR',
    Millilitre: 'MLT',
    Metre: 'MTR',
    Box: 'BOX',
    Pair: 'PRS',
    Set: 'SET',
    Pack: 'PAC',
    Dozen: 'DOZ',
    Roll: 'ROL',
    Bag: 'BAG',
    Bottle: 'BTL',
    Can: 'CAN',
    Tube: 'TUB',
  };

  for (const [unit, code] of Object.entries(seeded)) {
    test(`${unit} maps to ${code}`, () => {
      expect(uqc.unitToUqc(unit)).toBe(code);
    });
  }

  test('the short forms the item screen stores map too', () => {
    expect(uqc.unitToUqc('qty')).toBe('NOS');
    expect(uqc.unitToUqc('pcs')).toBe('PCS');
    expect(uqc.unitToUqc('kg')).toBe('KGS');
    expect(uqc.unitToUqc('ltr')).toBe('LTR');
  });
});

describe('what it refuses to guess', () => {
  test('a unit with no GST code produces nothing, not OTH', () => {
    /* All three are seeded by install.service.js and none has a UQC. The
       shop is asked; the software does not decide. */
    expect(uqc.unitToUqc('sheet')).toBe('');
    expect(uqc.unitToUqc('plate')).toBe('');
    expect(uqc.unitToUqc('cup')).toBe('');
  });

  test('an empty or absent unit produces nothing', () => {
    expect(uqc.unitToUqc('')).toBe('');
    expect(uqc.unitToUqc(null)).toBe('');
    expect(uqc.unitToUqc(undefined)).toBe('');
    expect(uqc.unitToUqc({})).toBe('');
  });

  test('OTH is reachable, but only when the shop asks for it', () => {
    expect(uqc.unitToUqc('Others')).toBe('OTH');
    expect(uqc.unitToUqc({ uqc: 'OTH', value: 'sheet' })).toBe('OTH');
  });
});

describe('resolution order', () => {
  test('an explicit uqc on the unit record beats everything', () => {
    /* A shop that decided 'sheet' is BOX for their goods gets BOX, and the
       alias table never overrules them. */
    expect(uqc.unitToUqc({ uqc: 'BOX', value: 'Kilogram', name: 'Kilogram' })).toBe('BOX');
  });

  test('without one, the unit document is read by value then name', () => {
    expect(uqc.unitToUqc({ value: 'Kilogram' })).toBe('KGS');
    expect(uqc.unitToUqc({ name: 'Dozen' })).toBe('DOZ');
  });

  test('a value that is already a UQC is taken as one', () => {
    expect(uqc.unitToUqc('KGS')).toBe('KGS');
    expect(uqc.unitToUqc('kgs')).toBe('KGS');
  });

  test('an unknown explicit uqc does not become a code', () => {
    /* 'KILO' is not a UQC. Falling through to the alias table on `value` is
       correct; inventing a code from the typed string is not. */
    expect(uqc.unitToUqc({ uqc: 'KILO', value: 'Kilogram' })).toBe('KGS');
    expect(uqc.unitToUqc({ uqc: 'KILO' })).toBe('');
  });
});

describe('spelling', () => {
  test('punctuation and spacing do not change the answer', () => {
    for (const spelling of ['Sq. Ft.', 'sq ft', 'SQ-FT', 'sqft']) {
      expect(uqc.unitToUqc(spelling)).toBe('SQF');
    }
  });

  test('a plural the table did not spell out still resolves', () => {
    expect(uqc.unitToUqc('cartons')).toBe('CTN');
    expect(uqc.unitToUqc('drums')).toBe('DRM');
  });

  test('but stemming stops there - it does not invent a match', () => {
    expect(uqc.unitToUqc('sheets')).toBe('');
    expect(uqc.unitToUqc('widgets')).toBe('');
  });
});

describe('the code list itself', () => {
  test('the codes an e-invoice is most likely to need are present', () => {
    for (const code of ['KGS', 'NOS', 'PCS', 'LTR', 'MTR', 'BOX', 'SET', 'OTH']) {
      expect(uqc.describe(code)).toBeTruthy();
    }
  });

  test('every alias points at a code that exists', () => {
    /* An alias naming a code the list does not carry would send the IRP a
       unit it refuses (error 2177), and nothing else would catch it. */
    for (const [alias, code] of Object.entries(uqc.ALIASES)) {
      expect(uqc.asCode(code)).toBe(code);
      expect(`${alias} -> ${uqc.asCode(code)}`).toBe(`${alias} -> ${code}`);
    }
  });

  test('allCodes is sorted and described, for a picker', () => {
    const all = uqc.allCodes();
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(all.map((c) => c.code)).toEqual([...all.map((c) => c.code)].sort());
    expect(all.every((c) => c.description)).toBe(true);
  });
});
