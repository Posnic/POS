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
  const defaults = InstallService.newShopModuleDefaults({ demoData: true });

  test('exactly the four asked for are on', () => {
    const on = Object.entries(defaults)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort();
    expect(on).toEqual(
      [
        'module_themes_enable',
        'module_tax_enable',
        'quick_sale_enable',
        'module_demo_data_enable',
      ].sort()
    );
  });

  test('demo data follows what was asked for at setup', () => {
    /*
     * A switch that hides nothing, sitting in the menu inviting a question, is
     * worse than no switch - so a shop that chose an empty catalogue does not
     * get one.
     */
    expect(InstallService.newShopModuleDefaults({ demoData: true }).module_demo_data_enable).toBe(
      true
    );
    expect(InstallService.newShopModuleDefaults({ demoData: false }).module_demo_data_enable).toBe(
      false
    );
    expect(InstallService.newShopModuleDefaults().module_demo_data_enable).toBe(false);
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
      'module_recyclebin_enable',
    ]) {
      expect(defaults).toHaveProperty(key);
      expect(defaults[key]).toBe(false);
    }
  });

  test('every switch has a value - none is left to be inferred', () => {
    for (const [key, value] of Object.entries(defaults)) {
      expect(typeof value).toBe('boolean');
      /* Three naming eras, all gated the same way: module_* is the current
         one, quick_sale_ and quotes_ predate the prefix, and the staff_ and
         cash_register_ keys belong to the workforce and till work. The shape is not uniform, which
         is said out loud here rather than pretended away - a pattern that
         quietly excluded a real key would let a switch ship unset, and unset
         reads as ON. */
      expect(key).toMatch(/^(module_[a-z_]+|quick_sale|quotes|cash_register|staff_[a-z]+)_enable$/);
    }
  });

  test('the whole set is written when a branch is created', () => {
    /* Building the object and never saving it would leave the shop exactly as
       it was, with the defaults sitting in a function nobody calls. */
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/services/install.service.js'),
      'utf8'
    );
    /* With the argument: spreading the no-arg form would silently switch demo
       data off for every shop that asked for it. */
    expect(src).toMatch(/\.\.\.InstallService\.newShopModuleDefaults\(\{ demoData \}\)/);
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

/*
 * The backfill and the installer must agree.
 *
 * Two lists in two files, written for different reasons: install.service
 * decides what a NEW shop is created with, scripts/module-defaults-backfill
 * decides what an EXISTING shop with no history is given. Nothing but this
 * connects them.
 *
 * If they drift, the backfill puts a shop into a state no new shop is ever
 * created in - which is precisely the inconsistency the whole exercise was
 * meant to end, reintroduced by the fix for it.
 *
 * IT LIVES HERE RATHER THAN BESIDE THE BACKFILL because install.service
 * requires bcryptjs, an API dependency. The desktop test job installs the root
 * dependencies only, so a copy of this in tests/ passes on a developer's
 * machine - where api/node_modules happens to exist - and fails in CI. It did
 * exactly that once.
 */
describe('the backfill agrees with what a new shop is created with', () => {
  const path = require('path');
  const backfill = require(path.join(__dirname, '..', '..', '..', '..',
    'scripts', 'module-defaults-backfill.js'));

  test('a shop with no history is backfilled to the new-shop defaults', () => {
    const fresh = InstallService.newShopModuleDefaults({ demoData: false });
    const plan = backfill.planBranch({}, {}, backfill.FEATURES);

    for (const row of plan) {
      if (!(row.key in fresh)) continue;   // not something a new shop is given
      expect([row.key, row.value]).toEqual([row.key, fresh[row.key]]);
    }
  });

  test('every key the backfill writes is one the installer knows about', () => {
    /*
     * The other direction. A key in the backfill that the installer has never
     * heard of is a setting written to the whole estate and created for
     * nobody - so the two populations diverge from the day it is added.
     */
    const fresh = InstallService.newShopModuleDefaults({ demoData: true });
    const unknown = backfill.FEATURES
      .map((f) => f.key)
      .filter((k) => !(k in fresh));
    expect(unknown).toEqual([]);
  });
});
