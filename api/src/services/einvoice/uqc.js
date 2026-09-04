'use strict';
/*
 * Unit Quantity Codes (INDIA_EINVOICING_DESIGN.md, PR 2).
 *
 * THE PROBLEM
 *
 * Posnic stores a unit as whatever the shop typed - 'pcs', 'Kilogram', 'set',
 * 'packet'. The e-invoice schema does not accept any of those. ItemList[].Unit
 * takes one of about forty-five fixed codes, and a line carrying anything else
 * is refused by the IRP with error 2177. The same codes govern the HSN summary
 * in GSTR-1, so this is not only an e-invoice concern.
 *
 * WHY THE MAPPING REFUSES TO GUESS
 *
 * 'Kilogram' is KGS and there is no second opinion about it. 'Sheet' has no
 * code at all, and neither does 'plate' or 'cup' - two of which this
 * application seeds into a new shop. The temptation is to send OTH (OTHERS)
 * for those and move on.
 *
 * OTH is a real code, and for some goods it is the right one. But choosing it
 * is a decision about what a shop declares to a tax authority, and the shop
 * has to make it: a wrong unit on a filed invoice is the shop's problem, not
 * ours, and they never saw us make the choice. So an unmapped unit produces
 * NO code here. The readiness check turns that into a visible question
 * (finding EI-105) with the unit named, and the shop answers it once, on the
 * Units screen, for every future sale.
 *
 * This is the same rule country-tax.js applies to tax rates, for the same
 * reason: an honest gap beats a confident guess.
 *
 * THE ONE MAPPING THAT IS A JUDGEMENT
 *
 * 'qty' is Posnic's default unit, carried by most items in most shops. Left
 * unmapped it would block essentially every line, which is a correct result
 * that helps nobody. It maps to NOS (NUMBERS), which is what a bare count is
 * in UQC terms and what every Indian accounting package sends for it. A shop
 * that means something else can override it on the unit record.
 */

const reference = require('../../json/uqc_codes.json');

const CODES = reference.codes || {};
const ALIASES = reference.aliases || {};

/* Lower-cased, punctuation-flattened, single-spaced. A shop types 'Sq. Ft.',
   'sq ft' and 'SQFT' for one thing, and all three should land on SQF. */
function normalise(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[._/\\-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is this already a valid UQC? Case-insensitive; returns the canonical form. */
function asCode(value) {
  const code = String(value == null ? '' : value)
    .trim()
    .toUpperCase();
  return Object.prototype.hasOwnProperty.call(CODES, code) ? code : '';
}

/**
 * The UQC for a unit, or '' when nothing can be said with certainty.
 *
 * Resolution order, most authoritative first:
 *   1. an explicit `uqc` the shop set on the unit record - always wins
 *   2. the value already being a UQC ('KGS' typed into the unit field)
 *   3. the alias table, on the unit's name and then on its short value
 *
 * @param {string|object} unit  a unit name, or a unit document
 *                              ({ uqc, name, value, short_name })
 * @returns {string} a UQC, or ''
 */
function unitToUqc(unit) {
  if (!unit) return '';

  if (typeof unit === 'object') {
    const explicit = asCode(unit.uqc);
    if (explicit) return explicit;
    /* Both spellings a unit document uses in this codebase: `value` is what
       the item's `unit` field joins on, `name` is what the picker shows. */
    for (const candidate of [unit.value, unit.name, unit.short_name, unit.unit]) {
      const found = unitToUqc(candidate);
      if (found) return found;
    }
    return '';
  }

  const direct = asCode(unit);
  if (direct) return direct;

  const key = normalise(unit);
  if (!key) return '';
  if (Object.prototype.hasOwnProperty.call(ALIASES, key)) return ALIASES[key];

  /* A trailing plural the alias table did not spell out ('cartons' when only
     'carton' is listed) is worth one more look, but nothing beyond that -
     stemming a unit name is exactly the kind of cleverness that produces a
     confident wrong answer. */
  if (key.endsWith('s')) {
    const singular = key.slice(0, -1);
    if (Object.prototype.hasOwnProperty.call(ALIASES, singular)) return ALIASES[singular];
  }
  return '';
}

/** The description the portal gives a code, for showing beside it in a picker. */
function describe(code) {
  return CODES[asCode(code)] || '';
}

/** Every code, as [{ code, description }], sorted - the Units screen's picker. */
function allCodes() {
  return Object.keys(CODES)
    .sort()
    .map((code) => ({ code, description: CODES[code] }));
}

module.exports = {
  CODES,
  ALIASES,
  normalise,
  asCode,
  unitToUqc,
  describe,
  allCodes,
};
