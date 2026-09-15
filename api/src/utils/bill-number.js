'use strict';

/*
 * WHAT A BILL NUMBER IS ALLOWED TO LOOK LIKE.
 *
 * Owner: "we need year pattern required in the sales bill number example
 * attached have 26 in the year... you suggest per day increase or year wise
 * reset better tell me international standards." And, on the answer: "i accept
 * recommandation and may configurable if people from EU and international."
 *
 * THE RULE THAT DECIDES ALMOST EVERYTHING
 *
 * India, CGST Rules 2017, Rule 46(b). A tax invoice carries
 *
 *   a consecutive serial number, NOT EXCEEDING SIXTEEN CHARACTERS, in one or
 *   multiple series, containing alphabets or numerals or special characters
 *   hyphen or dash and slash symbolised as "-" and "/" respectively, and any
 *   combination thereof, UNIQUE FOR A FINANCIAL YEAR.
 *
 * Three things follow, and they are not negotiable:
 *
 *   1. Sixteen characters is a hard ceiling, not a guideline. The shop's own
 *      reference invoice is exactly sixteen - VR26-27VIR006782 - because the
 *      people who built it ran into the same wall.
 *   2. Only "-" and "/" may join the parts. No underscore, no space, no dot.
 *   3. The financial year is the unit of uniqueness, which is why the series
 *      resets with it and not with the day.
 *
 * WHY NOT PER DAY, WHICH IS THE OTHER THING PEOPLE ASK FOR
 *
 * A daily reset repeats numbers inside the year unless the date is part of the
 * number, and a date costs six to eight of the sixteen characters. It also
 * destroys the one property an auditor actually uses: a single consecutive run
 * per year has visible gaps when something is cancelled, and three hundred and
 * sixty five short runs do not.
 *
 * ELSEWHERE
 *
 * The EU VAT Directive 2006/112/EC Article 226(2) asks only for "a sequential
 * number, based on one or more series, which uniquely identifies the invoice" -
 * no length limit and no prescribed reset. So the year segment and the reset
 * are SETTINGS: a shop outside India can turn the year off, or reset on the
 * calendar year, and nothing here objects. What is never configurable is the
 * charset, because a character outside the allowed set is wrong everywhere.
 */

/** Rule 46(b). The whole reason this module has to be careful. */
const MAX_LENGTH = 16;

/** Letters, digits, and the only two separators the rule permits. */
const ALLOWED = /^[A-Za-z0-9/-]+$/;

/** Never narrower than this: 999 bills is not a year. */
const MIN_SEQUENCE_WIDTH = 4;

/*
 * When a financial year starts, by month, 1-12.
 *
 * India runs April to March, which is why the reference invoice says "26-27"
 * rather than a single year: one financial year spans two calendar ones. A
 * shop on the calendar year sets this to January and gets a single year back.
 */
const DEFAULT_FY_START_MONTH = 4;

/** off | financial | calendar. What a shop can choose. */
const RESET_MODES = Object.freeze(['off', 'financial', 'calendar']);

function int(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

/**
 * Which numbering period a date falls in.
 *
 * `key` is what the counter is keyed on, so a new period starts at 1. `label`
 * is what goes in the number, and it is SHORT on purpose: two characters buys
 * two more digits of sequence, and on a sixteen-character budget that is the
 * difference between 9,999 bills a year and 999,999.
 *
 * @returns {{key: string, label: string, mode: string}}
 */
function periodFor(date = new Date(), options = {}) {
  const mode = RESET_MODES.includes(options.reset) ? options.reset : 'off';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return { key: '', label: '', mode: 'off' };

  if (mode === 'calendar') {
    const y = d.getFullYear();
    return { key: String(y), label: String(y % 100).padStart(2, '0'), mode };
  }

  if (mode === 'financial') {
    const start = int(options.financialYearStartMonth, DEFAULT_FY_START_MONTH);
    const month = d.getMonth() + 1;
    /* Before April, a date belongs to the financial year that began LAST
       April. Getting this backwards renumbers every bill in the first quarter,
       which is the kind of mistake that is only noticed in an audit. */
    const startYear = month >= start ? d.getFullYear() : d.getFullYear() - 1;
    const endYear = startYear + 1;
    return {
      key: `${startYear}-${endYear}`,
      /* The year it ENDS in, which is what a reader recognises: a bill handed
         over in February 2027 says 27. */
      label: String(endYear % 100).padStart(2, '0'),
      mode,
    };
  }

  return { key: '', label: '', mode: 'off' };
}

/**
 * Build a number that fits, and say so when it cannot.
 *
 * The parts are fixed-width except the sequence, so the budget is worked out
 * ONCE and the sequence takes what is left. Shedding digits from the sequence
 * is the only safe way to lose characters: dropping the year would break
 * uniqueness for the financial year, and dropping the till code would let two
 * tills mint the same number.
 *
 * @returns {{number: string, ok: boolean, width: number, warning: string}}
 */
function compose(parts = {}) {
  const typeLetter = String(parts.typeLetter || '').trim();
  const branchCode = String(parts.branchCode || '').trim();
  const deviceCode = String(parts.deviceCode || '').trim();
  const wantPeriod = String(parts.period || '').trim();
  const sequence = Math.max(0, int(parts.sequence, 0));
  const wanted = Math.max(MIN_SEQUENCE_WIDTH, int(parts.sequenceWidth, 6));

  const head = `${typeLetter}${branchCode}${deviceCode}`;

  /*
   * THE SEQUENCE SETS THE FLOOR, not the padding.
   *
   * padStart only ever pads: a counter at 12,345,678 stays eight digits in a
   * four-wide field, and the number comes out seventeen characters. So the
   * space the digits ACTUALLY need is worked out first, and everything else is
   * fitted around it. That bug reached a test rather than a shop, which is the
   * only reason this comment is short.
   */
  const digitsNeeded = Math.max(String(sequence).length, MIN_SEQUENCE_WIDTH);

  const build = (h, period, width) => {
    const bits = [];
    if (h) bits.push(h);
    if (period) bits.push(period);
    bits.push(String(sequence).padStart(width, '0'));
    return bits.join('-');
  };

  /* 1. Everything, at the width the shop asked for. */
  const ideal = build(head, wantPeriod, Math.max(wanted, digitsNeeded));
  if (ideal.length <= MAX_LENGTH) {
    return { number: ideal, ok: true, width: Math.max(wanted, digitsNeeded), warning: '' };
  }

  /*
   * 2. Narrow the padding. The only safe thing to shed first: dropping the
   * year would break uniqueness for the financial year, and dropping the till
   * code would let two tills mint the same number.
   */
  const narrowed = build(head, wantPeriod, digitsNeeded);
  if (narrowed.length <= MAX_LENGTH) {
    return {
      number: narrowed,
      ok: false,
      width: digitsNeeded,
      warning:
        `The running number was shortened to ${digitsNeeded} digits to stay inside the ` +
        `${MAX_LENGTH} characters a tax invoice is allowed.`,
    };
  }

  /* 3. The year goes, rather than the legality. */
  if (wantPeriod) {
    const bare = build(head, '', digitsNeeded);
    if (bare.length <= MAX_LENGTH) {
      return {
        number: bare,
        ok: false,
        width: digitsNeeded,
        warning:
          `A bill number with the year does not fit in ${MAX_LENGTH} characters, so the ` +
          `year was left out. Shorten the branch or till code, or switch the year off.`,
      };
    }
  }

  /*
   * 4. The prefix itself is longer than a whole invoice number may be. Cut it,
   * because handing over eighteen characters is handing over an illegal
   * document.
   */
  const keep = Math.max(0, MAX_LENGTH - digitsNeeded - 1);
  const cut = head.slice(0, keep);
  const number = build(cut, '', digitsNeeded).slice(0, MAX_LENGTH);
  return {
    number,
    ok: false,
    width: digitsNeeded,
    warning: head
      ? `The prefix "${head}" is too long for a ${MAX_LENGTH} character invoice number; ` +
        `it was cut to "${cut}". Set a shorter prefix.`
      : `The running number has outgrown ${MAX_LENGTH} characters. Start a new series.`,
  };
}

/**
 * Is this a number a tax invoice may carry?
 *
 * Checked separately from building one, because numbers also arrive from
 * elsewhere - an imported sale, a shop's own prefix, a number typed by hand -
 * and the rule applies to all of them equally.
 */
function validate(value) {
  const s = String(value == null ? '' : value);
  if (!s) return { ok: false, reason: 'A bill number cannot be empty.' };
  if (s.length > MAX_LENGTH) {
    return {
      ok: false,
      reason: `${s.length} characters. A tax invoice number may not exceed ${MAX_LENGTH}.`,
    };
  }
  if (!ALLOWED.test(s)) {
    return {
      ok: false,
      reason: 'Only letters, numbers, hyphen and slash are allowed in a bill number.',
    };
  }
  return { ok: true, reason: '' };
}

module.exports = {
  MAX_LENGTH,
  ALLOWED,
  MIN_SEQUENCE_WIDTH,
  DEFAULT_FY_START_MONTH,
  RESET_MODES,
  periodFor,
  compose,
  validate,
};
