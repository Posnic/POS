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

/*
 * S4 - credentials stop travelling outwards.
 *
 * Two halves that only work together. Redaction alone would be a data-loss
 * bug: the settings form round-trips what it was given, so the first save
 * after the password stops coming back would write the empty field over the
 * stored one and silence the shop's mail. Empty therefore means "unchanged",
 * and clearing has to be said out loud.
 */
const {
  BRANCH_CREDENTIALS,
  CLEAR_SECRET,
  redactBranchSecrets,
  secretUpdate,
} = require('../../../src/services/settings-groups');

describe('branch credentials leave the server only as a yes/no', () => {
  const branch = {
    name: 'Sridhar',
    roundOff: true,
    email_smtp_username: 'billing@shop.in',
    email_smtp_password: 'hunter2',
    smtp_password: 'legacy-pass',
    way2sms_password: 'sms-pass',
    way2sms_api: 'w2s-key',
    way2sms_userid: 'shopuser',
    textlocal_api: '',
  };

  test('no credential value survives the response', () => {
    const out = redactBranchSecrets(branch);
    const asText = JSON.stringify(out);
    for (const secret of ['hunter2', 'legacy-pass', 'sms-pass', 'w2s-key']) {
      expect(asText).not.toContain(secret);
    }
    for (const key of BRANCH_CREDENTIALS) {
      expect(out[key]).toBeUndefined();
    }
  });

  test('but the card can still say which are configured', () => {
    const out = redactBranchSecrets(branch);
    expect(out.secrets_configured.email_smtp_password).toBe(true);
    expect(out.secrets_configured.way2sms_api).toBe(true);
    // an empty string is absent, not a set password
    expect(out.secrets_configured.textlocal_api).toBe(false);
  });

  test('identifiers are not credentials and stay readable', () => {
    const out = redactBranchSecrets(branch);
    expect(out.email_smtp_username).toBe('billing@shop.in');
    expect(out.way2sms_userid).toBe('shopuser');
    expect(out.roundOff).toBe(true);
  });

  test('the source document is not mutated on the way out', () => {
    redactBranchSecrets(branch);
    expect(branch.email_smtp_password).toBe('hunter2');
  });

  test('junk in gives junk back rather than throwing', () => {
    expect(redactBranchSecrets(null)).toBeNull();
    expect(redactBranchSecrets('nope')).toBe('nope');
  });
});

describe('an empty credential means unchanged, never blank it', () => {
  test('absent or empty writes nothing at all', () => {
    expect(secretUpdate('email_smtp_password', undefined)).toEqual({});
    expect(secretUpdate('email_smtp_password', null)).toEqual({});
    expect(secretUpdate('email_smtp_password', '')).toEqual({});
  });

  test('a real value is written', () => {
    expect(secretUpdate('email_smtp_password', 'hunter2')).toEqual({
      email_smtp_password: 'hunter2',
    });
  });

  test('clearing is possible, but has to be said out loud', () => {
    expect(secretUpdate('email_smtp_password', CLEAR_SECRET)).toEqual({
      email_smtp_password: '',
    });
  });

  test('the value is not trimmed - a password may end in a space', () => {
    expect(secretUpdate('email_smtp_password', ' pw ')).toEqual({
      email_smtp_password: ' pw ',
    });
  });
});
