'use strict';

/*
 * The India-only gate (INDIA_EINVOICING_DESIGN.md).
 *
 * The owner's rule: "make sure this feature shows only shop is in india."
 *
 * The test that carries the weight is the one where the feature flag is
 * ON and the shop is NOT Indian. That is the state a shop reaches by
 * switching e-invoicing on and later changing country, or by a settings
 * document copied between branches - and if the flag alone were consulted,
 * a shop in Kenya would be offered Indian GST e-invoicing with no way to
 * understand why. Availability is checked first, always.
 */

const applicability = require('../../../src/services/einvoice/applicability');
const profiles = require('../../../src/services/tax-profiles');
const fx = require('../../fixtures/einvoice');

beforeEach(() => profiles.resetForTests());

const indian = () => fx.branch();
const foreign = (over = {}) => fx.branch({ sortname: 'KE', country: 'Kenya', ...over });

describe('who may see the feature at all', () => {
  test('an Indian shop with GST on', () => {
    expect(applicability.isIndianShop(indian())).toBe(true);
    expect(applicability.isAvailable(indian())).toBe(true);
  });

  test('a shop in another country never sees it', () => {
    expect(applicability.isIndianShop(foreign())).toBe(false);
    expect(applicability.isAvailable(foreign())).toBe(false);
  });

  test('AND THE FLAG CANNOT OVERRIDE THAT', () => {
    /* The whole point. A stale or copied module_einvoice_enable must not
       keep an Indian-only feature alive in a shop that is not Indian. */
    expect(applicability.isEnabled(foreign(), { module_einvoice_enable: true })).toBe(false);
    expect(applicability.isEnabled(foreign(), { module_einvoice_enable: 'true' })).toBe(false);
  });

  test('an Indian shop with Indian GST switched off does not see it either', () => {
    const off = fx.branch({ indian_gst: 'gst_off' });
    expect(applicability.isAvailable(off)).toBe(false);
    expect(applicability.isEnabled(off, { module_einvoice_enable: true })).toBe(false);
  });

  test('a shop taxed as India by explicit override counts as Indian', () => {
    /* tax_profile_override is the documented way to say "tax me as India".
       Reading sortname directly would have missed it and produced two
       different answers to the same question. */
    const overridden = fx.branch({ sortname: 'KE', tax_profile_override: 'IN' });
    expect(applicability.isIndianShop(overridden)).toBe(true);
    expect(applicability.isAvailable(overridden)).toBe(true);
  });

  test('a missing or empty branch is not Indian', () => {
    expect(applicability.isIndianShop(null)).toBe(false);
    expect(applicability.isAvailable(undefined)).toBe(false);
    expect(applicability.isAvailable({})).toBe(false);
  });
});

describe('whether it is switched on', () => {
  test('off by default - an Indian shop that has never touched it', () => {
    expect(applicability.isEnabled(indian(), {})).toBe(false);
    expect(applicability.isEnabled(indian(), { module_einvoice_enable: false })).toBe(false);
    /* The string 'false' is the one that has bitten this codebase before. */
    expect(applicability.isEnabled(indian(), { module_einvoice_enable: 'false' })).toBe(false);
  });

  test('on when the shop switched it on, in either representation', () => {
    expect(applicability.isEnabled(indian(), { module_einvoice_enable: true })).toBe(true);
    expect(applicability.isEnabled(indian(), { module_einvoice_enable: 'true' })).toBe(true);
  });
});

describe('status, and saying why', () => {
  test('a foreign shop is refused for being foreign, before anything else', () => {
    const state = applicability.status(foreign(), { module_einvoice_enable: 'true' }, {});
    expect(state.reason).toBe('not_india');
    expect(state.available).toBe(false);
    expect(state.enabled).toBe(false);
    expect(applicability.unavailableMessage(state)).toMatch(/not set to India/i);
  });

  test('an Indian shop with GST off is told about GST, not about the feature', () => {
    const state = applicability.status(fx.branch({ indian_gst: 'gst_off' }), {}, {});
    expect(state.reason).toBe('gst_off');
    expect(applicability.unavailableMessage(state)).toMatch(/Tax Configuration/i);
  });

  test('an eligible shop that has not switched it on is told where the switch is', () => {
    const state = applicability.status(indian(), {}, {});
    expect(state.reason).toBe('feature_off');
    expect(state.available).toBe(true);
    expect(applicability.unavailableMessage(state)).toMatch(/Manage > Features/);
  });

  test('a shop that has it on has no complaint', () => {
    const state = applicability.status(indian(), { module_einvoice_enable: true }, {});
    expect(state.reason).toBeNull();
    expect(state.enabled).toBe(true);
    expect(applicability.unavailableMessage(state)).toBeNull();
  });
});

describe('turnover is reported, never enforced', () => {
  test('a shop below the threshold can still switch the feature on', () => {
    /* Voluntary registration exists, the threshold has only ever moved
       down, and refusing to let somebody prepare early would be the
       software overruling their accountant. */
    const state = applicability.status(
      indian(),
      { module_einvoice_enable: true },
      { india_turnover_above_5cr: false }
    );
    expect(state.enabled).toBe(true);
    expect(state.liable).toBe(false);
  });

  test('the turnover flags are carried through for the checks that use them', () => {
    const state = applicability.status(
      indian(),
      { module_einvoice_enable: true },
      {
        india_turnover_above_5cr: 'true',
        india_turnover_above_10cr: true,
        india_einvoice_from: '2026-04-01',
      }
    );
    expect(state.liable).toBe(true);
    expect(state.reportingWindow).toBe(true);
    expect(state.einvoiceFrom).toBe('2026-04-01');
  });
});
