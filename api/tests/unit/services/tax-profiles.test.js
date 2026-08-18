'use strict';

/**
 * Country tax profiles, T0 (TAX_INTERNATIONALIZATION_RESEARCH.md).
 *
 * What must hold at this phase: every profile in the registry is complete
 * (a shop resolving any entry gets a working configuration); resolution
 * order is override > sortname > _default and never throws; an unknown
 * country is generic, not broken; registration validation follows the
 * profile's regex and degrades to accept-non-empty without one. Plus the
 * install currency fix: the chosen country's money, INR only as fallback.
 */

const profiles = require('../../../src/services/tax-profiles');
const InstallService = require('../../../src/services/install.service');

beforeEach(() => profiles.resetForTests());

describe('the registry', () => {
  test('every profile is complete - label, registration, components, display, rounding, receipt, reports', () => {
    const all = profiles.allProfiles();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(15);
    for (const [code, p] of Object.entries(all)) {
      expect(typeof p.label).toBe('string');
      expect(p.registration && typeof p.registration.label).toBe('string');
      expect(['single', 'split_equal', 'stacked']).toContain(p.components.mode);
      expect(['inclusive', 'exclusive']).toContain(p.display);
      expect(['line', 'invoice']).toContain(p.rounding.granularity);
      expect(Array.isArray(p.reports) && p.reports.length).toBeTruthy();
      expect(typeof p.receipt.breakdownPerRate).toBe('boolean');
      expect(code === '_default' || /^[A-Z]{2}$/.test(code)).toBe(true);
    }
  });

  test('India is the split_equal profile the current code implements', () => {
    const { IN } = profiles.allProfiles();
    expect(IN.components.mode).toBe('split_equal');
    expect(IN.components.intra).toEqual(['CGST', 'SGST']);
    expect(IN.components.inter).toEqual(['IGST']);
    expect(IN.components.placeOfSupply).toBe('state');
    expect(IN.display).toBe('inclusive');
    expect(IN.reports).toContain('gstr');
    expect(IN.receipt.itemCode).toBe('HSN');
  });

  test('the US is stacked-exclusive with no receipt registration line', () => {
    const { US } = profiles.allProfiles();
    expect(US.components.mode).toBe('stacked');
    expect(US.display).toBe('exclusive');
    expect(US.registration.onReceipt).toBe(false);
  });
});

describe('resolution', () => {
  test('sortname picks the profile; unknown lands on _default; nothing throws', () => {
    expect(profiles.profileForBranch({ sortname: 'IN' }).code).toBe('IN');
    expect(profiles.profileForBranch({ sortname: 'in' }).code).toBe('IN');
    expect(profiles.profileForBranch({ sortname: 'ZZ' }).code).toBe('_default');
    expect(profiles.profileForBranch({}).code).toBe('_default');
    expect(profiles.profileForBranch(null).code).toBe('_default');
    expect(profiles.profileForBranch(null).profile.label).toBe('Tax');
  });

  test('an explicit override beats the country', () => {
    const r = profiles.profileForBranch({ sortname: 'IN', tax_profile_override: 'GB' });
    expect(r.code).toBe('GB');
    // ...but an override the registry does not know falls through to the country
    const r2 = profiles.profileForBranch({ sortname: 'IN', tax_profile_override: 'XX' });
    expect(r2.code).toBe('IN');
  });
});

describe('registration validation', () => {
  test('the GSTIN regex accepts a real GSTIN and refuses garbage', () => {
    const { profile } = profiles.profileForBranch({ sortname: 'IN' });
    expect(profiles.registrationValid(profile, '33ABCDE1234F1Z5')).toBe(true);
    expect(profiles.registrationValid(profile, 'NOT-A-GSTIN')).toBe(false);
    expect(profiles.registrationValid(profile, '')).toBe(false);
  });

  test('a profile without a regex accepts anything non-empty', () => {
    const { profile } = profiles.profileForBranch({ sortname: 'ZZ' });
    expect(profiles.registrationValid(profile, 'anything at all')).toBe(true);
    expect(profiles.registrationValid(profile, '  ')).toBe(false);
  });
});

describe('install currency resolution (the INR hardcode fix)', () => {
  const svc = new InstallService();

  test('the chosen country gets its own money', () => {
    expect(svc._currencyForCountry('United States').currency_value[0]).toEqual({
      currency_text: 'USD',
      currency_sign: '$',
    });
    expect(svc._currencyForCountry('United Kingdom').currency_value[0].currency_text).toBe('GBP');
    expect(svc._currencyForCountry('India').currency_value[0]).toEqual({
      currency_text: 'INR',
      currency_sign: '₹',
    });
  });

  test('unknown or absent countries keep the historical INR default', () => {
    expect(svc._currencyForCountry('Atlantis').currency_value[0].currency_text).toBe('INR');
    expect(svc._currencyForCountry('').currency_value[0].currency_text).toBe('INR');
    expect(svc._currencyForCountry(null).currency_value[0].currency_text).toBe('INR');
  });
});
