'use strict';

const InstallService = require('../../../src/services/install.service');

/*
 * What a new shop starts with.
 *
 * Owner ask, made more than once: "for new customer sign up i see so many
 * features enabled... by default enable only Recycle bin, Themes, Tax only."
 *
 * WHY IT LOOKED LIKE EVERYTHING WAS ON. Nothing was ever switched on. The
 * client reads `settings[key] !== false`, so a key that was never saved reads
 * as enabled - and a brand-new shop had none of them saved. Ten features
 * appeared on because ten features were absent, which is not a decision
 * anybody made.
 *
 * The read rule is deliberately NOT changed: every shop already running relies
 * on absent-meaning-on, and flipping it would switch features off in all of
 * them on the next deploy, silently. So the values are written instead.
 */
describe('a new shop’s feature switches', () => {
  const defaults = InstallService.newShopModuleDefaults();

  test('exactly the three asked for are on', () => {
    const on = Object.entries(defaults)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort();
    expect(on).toEqual(
      [
        'module_demo_data_enable',
        'module_recyclebin_enable',
        'module_tax_enable',
        'module_themes_enable',
      ].sort()
    );
  });

  test('demo data is the only addition, and it has a reason', () => {
    /* The shop was just seeded with sample products; hiding them the moment
       they arrive would be its own confusion. */
    expect(defaults.module_demo_data_enable).toBe(true);
  });

  test('everything else is explicitly off, not merely absent', () => {
    /*
     * The whole bug. `false` and "not mentioned" are the same thing to a
     * human reading this object and opposite things to the client.
     */
    for (const key of [
      'module_credit_enable',
      'module_marketing_enable',
      'module_messaging_enable',
      'module_channels_enable',
      'module_channels_kiosk_enable',
      'module_cashbook_enable',
    ]) {
      expect(defaults).toHaveProperty(key);
      expect(defaults[key]).toBe(false);
    }
  });

  test('every switch has a value - none is left to be inferred', () => {
    for (const [key, value] of Object.entries(defaults)) {
      expect(typeof value).toBe('boolean');
      expect(key).toMatch(/^module_/);
    }
  });

  test('the whole set is written when a branch is created', () => {
    /* Building the object and never saving it would leave the shop exactly as
       it was, with the defaults sitting in a function nobody calls. */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/services/install.service.js'),
      'utf8'
    );
    expect(src).toMatch(/\.\.\.InstallService\.newShopModuleDefaults\(\)/);
  });

  test('it covers every switch the client reads', () => {
    /*
     * If the client gates a menu on a key this does not write, that feature is
     * on for every new shop and nobody finds out until somebody complains
     * about it - which is how this started.
     */
    const client = require('fs').readFileSync(
      require('path').join(__dirname, '../../../../frontend/static/script/js/core/PosnicPro.js'),
      'utf8'
    );
    const gated = new Set([...client.matchAll(/on\('(module_[a-z_]+)'\)/g)].map((m) => m[1]));
    const written = new Set(Object.keys(defaults));
    const missing = [...gated].filter((k) => !written.has(k));
    expect(missing).toEqual([]);
  });
});
