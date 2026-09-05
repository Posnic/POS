'use strict';
/*
 * The catalogue of things that can be wrong with an invoice, and how to say so
 * (INDIA_EINVOICING_DESIGN.md, "Findings").
 *
 * WHY THE CODES ARE IN THEIR OWN FILE, AND WHY THEY ARE STABLE
 *
 * An operator who cannot export an invoice will search for the code. It will
 * end up in a support message, a forum post and eventually somebody's blog. So
 * a code means one thing for the life of the product: EI-101 is a missing HSN
 * in every version, or it is worse than useless. New checks take new numbers;
 * a retired check leaves a hole rather than having its number reused.
 *
 * SEVERITY IS A DECISION ABOUT WHOSE PROBLEM IT IS
 *
 *   block  the IRP would refuse this, or we cannot represent it honestly.
 *          Excluded from the export. The shop must fix something.
 *   warn   exportable, but a human should look. Never silently dropped.
 *   info   nothing is wrong. Used for the invoice that is simply not an
 *          e-invoice candidate, which is the commonest case in a retail shop
 *          and must never read as an error.
 *
 * The `fix` on each entry is what turns a validation report into something a
 * shopkeeper can act on: it names the screen that owns the field, so the
 * readiness page can link straight there instead of leaving somebody to guess
 * which of eleven settings tabs holds "legal name".
 */

/* Screens a finding can point at. Kept as an enum so a typo is a test failure
   rather than a dead link on a page nobody checks. */
const SCREENS = {
  BRANCH: 'branch',
  CUSTOMER: 'customer',
  ITEM: 'item',
  UNITS: 'units',
  SALE: 'sale',
  TAX_SETTINGS: 'tax_settings',
  NONE: null,
};

const CATALOGUE = {
  /* ---- the invoice is not a candidate ------------------------------- */
  'EI-001': {
    severity: 'info',
    title: 'Not an e-invoice',
    fix: SCREENS.NONE,
  },

  /* ---- buyer -------------------------------------------------------- */
  'EI-002': { severity: 'block', title: 'Buyer GSTIN missing', fix: SCREENS.CUSTOMER },
  'EI-003': { severity: 'block', title: 'Buyer GSTIN is not valid', fix: SCREENS.CUSTOMER },
  'EI-004': { severity: 'block', title: 'Buyer name missing', fix: SCREENS.CUSTOMER },
  'EI-005': {
    severity: 'block',
    title: 'Buyer PIN code missing or malformed',
    fix: SCREENS.CUSTOMER,
  },
  'EI-006': { severity: 'warn', title: 'Buyer legal name missing', fix: SCREENS.CUSTOMER },
  'EI-007': { severity: 'block', title: 'Buyer address or town missing', fix: SCREENS.CUSTOMER },

  /* ---- seller ------------------------------------------------------- */
  'EI-011': { severity: 'block', title: 'Shop GSTIN missing or not valid', fix: SCREENS.BRANCH },
  'EI-012': { severity: 'warn', title: 'Shop GSTIN and shop state disagree', fix: SCREENS.BRANCH },
  'EI-013': { severity: 'block', title: 'Shop legal name missing', fix: SCREENS.BRANCH },
  'EI-014': { severity: 'block', title: 'Shop PIN code missing or malformed', fix: SCREENS.BRANCH },
  'EI-015': { severity: 'block', title: 'Shop address or town missing', fix: SCREENS.BRANCH },

  /* ---- the document ------------------------------------------------- */
  'EI-021': {
    severity: 'block',
    title: 'Bill number cannot be used on an e-invoice',
    fix: SCREENS.BRANCH,
  },
  'EI-022': { severity: 'warn', title: 'Past the 30-day reporting window', fix: SCREENS.NONE },
  'EI-023': { severity: 'block', title: 'Supply type not supported yet', fix: SCREENS.SALE },
  'EI-024': { severity: 'block', title: 'Invoice has no date', fix: SCREENS.SALE },
  'EI-025': { severity: 'block', title: 'Invoice has no lines', fix: SCREENS.SALE },

  /* ---- lines -------------------------------------------------------- */
  'EI-101': { severity: 'block', title: 'HSN code missing', fix: SCREENS.ITEM },
  'EI-102': { severity: 'block', title: 'HSN code malformed', fix: SCREENS.ITEM },
  'EI-103': { severity: 'block', title: 'HSN code too short', fix: SCREENS.ITEM },
  'EI-104': { severity: 'block', title: 'Service needs a SAC code', fix: SCREENS.ITEM },
  'EI-105': { severity: 'block', title: 'Unit has no GST unit code', fix: SCREENS.UNITS },
  'EI-106': { severity: 'block', title: 'Tax rate not accepted by the portal', fix: SCREENS.ITEM },
  'EI-108': {
    severity: 'block',
    title: 'Tax split does not match the buyer state',
    fix: SCREENS.CUSTOMER,
  },
  'EI-110': { severity: 'block', title: 'Too many lines for one e-invoice', fix: SCREENS.SALE },
  'EI-111': { severity: 'warn', title: 'Tax rate is on a withdrawn slab', fix: SCREENS.ITEM },
  'EI-112': { severity: 'block', title: 'Line quantity is missing or zero', fix: SCREENS.SALE },
  'EI-113': { severity: 'block', title: 'Line cannot be read', fix: SCREENS.SALE },

  /* ---- state of the invoice ----------------------------------------- */
  'EI-301': { severity: 'block', title: 'Invoice has a return on it', fix: SCREENS.NONE },
  'EI-302': { severity: 'warn', title: 'Already registered', fix: SCREENS.NONE },
};

/*
 * Codes that belong to checks this module cannot make yet, listed so that a
 * reader of the catalogue is not left wondering whether they were forgotten.
 * Each needs the restated amounts that contract.js produces (the next PR):
 * you cannot tell whether a line's tax is wrong without recomputing it, and
 * recomputing it is a decision about inclusive pricing and discount
 * allocation that the design has not had answered yet.
 */
const DEFERRED = {
  'EI-107': 'line tax differs from rate x taxable value - needs contract.js',
  'EI-109': 'header discount could not be allocated - needs contract.js',
  'EI-201': 'invoice total differs from the sum of lines - needs contract.js',
};

/**
 * Build one finding.
 *
 * @param {string} code    a key of CATALOGUE
 * @param {string} message the sentence an operator reads. Written at the call
 *                         site because only there is the actual value known -
 *                         "HSN 0 on Fixture rice" beats "HSN code missing".
 * @param {object} [extra] { field, line, value, expected }
 */
function make(code, message, extra = {}) {
  const entry = CATALOGUE[code];
  if (!entry) {
    /* An unknown code is a programming error, and a silent one would put an
       unlabelled row on the operator's screen. Fail where it can be seen. */
    throw new Error(`Unknown e-invoice finding code: ${code}`);
  }
  return {
    code,
    severity: entry.severity,
    title: entry.title,
    fix: entry.fix,
    message: String(message || entry.title),
    ...extra,
  };
}

/** Does this set of findings stop the invoice being exported? */
const isBlocked = (findings = []) => findings.some((f) => f && f.severity === 'block');

/** Is this invoice simply not an e-invoice candidate? */
const isNotApplicable = (findings = []) => findings.some((f) => f && f.code === 'EI-001');

module.exports = { SCREENS, CATALOGUE, DEFERRED, make, isBlocked, isNotApplicable };
