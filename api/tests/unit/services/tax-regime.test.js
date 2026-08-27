'use strict';

/*
 * The regime resolver rides ON TOP of the T0 tax-profile registry
 * (PURCHASE_TAX_PLAN §3/G6): country knowledge lives in tax_profiles.json,
 * the `tax` settings group carries only a shop's own decisions, and this
 * module is where the two meet. These pins hold that division of knowledge -
 * a second copy of any country fact is where the two drift apart.
 */

const {
  resolveRegime,
  installDecisionsFor,
  creditFlagLabel,
} = require('../../../src/services/tax-regime');
const { GROUPS } = require('../../../src/services/settings-groups');

describe('tax regime resolution', () => {
  test('India resolves to the credit family with its own profile intact', () => {
    const r = resolveRegime({ sortname: 'IN' });
    expect(r.regime).toBe('vat_credit');
    expect(r.code).toBe('IN');
    expect(r.profile.label).toBe('GST');
    expect(r.profile.registration.label).toBe('GSTIN');
    expect(r.profile.components.mode).toBe('split_equal');
  });

  test('the United States resolves to the sales-tax family', () => {
    const r = resolveRegime({ sortname: 'US' });
    expect(r.regime).toBe('sales_tax');
    expect(r.profile.label).toBe('Sales Tax');
  });

  test('a VAT country and an unknown country both resolve to credit-family defaults', () => {
    expect(resolveRegime({ sortname: 'DE' }).regime).toBe('vat_credit');
    const unknown = resolveRegime({ sortname: 'XX' });
    expect(unknown.regime).toBe('vat_credit');
    expect(unknown.code).toBe('_default');
  });

  test("the shop's own override outranks the flag, and junk never does", () => {
    expect(resolveRegime({ sortname: 'IN' }, { tax_regime: 'none' }).regime).toBe('none');
    expect(resolveRegime({ sortname: 'US' }, { tax_regime: 'vat_credit' }).regime).toBe(
      'vat_credit'
    );
    expect(resolveRegime({ sortname: 'IN' }, { tax_regime: 'nonsense' }).regime).toBe('vat_credit');
  });

  test('every registry profile declares a regime the resolver understands', () => {
    const all = require('../../../src/services/tax-profiles').allProfiles();
    for (const [code, profile] of Object.entries(all)) {
      expect(['vat_credit', 'sales_tax', 'none']).toContain(profile.regime);
      expect(code).toBeDefined();
    }
  });

  test('only countries with real decisions get installer defaults', () => {
    expect(installDecisionsFor('IN')).toMatchObject({
      india_gst_type: 'regular',
      india_turnover_above_5cr: false,
    });
    expect(installDecisionsFor('DE')).toEqual({});
    expect(installDecisionsFor('US')).toEqual({});
  });

  test('every decision key belongs to the tax settings group', () => {
    for (const key of Object.keys(installDecisionsFor('IN'))) {
      expect(GROUPS.tax).toContain(key);
    }
    expect(GROUPS.tax).toContain('us_resale_certificate');
    expect(GROUPS.tax).toContain('tax_regime');
  });

  test('the credit flag speaks the family language', () => {
    expect(creditFlagLabel('vat_credit')).toBe('Input credit claimable');
    expect(creditFlagLabel('sales_tax')).toBe('Purchased for resale (tax-exempt)');
  });
});
