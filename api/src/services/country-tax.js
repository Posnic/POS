'use strict';

/*
 * What tax rows, if any, a new shop in a given country should be created with.
 *
 * THE PROBLEM THIS EXISTS TO FIX
 *
 * countries.json carries a `tax` array per country, and the installer inserted
 * one tax record for every entry in it. For 128 of the 246 countries that
 * array is exactly one row: {"tax_name": "0% Tax", "tax_value": 0}.
 *
 * That is not a researched finding that the country has no consumption tax. It
 * is missing data wearing the costume of an answer. A shop in Angola was
 * provisioned with a real tax record, a tax column on its receipts, and the
 * clear implication that Posnic knows the Angolan regime. It does not.
 *
 * Owner's decision: those shops get NO tax at all, and are told they can switch
 * it on in Settings. An honest gap beats a confident zero.
 *
 * THE ORDER OF PREFERENCE, and why it is this way round
 *
 *   1. country_tax_rates.json, where the entry is `verified`
 *        A rate somebody cited to the country's own tax authority.
 *
 *   2. countries.json, where it carries a rate ABOVE zero
 *        118 countries do. Those have been provisioning correct shops for
 *        years, and dropping them while the sourced table is still being
 *        filled in would break far more than it fixed. They stay until a
 *        sourced entry replaces them.
 *
 *   3. nothing
 *        Only-zero rows, and countries nobody has data for. This is the fix.
 *
 * So the sourced table takes over country by country as it is filled in, and
 * on the day it is empty this file still removes every fake zero and changes
 * nothing else. That property is what makes it safe to ship before the
 * research is finished.
 */

const fs = require('fs');
const path = require('path');

const TABLE_PATH = path.join(__dirname, '../json/country_tax_rates.json');

/* Read once. The file ships with the application and cannot change under a
   running process; re-reading it per install would be a syscall per signup for
   a file that is identical every time. */
let cache = null;
function table() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    /* A missing or unparseable table must not stop a shop being created. It
       falls back to exactly the behaviour that shipped before it existed. */
    cache = {};
  }
  return cache;
}

/** Test seam. Nothing in production calls this. */
function _reset() {
  cache = null;
}

/*
 * A rate is only usable if somebody can be asked where it came from. The
 * fields are checked here rather than trusted, because the cost of a wrong
 * rate is a shop filing returns against it.
 */
function isUsable(entry) {
  if (!entry || entry.verified !== true) return false;
  if (!entry.sourceUrl || !entry.checkedAt) return false;
  if (entry.regime === 'none') return true;
  return Array.isArray(entry.rates) && entry.rates.length > 0;
}

/**
 * The tax rows to create for a country, and where the answer came from.
 *
 * @param {string} sortname       ISO-3166 alpha-2, as countries.json spells it
 * @param {Array}  legacyTaxRows  that country's `tax` array from countries.json
 * @returns {{source: string, rates: Array<{name: string, value: number}>, entry: object|null}}
 *          source is one of: sourced | none | legacy | unverified
 */
function taxRowsFor(sortname, legacyTaxRows) {
  const code = String(sortname || '').toUpperCase();
  const entry = code && !code.startsWith('_') ? table()[code] : null;

  if (isUsable(entry)) {
    /* A country proven to run no consumption tax is not the same as one nobody
       has looked up, and only this branch can tell you which you are in. */
    if (entry.regime === 'none') return { source: 'none', rates: [], entry };
    return {
      source: 'sourced',
      rates: entry.rates.map((r) => ({
        name: r.name || `${entry.label || 'Tax'} ${r.value}%`,
        value: Number(r.value),
        category: r.category || 'standard',
      })),
      entry,
    };
  }

  /*
   * The ARRAY is judged, not the individual rows.
   *
   * A 0% row sitting beside real rates is a genuine zero-rated band - India
   * ships one next to its six GST slabs, and a shop selling exempt goods
   * needs to be able to pick it. It is only a placeholder when it is the ONLY
   * thing there, which is exactly the 128-country case.
   *
   * The first version filtered row by row and quietly took India from seven
   * tax records to six. The requirement that India be unchanged is what
   * caught it, and it was right to be there.
   */
  const rows = Array.isArray(legacyTaxRows) ? legacyTaxRows : [];
  const hasRealRate = rows.some((r) => Number(r.tax_value) > 0);
  if (hasRealRate) {
    return {
      source: 'legacy',
      rates: rows.map((r) => ({
        name: r.tax_name,
        value: Number(r.tax_value),
        category: Number(r.tax_value) > 0 ? 'standard' : 'zero',
      })),
      entry: entry || null,
    };
  }

  return { source: 'unverified', rates: [], entry: entry || null };
}

/**
 * Whether a shop in this country starts with tax switched on.
 *
 * Read by the installer, and by the signup preview on the website, so both say
 * the same thing to the same person on the same day.
 */
function taxEnabledFor(sortname, legacyTaxRows) {
  return taxRowsFor(sortname, legacyTaxRows).rates.length > 0;
}

/** What to tell an owner whose country we have no tax data for. */
const NOT_CONFIGURED_NOTE =
  'Tax is not preconfigured for your country yet. You can switch it on and set your rates in Settings whenever you are ready.';

module.exports = { taxRowsFor, taxEnabledFor, isUsable, NOT_CONFIGURED_NOTE, _reset, TABLE_PATH };
