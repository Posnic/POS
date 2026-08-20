'use strict';

/*
 * The settings grouping (SETTINGS_AND_BRANCH_SCOPE_DESIGN, step S1).
 *
 * The grouping is the load-bearing decision of that design, so it is tested
 * on its own before any data moves. Two properties matter most:
 *
 *   - a key belongs to exactly ONE group, or a save through one endpoint
 *     could silently contradict a save through another;
 *   - SMTP credentials live in `secrets` and nowhere else, because the whole
 *     point of that group is that it can be write-only and never copied
 *     between branches. A password that leaks into `preferences` would be
 *     shipped to every client that reads settings, which is the situation
 *     this design exists to end.
 */

const { GROUPS, groupOf, splitByGroup, SECRETS } = require('../../../src/services/settings-groups');

describe('settings grouping', () => {
  test('every key belongs to exactly one group', () => {
    const seen = new Map();
    const duplicates = [];
    for (const [group, keys] of Object.entries(GROUPS)) {
      for (const key of keys) {
        if (seen.has(key)) {
          duplicates.push(`${key} in both ${seen.get(key)} and ${group}`);
        }
        seen.set(key, group);
      }
    }
    expect(duplicates).toEqual([]);
  });

  test('every SMTP credential is a secret and nothing else', () => {
    for (const key of SECRETS) {
      expect(groupOf(key)).toBe('secrets');
    }
    // the password especially - this is the one that must never travel
    expect(groupOf('email_smtp_password')).toBe('secrets');
    expect(GROUPS.preferences).not.toContain('email_smtp_password');
    expect(GROUPS.features).not.toContain('email_smtp_password');
    expect(GROUPS.documents).not.toContain('email_smtp_password');
  });

  test('the module toggles the server already maintains are all features', () => {
    // mirrors setting.model's TOGGLES map - if a toggle is added there and not
    // here it would land in `unknown` and be dropped by a grouped save
    const serverToggles = [
      'staff_shifts_enable',
      'staff_tips_enable',
      'staff_roster_enable',
      'cash_register_enable',
      'till_lock_enable',
      'module_tax_enable',
      'module_credit_enable',
      'module_marketing_enable',
      'module_messaging_enable',
      'module_channels_enable',
      'module_channels_kiosk_enable',
      'module_recyclebin_enable',
      'module_themes_enable',
      'module_cashbook_enable',
      'quick_sale_enable',
      'quotes_enable',
      'pl_include_cashbook',
    ];
    const misplaced = serverToggles.filter((k) => groupOf(k) !== 'features');
    expect(misplaced).toEqual([]);
  });

  test('the three payloads that caused real bugs each land in one group', () => {
    // the signature upload (5c84111 / 69bc0cd) - documents only
    const sig = splitByGroup({ quote_default_signature: 'data:image/png;base64,AAA' });
    expect(Object.keys(sig.documents)).toEqual(['quote_default_signature']);
    expect(sig.preferences).toEqual({});
    expect(sig.features).toEqual({});
    expect(sig.secrets).toEqual({});

    // the Features page save - features only
    const feat = splitByGroup({ custom_charges_enable: 'true', quotes_enable: 'true' });
    expect(Object.keys(feat.features).sort()).toEqual(['custom_charges_enable', 'quotes_enable']);
    expect(feat.preferences).toEqual({});

    // the shop's own mail card - secrets only
    const mail = splitByGroup({ email_smtp_host: 'smtp.example.com', email_smtp_password: 'x' });
    expect(Object.keys(mail.secrets).sort()).toEqual(['email_smtp_host', 'email_smtp_password']);
    expect(mail.preferences).toEqual({});
  });

  test('an unrecognised key is reported, not silently dropped', () => {
    const out = splitByGroup({ quotes_enable: 'true', not_a_real_setting: 1 });
    expect(out.unknown).toEqual({ not_a_real_setting: 1 });
    expect(out.features).toEqual({ quotes_enable: 'true' });
  });

  test('groupOf answers null for something it does not know', () => {
    expect(groupOf('nope')).toBeNull();
    expect(groupOf('')).toBeNull();
    expect(groupOf(undefined)).toBeNull();
  });

  test('splitByGroup tolerates junk input', () => {
    expect(splitByGroup(null).unknown).toEqual({});
    expect(splitByGroup(undefined).features).toEqual({});
  });
});
