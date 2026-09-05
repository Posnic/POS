'use strict';
/*
 * GSTIN: structure, check digit, and the two things an e-invoice reads out of
 * one (INDIA_EINVOICING_DESIGN.md, PR 2).
 *
 * WHY THIS EXISTS WHEN A REGEX ALREADY DID
 *
 * customer.model.js and tax_profiles.json both carry the shape
 * `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, and that is a real check
 * - it catches a typed-in number of the wrong length or the wrong alphabet.
 * What it cannot catch is the transposition: 33AAAAA0000A1Z9 and
 * 33AAAAA0000A1Z0 are both perfectly shaped, and only one of them is a GSTIN.
 * The fifteenth character is a mod-36 check digit over the first fourteen, so
 * the difference is computable here, offline, at the till.
 *
 * That matters because of WHERE the alternative check happens. The IRP
 * validates the buyer's GSTIN when the invoice is submitted - by which time
 * the customer has gone home, the bill is printed, and the correction is a
 * credit note rather than an edit. A check digit computed while the cashier is
 * still typing costs nothing and removes that entire class of failure
 * (NIC errors 3028/3029).
 *
 * THE OTHER HALF: THE STATE CODE
 *
 * The first two digits of a GSTIN ARE the state code, which makes the buyer's
 * own number the authoritative source for place of supply - authoritative in a
 * way the typed state name is not. sale.repository.js already relies on this
 * for the GSTR-1 export (`gstStateCode`), and the readiness checks rely on it
 * to catch a sale that was split CGST/SGST against a buyer in another state.
 * The state NAME cannot do that job: the shipped list spells Puducherry
 * "Pondicherry" and contains five entries that are not states at all.
 *
 * Nothing here touches a database or the network. It is arithmetic over a
 * string, which is what makes it testable and what makes it safe to run on
 * every keystroke.
 */

/* 0-9 then A-Z: the value of a character IS its index here, which is the whole
   of the mod-36 arithmetic below. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/*
 * Structure, position by position:
 *
 *   1-2    state code, digits
 *   3-12   the holder's PAN (5 letters, 4 digits, 1 letter)
 *   13     entity number for that PAN in that state, 1-9 then A-Z
 *   14     'Z' by convention, and every real GSTIN has it
 *   15     check digit
 *
 * Kept identical to the shape customer.model.js and the IN tax profile already
 * enforce, so a number one of them accepts is not rejected by the other.
 */
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/* State codes in use. 01-38 with two absences and one addition:
   25 was withdrawn when Daman and Diu merged into 26, 38 is Ladakh, and 97 is
   "other territory" - which a shop will not have but an invoice can name. */
const VALID_STATE_CODES = new Set(
  []
    .concat(
      Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')).filter((c) => c !== '25')
    )
    .concat(['97'])
);

const clean = (value) =>
  String(value == null ? '' : value)
    .trim()
    .toUpperCase();

/**
 * The check digit for the first fourteen characters of a GSTIN.
 *
 * The algorithm, which is the standard mod-36 with alternating weights:
 * each character's value is multiplied by 1 or 2 (alternating, starting at 1),
 * the product is folded by adding its quotient and remainder over 36, and the
 * check digit is whatever makes the running total a multiple of 36.
 *
 * @param {string} first14
 * @returns {string|null} one character, or null if the input is not fourteen
 *                        characters of the alphabet
 */
function checkDigit(first14) {
  const body = clean(first14);
  if (body.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(body[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

/** Does the string have the right shape, ignoring the check digit? */
function isWellFormed(gstin) {
  return FORMAT.test(clean(gstin));
}

/** Shape AND check digit. This is the one callers should use. */
function isValid(gstin) {
  const value = clean(gstin);
  if (!FORMAT.test(value)) return false;
  if (!VALID_STATE_CODES.has(value.slice(0, 2))) return false;
  return checkDigit(value.slice(0, 14)) === value[14];
}

/**
 * Why a GSTIN was refused, in words an operator can act on.
 *
 * Deliberately specific about the check digit, because "invalid GSTIN" in
 * front of a customer who is holding their registration certificate is an
 * argument, and "the last character should be X" is a correction.
 *
 * @returns {{valid: boolean, reason: string|null, detail: string|null}}
 */
function explain(gstin) {
  const value = clean(gstin);
  if (!value) return { valid: false, reason: 'missing', detail: 'No GSTIN entered.' };
  if (value.length !== 15) {
    return {
      valid: false,
      reason: 'length',
      detail: `A GSTIN is 15 characters; this one is ${value.length}.`,
    };
  }
  if (!FORMAT.test(value)) {
    return {
      valid: false,
      reason: 'format',
      detail:
        'Expected two digits, then a PAN (five letters, four digits, one letter), ' +
        'then one character, then Z, then one character.',
    };
  }
  if (!VALID_STATE_CODES.has(value.slice(0, 2))) {
    return {
      valid: false,
      reason: 'state_code',
      detail: `${value.slice(0, 2)} is not a GST state code.`,
    };
  }
  const expected = checkDigit(value.slice(0, 14));
  if (expected !== value[14]) {
    return {
      valid: false,
      reason: 'check_digit',
      /* The expected character is given because the usual cause is one
         mistyped character earlier in the number, and seeing the mismatch is
         how somebody finds it. It is not an instruction to change the last
         character. */
      detail: `The last character does not match the rest of the number (expected ${expected}). Check the whole GSTIN against the registration certificate.`,
    };
  }
  return { valid: true, reason: null, detail: null };
}

/**
 * The state code a GSTIN declares: its first two digits.
 *
 * @returns {string} two digits, or '' when the input is not usable
 */
function stateCodeOf(gstin) {
  const value = clean(gstin);
  if (!/^[0-9]{2}/.test(value)) return '';
  const code = value.slice(0, 2);
  return VALID_STATE_CODES.has(code) ? code : '';
}

/** The PAN inside a GSTIN, characters 3 to 12. '' when not extractable. */
function panOf(gstin) {
  const value = clean(gstin);
  if (!FORMAT.test(value)) return '';
  return value.slice(2, 12);
}

/**
 * Do two GSTINs sit in the same state? Used to decide whether a supply is
 * intra-state (CGST + SGST) or inter-state (IGST) from the numbers themselves
 * rather than from two typed state names.
 *
 * Returns null when either code is unreadable - "I cannot tell" is a different
 * answer from "no", and the caller reports it differently.
 */
function sameState(gstinA, gstinB) {
  const a = stateCodeOf(gstinA);
  const b = stateCodeOf(gstinB);
  if (!a || !b) return null;
  return a === b;
}

module.exports = {
  ALPHABET,
  FORMAT,
  VALID_STATE_CODES,
  checkDigit,
  isWellFormed,
  isValid,
  explain,
  stateCodeOf,
  panOf,
  sameState,
};
