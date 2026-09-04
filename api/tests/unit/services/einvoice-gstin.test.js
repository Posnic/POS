'use strict';

/*
 * GSTIN structure and check digit (INDIA_EINVOICING_DESIGN.md PR 2, issue #43).
 *
 * The test that matters most is the transposition one. A regex already
 * existed in customer.model.js, and it accepts 33AAAAA0000A1Z0 as happily as
 * 33AAAAA0000A1Z9 - the two differ by one character and only one is a real
 * GSTIN. If the checksum here were broken, every GSTIN would look invalid and
 * a naive "rejects a bad GSTIN" test would still pass. So the valid fixtures
 * are asserted first, and they are constructed with real check digits.
 */

const gstin = require('../../../src/services/einvoice/gstin');
const fx = require('../../fixtures/einvoice');

describe('check digit', () => {
  test('the synthetic fixtures are genuinely valid GSTINs', () => {
    /* If this fails, every other assertion in the e-invoice suite is
       meaningless - the fixtures would be rejected for being wrong rather
       than for the reason each test intends. */
    expect(gstin.isValid(fx.SELLER_GSTIN)).toBe(true);
    expect(gstin.isValid(fx.BUYER_SAME_STATE_GSTIN)).toBe(true);
    expect(gstin.isValid(fx.BUYER_OTHER_STATE_GSTIN)).toBe(true);
  });

  test('one wrong character in the check position is caught', () => {
    /* Same fourteen characters, different last one. The regex cannot tell
       these apart; this is the entire reason the module exists. */
    expect(fx.BAD_CHECKSUM_GSTIN.slice(0, 14)).toBe(fx.SELLER_GSTIN.slice(0, 14));
    expect(gstin.isWellFormed(fx.BAD_CHECKSUM_GSTIN)).toBe(true);
    expect(gstin.isValid(fx.BAD_CHECKSUM_GSTIN)).toBe(false);
    expect(gstin.explain(fx.BAD_CHECKSUM_GSTIN).reason).toBe('check_digit');
  });

  test('a typo anywhere in the number is caught, not only at the end', () => {
    /* The realistic failure: somebody mistypes a digit in the middle. The
       check digit no longer agrees, and that is what finds it. */
    const body = fx.SELLER_GSTIN.split('');
    body[3] = body[3] === 'B' ? 'C' : 'B';
    const typo = body.join('');
    expect(gstin.isWellFormed(typo)).toBe(true);
    expect(gstin.isValid(typo)).toBe(false);
  });

  test('every position is weighted - changing any one of the first 14 breaks it', () => {
    for (let i = 0; i < 14; i++) {
      const chars = fx.SELLER_GSTIN.split('');
      const original = chars[i];
      /* Move to another character of the same class so the shape survives and
         only the checksum can object. */
      chars[i] = /[0-9]/.test(original)
        ? String((Number(original) + 1) % 10)
        : String.fromCharCode(((original.charCodeAt(0) - 65 + 1) % 26) + 65);
      const mutated = chars.join('');
      if (!gstin.isWellFormed(mutated)) continue; /* position 13 is fixed 'Z' */
      expect(gstin.isValid(mutated)).toBe(false);
    }
  });

  test('checkDigit refuses anything that is not fourteen usable characters', () => {
    expect(gstin.checkDigit('')).toBeNull();
    expect(gstin.checkDigit('33AAAAA0000A1')).toBeNull();
    expect(gstin.checkDigit('33AAAAA0000A1Z9')).toBeNull();
    expect(gstin.checkDigit('33AAAAA0000A1-')).toBeNull();
  });
});

describe('shape', () => {
  test('length, alphabet and the fixed Z are all enforced', () => {
    expect(gstin.explain('').reason).toBe('missing');
    expect(gstin.explain('33AAAAA').reason).toBe('length');
    expect(gstin.explain('33aaaaa0000a1z9').valid).toBe(true); /* case is forgiven */
    expect(gstin.explain('AA1AAAA0000A1Z9').reason).toBe('format');
    /* Position 14 is 'Z' on every real GSTIN. */
    expect(gstin.explain('33AAAAA0000A1Y9').reason).toBe('format');
  });

  test('a state code that does not exist is refused', () => {
    /* 99 is not a state, and 25 was withdrawn when Daman and Diu merged
       into 26. Both are correctly shaped and neither is a GSTIN. */
    expect(gstin.explain('99AAAAA0000A1Z9').reason).toBe('state_code');
    expect(gstin.explain('25AAAAA0000A1Z9').reason).toBe('state_code');
  });

  test('the explanation names the expected character, because that is how a typo is found', () => {
    const detail = gstin.explain(fx.BAD_CHECKSUM_GSTIN).detail;
    expect(detail).toMatch(/expected 9/);
    /* And it tells them to check the whole number rather than to change the
       last character, which would turn a wrong GSTIN into a valid-looking
       wrong GSTIN. */
    expect(detail).toMatch(/whole GSTIN/i);
  });
});

describe('what an e-invoice reads out of a GSTIN', () => {
  test('the state code is the first two digits', () => {
    expect(gstin.stateCodeOf(fx.SELLER_GSTIN)).toBe('33');
    expect(gstin.stateCodeOf(fx.BUYER_OTHER_STATE_GSTIN)).toBe('29');
    expect(gstin.stateCodeOf('')).toBe('');
    expect(gstin.stateCodeOf('99AAAAA0000A1Z9')).toBe('');
  });

  test('the PAN sits at characters 3 to 12', () => {
    expect(gstin.panOf(fx.SELLER_GSTIN)).toBe('AAAAA0000A');
    expect(gstin.panOf('nonsense')).toBe('');
  });

  test('same-state is decided from the numbers, not from a typed state name', () => {
    expect(gstin.sameState(fx.SELLER_GSTIN, fx.BUYER_SAME_STATE_GSTIN)).toBe(true);
    expect(gstin.sameState(fx.SELLER_GSTIN, fx.BUYER_OTHER_STATE_GSTIN)).toBe(false);
  });

  test('"I cannot tell" is a distinct answer from "no"', () => {
    /* A caller must be able to stay silent when a GSTIN is unreadable rather
       than reporting a split mismatch it cannot actually justify. */
    expect(gstin.sameState('', fx.BUYER_SAME_STATE_GSTIN)).toBeNull();
    expect(gstin.sameState(fx.SELLER_GSTIN, 'rubbish')).toBeNull();
  });
});
