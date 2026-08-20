'use strict';

/*
 * GST 2.0 readiness scan (HSN_GST2_RATE_REFRESH_DESIGN, increment 2).
 *
 * Read-only by construction: this module reports, it never writes a rate.
 * The design's first hard rule is "suggest, never apply", and the reason
 * is visible right here in the data.
 *
 * CBIC Notification 9/2025 (eff. 22 Sep 2025) retired the 12% and 28%
 * slabs. The HSN reference bundled with this product (api/src/json/
 * hsn.json) still carries them - 661 codes at 12% and 1,476 at 28% - so
 * it PREDATES the notification. Treating it as authoritative would tell a
 * shop to move a correctly-set 18% item back to 28%, which is worse than
 * saying nothing at all.
 *
 * So the scan has two halves with very different confidence:
 *
 *   retired  - the item's OWN rate is a slab that no longer exists. This
 *              needs no reference data and cannot be wrong: 12% and 28%
 *              were withdrawn on a known date. Actionable as-is.
 *   differs  - the item's rate disagrees with the bundled reference, and
 *              ONLY where that reference still names a live slab
 *              (0/5/18). Where the reference itself says 12% or 28% we
 *              stay silent, because we cannot know what the code became.
 *
 * Increment 3 replaces the reference with an operator-supplied,
 * notification-stamped dataset; the shape below already separates
 * "reference says" from "rule says" so that swap changes one lookup.
 */

// Withdrawn by Notification 9/2025. Rates are compared as numbers.
const RETIRED_SLABS = [12, 28];
// Slabs that survived (or arrived with) GST 2.0.
const LIVE_SLABS = [0, 5, 18, 40];

const SOURCE = {
  reference: 'Bundled HSN reference (pre-GST 2.0)',
  rule: 'CBIC Notification 9/2025, eff. 22 September 2025',
};

let _byLen = null;

/*
 * The reference file lists 8-digit codes only, but shops type 4- and
 * 6-digit ones. HSN is hierarchical, so a shorter code's rate can be
 * derived from its children - but ONLY when every child agrees. A 4-digit
 * heading whose children span 5% and 18% has no single answer, and
 * inventing one is exactly the kind of confident-but-wrong suggestion this
 * feature must not make, so those parents are dropped from the index and
 * the scan simply says nothing about them.
 *
 * Rates in the file look like "18%", "0" or "---".
 */
const rateIndex = () => {
  if (_byLen) return _byLen;
  const exact = new Map();
  const seen = { 6: new Map(), 4: new Map() };
  try {
    const rows = require('../json/hsn.json').hsn || [];
    for (const row of rows) {
      const code = String((row && row.value) || '')
        .replace(/\D/g, '')
        .trim();
      if (code.length < 4) continue;
      const raw = String((row && row.taxrate) || '')
        .replace('%', '')
        .trim();
      if (raw === '' || !/^\d+(\.\d+)?$/.test(raw)) continue;
      const rate = Number(raw);
      exact.set(code, rate);
      for (const len of [6, 4]) {
        if (code.length < len) continue;
        const key = code.slice(0, len);
        if (!seen[len].has(key)) seen[len].set(key, new Set());
        seen[len].get(key).add(rate);
      }
    }
  } catch (e) {
    /* no reference available: the retired-slab half still works */
  }
  const collapse = (m) => {
    const out = new Map();
    for (const [key, rates] of m) {
      if (rates.size === 1) out.set(key, rates.values().next().value);
    }
    return out;
  };
  _byLen = { 8: exact, 6: collapse(seen[6]), 4: collapse(seen[4]) };
  return _byLen;
};

/*
 * Longest match wins: an exact code beats its heading. Anything shorter
 * than 4 digits is a chapter - far too broad to hang a rate on.
 */
const referenceRateFor = (hsncode) => {
  const code = String(hsncode || '').replace(/\D/g, '');
  if (code.length < 4) return null;
  const index = rateIndex();
  for (const len of [8, 6, 4]) {
    if (code.length < len) continue;
    const key = code.slice(0, len);
    const hit = len === 8 ? index[8].get(key) : index[len].get(key);
    if (hit !== undefined) return { rate: hit, matchedOn: key };
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
      'The bundled HSN reference predates GST 2.0, so it is used only where it ' +
      'still names a live slab. Verify every suggestion against ' +
      SOURCE.rule +
      ' before changing a rate. Nothing here changes a tax by itself.',
  };
};

module.exports = { scanItems, referenceRateFor, RETIRED_SLABS, LIVE_SLABS, SOURCE };
