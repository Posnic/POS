'use strict';

/*
 * GST 2.0 readiness scan (HSN_GST2_RATE_REFRESH_DESIGN, increments 2 and 3).
 *
 * Read-only by construction: this module reports, it never writes a rate.
 *
 * The reference is now the notification itself. api/src/json/gst_rates_2025.json
 * is built from CBIC Notification 9/2025-Integrated Tax (Rate) - the schedules
 * ARE the rates, so nothing here is inferred from a summary. It replaces the
 * bundled hsn.json, which predated GST 2.0 and would have advised shops to
 * move correctly-set items back onto withdrawn slabs.
 *
 * The extraction is deliberately timid, and the dataset says so about itself:
 * a heading whose goods are carved out ("other than", "except") or that two
 * schedules both claim - a car at 18% under 4m and 40% above it - is recorded
 * as QUALIFIED, and the scan stays silent on it. Saying nothing costs a shop
 * nothing; saying the wrong rate mis-taxes a real invoice.
 */

/*
 * Read from the notification itself (api/src/json/gst_rates_2025.json, built
 * from Notification 9/2025-IT(Rate)), not from memory. Its schedules are the
 * only slabs that exist: 0.25, 1.5, 3, 5, 18, 28 and 40.
 *
 * 12% is genuinely gone - it appears nowhere in the notification.
 *
 * 28% is NOT. It survives as Schedule VII, which is exactly six entries:
 * pan masala and tobacco. An earlier version of this file listed 28 as
 * retired, which would have told a tobacco or pan-masala seller their
 * correct rate was withdrawn - wrong advice on a compliance report, and the
 * reason this now reads the document instead of a remembered summary.
 */
const RETIRED_SLABS = [12];
const LIVE_SLABS = [0, 0.25, 1.5, 3, 5, 18, 28, 40];
/* 28% is live only for these goods. Anything else sitting at 28% is worth a
   look, but it is a QUESTION, not the certainty that 12% is. */
const RESTRICTED_SLABS = { 28: 'pan masala and tobacco (Schedule VII)' };

const SOURCE = {
  reference: 'CBIC Notification 9/2025-IT(Rate) schedules',
  rule: 'CBIC Notification 9/2025, eff. 22 September 2025',
};

let _index = null;

/*
 * code -> rate, plus the set the dataset flags as unsafe to assert.
 * HSN is hierarchical, so an 8-digit code falls back to its 6- and 4-digit
 * parents; a qualified parent stops the walk rather than answering.
 */
const rateIndex = () => {
  if (_index) return _index;
  let rates = {};
  let qualified = {};
  try {
    const data = require('../json/gst_rates_2025.json');
    rates = data.rates || {};
    qualified = data.qualified || {};
  } catch (e) {
    /* no dataset: the retired-slab half still works without any reference */
  }
  _index = { rates, qualified };
  return _index;
};

/*
 * Longest match wins: an exact code beats its heading. Anything shorter than
 * 4 digits is a chapter - far too broad to hang a rate on. A code the dataset
 * quarantined returns null, which the caller treats as "say nothing".
 */
const referenceRateFor = (hsncode) => {
  const code = String(hsncode || '').replace(/\D/g, '');
  if (code.length < 4) return null;
  const { rates, qualified } = rateIndex();
  for (const len of [8, 6, 4]) {
    if (code.length < len) continue;
    const key = code.slice(0, len);
    if (qualified[key] !== undefined) return null;
    if (rates[key] !== undefined) return { rate: rates[key], matchedOn: key };
  }
  return null;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/*
 * items: plain docs carrying at least { _id, name/item_name, tax, hsncode }.
 * Returns the two lists plus a count of what was examined, so the page can
 * say "12 of 340 items" rather than implying the rest were unreadable.
 */
const scanItems = (items = []) => {
  const retired = [];
  const differs = [];
  let examined = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    examined += 1;

    const rate = round2(item.tax);
    const name = String(item.item_name || item.name || '').trim();
    const hsncode = String(item.hsncode || '').trim();
    const base = {
      id: String(item._id || ''),
      name,
      hsncode,
      hsndescription: String(item.hsndescription || '').trim(),
      rate,
    };

    if (RETIRED_SLABS.includes(rate)) {
      retired.push({
        ...base,
        reason: `${rate}% was withdrawn by ${SOURCE.rule}`,
        source: SOURCE.rule,
      });
      // A retired slab is the louder finding; do not also list it below.
      continue;
    }
    if (RESTRICTED_SLABS[rate]) {
      retired.push({
        ...base,
        restricted: true,
        reason: `${rate}% now applies only to ${RESTRICTED_SLABS[rate]} - correct for those goods, worth checking for anything else`,
        source: SOURCE.rule,
      });
      continue;
    }

    if (!hsncode) continue;
    const ref = referenceRateFor(hsncode);
    if (!ref) continue;
    // Silence where the reference itself is stale - see the header.
    if (!LIVE_SLABS.includes(ref.rate)) continue;
    if (ref.rate === rate) continue;

    differs.push({
      ...base,
      reference_rate: ref.rate,
      matched_on: ref.matchedOn,
      reason: `Reference lists ${ref.rate}% for HSN ${ref.matchedOn}`,
      source: SOURCE.reference,
    });
  }

  return {
    retired,
    differs,
    examined,
    /* The page prints this: a shop should know the reference is dated. */
    notice:
      'Rates come from ' +
      SOURCE.rule +
      '. Headings whose goods are carved out, or that two schedules both claim, are ' +
      'left out rather than guessed at. Check each suggestion against the notification ' +
      'before changing a rate - nothing here changes a tax by itself.',
  };
};

module.exports = {
  scanItems,
  referenceRateFor,
  RETIRED_SLABS,
  LIVE_SLABS,
  RESTRICTED_SLABS,
  SOURCE,
};
