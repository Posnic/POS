'use strict';

const gtin = require('../../../src/utils/gtin');

/*
 * The check digit and the restricted prefixes are the two things that decide
 * whether a shared product database is trustworthy.
 *
 * A wrong GTIN is worse than a missing one: it silently claims to be a product
 * it is not, and anybody matching against it inherits the error. So the bar
 * here is that nothing gets called a GTIN unless it demonstrably is one.
 */
describe('gtin', () => {
  describe('check digit', () => {
    test('real barcodes validate', () => {
      /* Genuine, published GTINs of each length. */
      expect(gtin.isValid('5000159484695')).toBe(true); // EAN-13, Mars bar
      expect(gtin.isValid('036000291452')).toBe(true); // UPC-A
      expect(gtin.isValid('96385074')).toBe(true); // EAN-8
      expect(gtin.isValid('00012345600012')).toBe(true); // GTIN-14
    });

    test('a single wrong digit is rejected', () => {
      /* The whole point of the check digit: transposition and typos. */
      expect(gtin.isValid('5000159484694')).toBe(false); // last digit off by one
      expect(gtin.isValid('5000159484685')).toBe(false); // a body digit changed
    });

    test('the digit itself is computed from the right', () => {
      /* Weighting is defined from the RIGHT so that zero-padding a GTIN-13 to
         14 does not change the answer. Computing from the left silently breaks
         for even-length codes only, which is the kind of bug that passes a
         casual test. */
      expect(gtin.checkDigit('500015948469')).toBe(5);
      expect(gtin.checkDigit('0000500015948469')).toBe(5);
    });

    test('wrong lengths are not GTINs', () => {
      expect(gtin.isValid('12345')).toBe(false);
      expect(gtin.isValid('1234567890')).toBe(false); // 10 digits
      expect(gtin.isValid('123456789012345')).toBe(false); // 15
    });

    test('non-digits are not GTINs', () => {
      expect(gtin.isValid('ABC0159484695')).toBe(false);
      expect(gtin.isValid('')).toBe(false);
      expect(gtin.isValid(null)).toBe(false);
      expect(gtin.isValid(undefined)).toBe(false);
    });

    test('spaces and hyphens are tolerated, because barcodes get pasted', () => {
      expect(gtin.isValid('5000159 484695')).toBe(true);
      expect(gtin.isValid('5-000159-484695')).toBe(true);
    });
  });

  describe('comparison form', () => {
    test('a UPC-A and its EAN-13 are the same product', () => {
      /* They differ by a leading zero. Matching on the raw string is how one
         product becomes two rows. */
      expect(gtin.toGtin14('036000291452')).toBe('00036000291452');
      expect(gtin.toGtin14('0036000291452')).toBe('00036000291452');
    });

    test('an invalid code has no comparison form', () => {
      expect(gtin.toGtin14('5000159484694')).toBeNull();
    });
  });

  describe('what may be published', () => {
    test('an ordinary retail barcode is global', () => {
      const c = gtin.classify('5000159484695');
      expect(c.scope).toBe('global');
      expect(c.publishable).toBe(true);
    });

    test('in-store codes are valid but NOT publishable', () => {
      /*
       * This is the rule that protects a shared database. Prefixes 02, 04 and
       * 20-29 are reserved for restricted distribution: a shop prints them for
       * loose produce and items weighed at the counter. They scan perfectly and
       * they mean something different in every shop.
       *
       * Publishing one would put a number into a global database that collides
       * BY DESIGN with every other shop using the same prefix.
       */
      /* Check digits computed, not invented - the first draft of this test used
         plausible-looking codes that were not valid GTINs, so the classifier
         correctly refused them and the test failed for the wrong reason. */
      for (const code of ['2012345678903', '0212345678909', '0412345678903']) {
        const c = gtin.classify(code);
        expect(c.valid).toBe(true);
        expect(c.scope).toBe('in-store');
        expect(c.publishable).toBe(false);
      }
    });

    test('coupons are valid and not products', () => {
      expect(gtin.classify('9912345678909').scope).toBe('coupon');
      expect(gtin.classify('9912345678909').publishable).toBe(false);
    });

    test('books keep their identity', () => {
      /* 978/979 ARE globally unique, unlike the in-store range, so they are
         reported separately rather than swept in with codes that collide. */
      const c = gtin.classify('9780306406157');
      expect(c.scope).toBe('isbn');
      expect(c.publishable).toBe(true);
    });

    test('an invalid code is never publishable', () => {
      const c = gtin.classify('5000159484694');
      expect(c.valid).toBe(false);
      expect(c.publishable).toBe(false);
    });
  });

  describe('parse', () => {
    test('a valid code returns both forms and its scope', () => {
      const p = gtin.parse('5000159484695');
      expect(p.gtin).toBe('5000159484695');
      expect(p.gtin14).toBe('05000159484695');
      expect(p.publishable).toBe(true);
    });

    test('anything not a GTIN returns null rather than a half-value', () => {
      /* A half-accepted identifier is exactly what this module exists to
         prevent - the caller must decide, not inherit a guess. */
      expect(gtin.parse('5000159484694')).toBeNull();
      expect(gtin.parse('not a barcode')).toBeNull();
      expect(gtin.parse('')).toBeNull();
      expect(gtin.parse(null)).toBeNull();
    });

    test('an in-store code parses, but says it cannot be published', () => {
      /* Storing it is right - it is the shop's real barcode. Publishing it is
         not, and the difference has to survive to the caller. */
      const p = gtin.parse('2012345678903');
      expect(p).not.toBeNull();
      expect(p.publishable).toBe(false);
    });
  });
});
