'use strict';

/*
 * GTIN - the number that makes a product the SAME product in two shops.
 *
 * A barcode on a retail pack is a Global Trade Item Number: EAN-13 in most of
 * the world, UPC-A in North America, EAN-8 on small packs, GTIN-14 on cases.
 * GS1 sells a company prefix and the manufacturer allocates item numbers under
 * it, which is what makes the number globally unique.
 *
 * That uniqueness is the only reason a shared product database can exist at
 * all. Two tills in different countries scanning the same tin of tomatoes get
 * the same digits; without that there is nothing to join on.
 *
 * WHY THIS IS A SEPARATE FIELD FROM barcode_id
 *
 * `barcode_id` is whatever the shop chose to print or scan. It may be a GTIN.
 * It may equally be an in-store code, a supplier's internal reference, or a
 * number somebody typed. Treating it as a GTIN would publish those to the world
 * as though they identified a real product, and a wrong GTIN is worse than a
 * missing one: it silently claims to be something it is not, and anyone
 * matching against it inherits the error.
 *
 * So a GTIN is only ever a GTIN when it validates. Everything here exists to
 * make that judgement, not to guess.
 */

/* Only digits survive. Barcodes get pasted with spaces and hyphens. */
function normalize(raw) {
  return String(raw == null ? '' : raw).replace(/[\s-]/g, '');
}

/* GS1 accepts exactly these lengths. Anything else is not a GTIN. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/*
 * The GS1 check digit: from the RIGHT, excluding the check digit itself,
 * weight alternately 3 and 1, sum, then the digit that rounds the sum up to a
 * multiple of ten.
 *
 * Computed on the right-aligned string so one implementation covers all four
 * lengths - the weighting is defined from the right precisely so that padding
 * a GTIN-13 to 14 does not change it.
 */
function checkDigit(digitsWithoutCheck) {
  const s = String(digitsWithoutCheck);
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) {
    /* i counted from the right: the rightmost body digit is weighted 3. */
    const fromRight = s.length - 1 - i;
    const weight = fromRight % 2 === 0 ? 3 : 1;
    sum += Number(s[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function isValid(raw) {
  const g = normalize(raw);
  if (!/^\d+$/.test(g)) return false;
  if (!VALID_LENGTHS.has(g.length)) return false;
  return checkDigit(g.slice(0, -1)) === Number(g[g.length - 1]);
}

/*
 * The 14-digit form, which is how two GTINs of different lengths are compared.
 *
 * A UPC-A (12) and the EAN-13 of the same product differ only by a leading
 * zero. Storing what was scanned and matching on the padded form is the GS1
 * recommendation, and skipping it is how the same product ends up as two rows.
 */
function toGtin14(raw) {
  const g = normalize(raw);
  return isValid(g) ? g.padStart(14, '0') : null;
}

/*
 * Numbers that are NOT globally unique, and must never be published.
 *
 * GS1 reserves prefixes for restricted distribution - a shop prints its own
 * barcodes for loose produce, bakery, or anything weighed at the counter. Those
 * digits mean one thing in this shop and something else in the next one.
 *
 * They are perfectly valid barcodes and they scan correctly. They are simply
 * local, and publishing one to a shared database as if it identified a product
 * would poison that database with numbers that collide by design.
 *
 *   02, 20-29  restricted distribution (in-store)
 *   04         internal company use
 *   977        ISSN (periodicals)
 *   978, 979   ISBN / ISMN (books)
 *   980        refund receipts
 *   981-984    common currency coupons
 *   99         coupons
 *
 * Books are the interesting case: 978/979 ARE globally unique and worth
 * keeping, so they are reported separately rather than lumped in with codes
 * that collide.
 */
function classify(raw) {
  const g = normalize(raw);
  if (!isValid(g)) return { valid: false, scope: 'invalid', publishable: false };

  const g14 = g.padStart(14, '0');
  /* The prefix is read from the GTIN-13 view, which is where GS1 defines it. */
  const p = g14.slice(1);
  const two = p.slice(0, 2);
  const three = p.slice(0, 3);

  if (two === '02' || two === '04' || (Number(two) >= 20 && Number(two) <= 29)) {
    return { valid: true, scope: 'in-store', publishable: false };
  }
  if (three === '977') return { valid: true, scope: 'issn', publishable: true };
  if (three === '978' || three === '979') {
    return { valid: true, scope: 'isbn', publishable: true };
  }
  if (three === '980' || (Number(three) >= 981 && Number(three) <= 984)) {
    return { valid: true, scope: 'coupon', publishable: false };
  }
  if (two === '99') return { valid: true, scope: 'coupon', publishable: false };

  return { valid: true, scope: 'global', publishable: true };
}

/*
 * What to store, given whatever was typed.
 *
 * Returns null for anything that is not a valid GTIN - deliberately, because a
 * half-accepted identifier is the thing this module exists to prevent. The
 * caller decides whether that is an error or simply "this item has no GTIN",
 * and for most shop items the honest answer is the second one.
 */
function parse(raw) {
  const g = normalize(raw);
  if (!g) return null;
  if (!isValid(g)) return null;
  const c = classify(g);
  return { gtin: g, gtin14: g.padStart(14, '0'), scope: c.scope, publishable: c.publishable };
}

module.exports = { normalize, checkDigit, isValid, toGtin14, classify, parse, VALID_LENGTHS };
