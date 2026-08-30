'use strict';

/*
 * Which tax rows a new shop is created with, and - the point of the file -
 * when it gets none.
 *
 * countries.json carries a `tax` array per country, and 128 of the 246 entries
 * are exactly one row: {"tax_name": "0% Tax", "tax_value": 0}. That is missing
 * data wearing the costume of an answer. The installer inserted it, so a shop
 * in Angola was provisioned with a real tax record, a tax column on its
 * receipts, and the clear implication that we know the Angolan regime.
 *
 * Owner's decision: no tax at all for those, and tell the owner how to switch
 * it on. What these pins protect is the ORDER of preference, because getting
 * it wrong in the other direction - dropping the 118 countries that do have
 * real rates - would break far more than it fixed.
 */

const fs = require('fs');
const countryTax = require('../../../src/services/country-tax');

const ZERO_ONLY = [{ tax_name: '0% Tax', tax_value: 0 }];
const REAL = [
  { tax_name: '0% Tax', tax_value: 0 },
  { tax_name: '18% Tax', tax_value: 18 },
];

describe('country tax rows for a new shop', () => {
  beforeEach(() => countryTax._reset());

  test('a country whose only row is a fake zero gets NO tax', () => {
    const plan = countryTax.taxRowsFor('AO', ZERO_ONLY);
    expect(plan.rates).toHaveLength(0);
    expect(plan.source).toBe('unverified');
    expect(countryTax.taxEnabledFor('AO', ZERO_ONLY)).toBe(false);
  });

  test('a country with a real rate keeps it', () => {
    /*
     * 118 countries carry actual rates and have been provisioning correct
     * shops for years. Dropping them while the sourced table is still being
     * filled in would be a far larger regression than the bug being fixed.
     */
    const plan = countryTax.taxRowsFor('IN', REAL);
    expect(plan.source).toBe('legacy');
    expect(plan.rates.map((r) => r.value)).toEqual([0, 18]);
  });

  test('a zero band BESIDE real rates is kept, because it is a real band', () => {
    /*
     * India ships a 0% row next to its six GST slabs and a shop selling exempt
     * goods needs to pick it. Only an all-zero array is a placeholder.
     *
     * The first version filtered row by row and took India from seven tax
     * records to six. Nothing would have failed except a customer's returns.
     */
    const plan = countryTax.taxRowsFor('IN', REAL);
    expect(plan.rates.map((r) => r.value)).toEqual([0, 18]);
    expect(plan.rates.find((r) => r.value === 0).category).toBe('zero');
  });

  test('India is created with exactly the tax rows it is created with today', () => {
    /* The acceptance criterion, pinned against the real file rather than a
       fixture - a change to countries.json that altered India would fail here. */
    const fs2 = require('fs');
    const path2 = require('path');
    const countries = JSON.parse(fs2.readFileSync(
      path2.join(__dirname, '../../../src/json/countries.json'), 'utf8'));
    const india = (countries.countries || countries).find((c) => c.value === 'India');
    const plan = countryTax.taxRowsFor(india.sortname, india.tax);
    expect(plan.rates).toHaveLength(india.tax.length);
    expect(plan.rates.map((r) => r.name)).toEqual(india.tax.map((t) => t.tax_name));
    expect(plan.rates.map((r) => r.value)).toEqual(india.tax.map((t) => Number(t.tax_value)));
  });

  test('an unknown country gets nothing rather than a guess', () => {
    expect(countryTax.taxRowsFor('ZZ', []).rates).toHaveLength(0);
    expect(countryTax.taxRowsFor('', null).rates).toHaveLength(0);
    expect(countryTax.taxRowsFor(undefined, undefined).rates).toHaveLength(0);
  });

  test('the schema keys in the table are never read as countries', () => {
    /* The file carries _comment, _rules and _schema beside the country codes. */
    for (const k of ['_comment', '_rules', '_schema']) {
      expect(countryTax.taxRowsFor(k, ZERO_ONLY).rates).toHaveLength(0);
    }
  });
});

describe('what makes a sourced rate usable', () => {
  test('a rate with no source is refused however verified it claims to be', () => {
    /*
     * The cost of a wrong rate is a shop filing returns against it, so the
     * citation is checked rather than trusted. "verified: true" with nothing
     * to point at is exactly the state this whole change exists to reject.
     */
    expect(countryTax.isUsable({ verified: true, rates: [{ value: 5 }] })).toBe(false);
    expect(countryTax.isUsable({ verified: true, sourceUrl: 'x', rates: [{ value: 5 }] })).toBe(false);
    expect(
      countryTax.isUsable({ verified: true, sourceUrl: 'x', checkedAt: '2026-08-30', rates: [{ value: 5 }] })
    ).toBe(true);
  });

  test('unverified is refused even with a source', () => {
    expect(
      countryTax.isUsable({ verified: false, sourceUrl: 'x', checkedAt: '2026-08-30', rates: [{ value: 5 }] })
    ).toBe(false);
  });

  test('"no consumption tax" is a finding, not the absence of one', () => {
    /*
     * regime:"none" means somebody proved it. It has to be usable WITHOUT
     * rates, and it must never be confused with a country nobody looked up -
     * they produce the same empty shop but only one of them is knowledge.
     */
    const proven = { verified: true, regime: 'none', rates: [], sourceUrl: 'x', checkedAt: '2026-08-30' };
    expect(countryTax.isUsable(proven)).toBe(true);
  });
});

describe('the shipped table', () => {
  test('every entry that claims verification carries its citation', () => {
    /* The rule the file states about itself, enforced. */
    const raw = JSON.parse(fs.readFileSync(countryTax.TABLE_PATH, 'utf8'));
    for (const [code, entry] of Object.entries(raw)) {
      if (code.startsWith('_')) continue;
      expect(code).toMatch(/^[A-Z]{2}$/);
      if (entry.verified === true) {
        expect(typeof entry.sourceUrl).toBe('string');
        expect(entry.sourceUrl.length).toBeGreaterThan(0);
        expect(entry.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['vat_credit', 'sales_tax', 'none']).toContain(entry.regime);
      }
    }
  });

  test('a rate is never zero-only, which is the thing being removed', () => {
    const raw = JSON.parse(fs.readFileSync(countryTax.TABLE_PATH, 'utf8'));
    for (const [code, entry] of Object.entries(raw)) {
      if (code.startsWith('_') || entry.regime === 'none') continue;
      if (!Array.isArray(entry.rates) || !entry.rates.length) continue;
      expect(entry.rates.some((r) => Number(r.value) > 0)).toBe(true);
    }
  });

  test('a missing table changes nothing', () => {
    /*
     * It ships with the application, but a shop must not fail to be created
     * because a JSON file did not parse. With no table at all the behaviour is
     * exactly what shipped before it existed, minus the fake zeros.
     */
    countryTax._reset();
    const orig = fs.readFileSync;
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
      if (String(p) === countryTax.TABLE_PATH) throw new Error('ENOENT');
      return orig(p, ...rest);
    });
    try {
      expect(countryTax.taxRowsFor('IN', REAL).rates.map((r) => r.value)).toEqual([0, 18]);
      expect(countryTax.taxRowsFor('AO', ZERO_ONLY).rates).toHaveLength(0);
    } finally {
      fs.readFileSync.mockRestore();
      countryTax._reset();
    }
  });
});

describe('what the owner is told', () => {
  test('the note says tax is off and where to turn it on', () => {
    /* An empty tax setup with no explanation reads as a broken install. */
    expect(countryTax.NOT_CONFIGURED_NOTE).toMatch(/not preconfigured/i);
    expect(countryTax.NOT_CONFIGURED_NOTE).toMatch(/Settings/);
  });
});
