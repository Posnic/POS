'use strict';

/*
 * Settings read path (S1). The precedence IS the feature, so it is pinned
 * directly: branch beats account beats the legacy branches document.
 *
 * The subtle one is `null`. In a branch row null means INHERIT - fall
 * through to the account value - which is a different thing from `false`,
 * meaning "off here". Without that distinction "change it once for every
 * shop" cannot work, because a branch row would always shadow the account
 * row whatever it held, and the whole account level would be decorative.
 */

const mockCollections = {};
const mkCol = () => ({ findOne: jest.fn().mockResolvedValue(null) });

jest.mock('../../../src/models/base.model', () => {
  return class MockBaseModel {
    constructor(name) {
      this.collectionName = name;
    }

    async getCollection(name) {
      if (!mockCollections[name]) mockCollections[name] = mkCol();
      return mockCollections[name];
    }
  };
});

jest.mock('mongodb', () => {
  const ObjectIdMock = function (id) {
    return { toString: () => String(id), _id: String(id) };
  };
  ObjectIdMock.isValid = (v) => /^[0-9a-fA-F]{24}$/.test(String(v));
  return { ObjectId: ObjectIdMock };
});

const SettingsRepository = require('../../../src/repositories/settings.repository');

const BRANCH = '64b000000000000000000001';
const LICENSE = '64b000000000000000000002';
const ctx = { branchId: BRANCH, licenseId: LICENSE };

/* branchRow / accountRow / legacy each either an object or null */
const seed = ({ branchRow = null, accountRow = null, legacy = null } = {}) => {
  for (const name of Object.keys(mockCollections)) delete mockCollections[name];
  const features = mkCol();
  features.findOne = jest.fn((filter) =>
    Promise.resolve(filter.branch_id === null ? accountRow : branchRow)
  );
  mockCollections.branch_features = features;
  const branches = mkCol();
  branches.findOne = jest.fn().mockResolvedValue(legacy);
  mockCollections.branches = branches;
};

describe('settings read path', () => {
  let repo;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repo = new SettingsRepository();
  });

  test('a branch value wins over the account value', async () => {
    seed({ branchRow: { quotes_enable: false }, accountRow: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(false);
    expect(r.data.source.quotes_enable).toBe('branch');
  });

  test('null in the branch row means INHERIT, not off', async () => {
    // the distinction the account level depends on
    seed({ branchRow: { quotes_enable: null }, accountRow: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(true);
    expect(r.data.source.quotes_enable).toBe('account');
  });

  test('false in the branch row is respected - it is a decision, not an absence', async () => {
    seed({ branchRow: { quotes_enable: false }, accountRow: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(false);
  });

  test('with no rows at all it falls back to the legacy branches document', async () => {
    seed({ legacy: { quotes_enable: true, module_tax_enable: false } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(true);
    expect(r.data.values.module_tax_enable).toBe(false);
    expect(r.data.source.quotes_enable).toBe('legacy');
  });

  test('the account row beats the legacy document', async () => {
    seed({ accountRow: { quotes_enable: false }, legacy: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(false);
    expect(r.data.source.quotes_enable).toBe('account');
  });

  test('a group only ever returns keys it owns', async () => {
    // a printing preference sitting in a features row must not come back
    seed({ branchRow: { quotes_enable: true, print_type: 'a4', email_smtp_password: 'x' } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(true);
    expect(r.data.values).not.toHaveProperty('print_type');
    expect(r.data.values).not.toHaveProperty('email_smtp_password');
  });

  test('an unknown group is refused rather than guessed at', async () => {
    seed({});
    const r = await repo.resolveGroup('not_a_group', ctx);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/group/i);
  });

  test('missing branch or licence is refused, and nothing is read', async () => {
    seed({});
    const r = await repo.resolveGroup('features', { branchId: BRANCH });
    expect(r.status).toBe(false);
    expect(mockCollections.branch_features.findOne).not.toHaveBeenCalled();
  });

  /*
   * Writes (S2). The property that matters: a key that was NOT sent cannot
   * appear in the update. The old path built one $set from the whole settings
   * form, so a four-key payload wrote undefined over every control the caller
   * never showed - a signature upload could wipe printing and receipts. Here
   * that is not a bug to avoid, it is unsayable.
   */
  const seedWrite = () => {
    for (const name of Object.keys(mockCollections)) delete mockCollections[name];
    for (const name of ['branch_features', 'branch_secrets', 'branches']) {
      mockCollections[name] = {
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      };
    }
  };

  test('only the keys sent are written - nothing else can appear in the update', async () => {
    seedWrite();
    await repo.saveGroup('features', { quotes_enable: true }, ctx);
    const $set = mockCollections.branch_features.updateOne.mock.calls[0][1].$set;
    expect($set.quotes_enable).toBe(true);
    // every other feature key must be absent, not undefined-valued
    expect(Object.keys($set).sort()).toEqual(['branch_id', 'license', 'quotes_enable']);
  });

  test('the same keys are mirrored to the legacy branches document', async () => {
    seedWrite();
    await repo.saveGroup('features', { quotes_enable: true }, ctx);
    const legacy$set = mockCollections.branches.updateOne.mock.calls[0][1].$set;
    expect(legacy$set).toEqual({ quotes_enable: true });
  });

  test('a key from another group is REFUSED, not quietly dropped', async () => {
    seedWrite();
    const r = await repo.saveGroup('features', { quotes_enable: true, print_type: 'a4' }, ctx);
    expect(r.status).toBe(false);
    expect(r.data.rejected).toEqual(['print_type']);
    // and nothing at all was written
    expect(mockCollections.branch_features.updateOne).not.toHaveBeenCalled();
    expect(mockCollections.branches.updateOne).not.toHaveBeenCalled();
  });

  test('an account-level write targets branch_id null and does NOT touch the legacy doc', async () => {
    seedWrite();
    const r = await repo.saveGroup('features', { quotes_enable: true }, ctx, { level: 'account' });
    expect(r.data.level).toBe('account');
    expect(mockCollections.branch_features.updateOne.mock.calls[0][0].branch_id).toBeNull();
    // no single branch to mirror an account value to
    expect(mockCollections.branches.updateOne).not.toHaveBeenCalled();
  });

  test('secrets write to their own collection and nowhere near the others', async () => {
    seedWrite();
    await repo.saveGroup('secrets', { email_smtp_password: 'hunter2' }, ctx);
    expect(mockCollections.branch_secrets.updateOne).toHaveBeenCalled();
    expect(mockCollections.branch_features.updateOne).not.toHaveBeenCalled();
  });

  test('an empty payload writes nothing rather than upserting a bare row', async () => {
    seedWrite();
    const r = await repo.saveGroup('features', {}, ctx);
    expect(r.status).toBe(true);
    expect(r.data.written).toEqual([]);
    expect(mockCollections.branch_features.updateOne).not.toHaveBeenCalled();
  });

  test('the account row is looked up with branch_id null, not a missing field', async () => {
    seed({ legacy: {} });
    await repo.resolveGroup('features', ctx);
    const filters = mockCollections.branch_features.findOne.mock.calls.map((c) => c[0]);
    expect(filters.some((f) => f.branch_id === null)).toBe(true);
    // and both lookups are walled to the licence
    expect(filters.every((f) => f.license)).toBe(true);
  });

  /*
   * 'false' is not false. The first-run welcome sends its toggles as
   * 'true'/'false' STRINGS; stored verbatim, every `!== false` gate in the
   * app read "false" as enabled - the owner saved all-off and watched every
   * feature light up. The boolean is stored and resolved, never the string.
   */
  describe('string booleans - the all-toggles-on incident', () => {
    test('a welcome-style payload is stored as booleans in BOTH stores', async () => {
      seedWrite();
      await repo.saveGroup(
        'features',
        { module_credit_enable: 'false', quotes_enable: 'true', first_run_decided: 'true' },
        ctx
      );
      const $set = mockCollections.branch_features.updateOne.mock.calls[0][1].$set;
      expect($set.module_credit_enable).toBe(false);
      expect($set.quotes_enable).toBe(true);
      expect($set.first_run_decided).toBe(true);
      const legacy$set = mockCollections.branches.updateOne.mock.calls[0][1].$set;
      expect(legacy$set.module_credit_enable).toBe(false);
      expect(legacy$set.first_run_decided).toBe(true);
    });

    test('null still means INHERIT - coercion must not turn it into a value', async () => {
      seedWrite();
      await repo.saveGroup('features', { quotes_enable: null }, ctx);
      const update = mockCollections.branch_features.updateOne.mock.calls[0][1];
      expect(update.$unset).toEqual({ quotes_enable: '' });
      expect(update.$set.quotes_enable).toBeUndefined();
    });

    test('a non-boolean features value passes through untouched', async () => {
      seedWrite();
      await repo.saveGroup('features', { till_lock_idle_minutes: '15' }, ctx);
      const $set = mockCollections.branch_features.updateOne.mock.calls[0][1].$set;
      expect($set.till_lock_idle_minutes).toBe('15');
    });

    test('rows poisoned before the fix still RESOLVE as booleans', async () => {
      seed({
        branchRow: { module_credit_enable: 'false' },
        accountRow: { module_marketing_enable: 'true' },
        legacy: { cash_register_enable: 'false' },
      });
      const r = await repo.resolveGroup('features', ctx);
      expect(r.data.values.module_credit_enable).toBe(false);
      expect(r.data.values.module_marketing_enable).toBe(true);
      expect(r.data.values.cash_register_enable).toBe(false);
      expect(r.data.inherited.module_marketing_enable).toBe(true);
    });
  });
});

/*
 * S5 - clearing an override.
 *
 * `null` on the way IN means "stop deciding this here". The trap is the
 * legacy mirror: this repository dual-writes to the old `branches` document,
 * so mirroring a cleared key would write null over the legacy value - and
 * that value is exactly what the branch is being told to fall back ON. Reset
 * to inherited would delete what it meant to inherit, and the setting would
 * come back not as the account's answer but as nothing at all.
 */
describe('clearing a branch override', () => {
  let repo;
  const writable = () => {
    for (const name of Object.keys(mockCollections)) delete mockCollections[name];
    const features = mkCol();
    features.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    mockCollections.branch_features = features;
    const branches = mkCol();
    branches.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    mockCollections.branches = branches;
    return { features, branches };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repo = new SettingsRepository();
  });

  test('null UNSETS the key rather than storing a null', async () => {
    const { features } = writable();
    const r = await repo.saveGroup('features', { quotes_enable: null }, ctx);
    expect(r.status).toBe(true);

    const update = features.updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ quotes_enable: '' });
    expect(update.$set.quotes_enable).toBeUndefined();
    expect(r.data.cleared).toEqual(['quotes_enable']);
    expect(r.data.written).toEqual([]);
  });

  test('and the legacy document is NOT touched - that is the fallback', async () => {
    const { branches } = writable();
    await repo.saveGroup('features', { quotes_enable: null }, ctx);
    // nothing at all was mirrored: there is no value to mirror, only a removal
    expect(branches.updateOne).not.toHaveBeenCalled();
  });

  test('a real value still mirrors, and a mixed payload mirrors only the value', async () => {
    const { features, branches } = writable();
    await repo.saveGroup('features', { quotes_enable: null, quick_sale_enable: 'true' }, ctx);

    const update = features.updateOne.mock.calls[0][1];
    /* stored as the boolean the string meant - see the coercion tests */
    expect(update.$set.quick_sale_enable).toBe(true);
    expect(update.$unset).toEqual({ quotes_enable: '' });

    // the legacy mirror must carry the SET key and never the cleared one
    const mirrored = branches.updateOne.mock.calls[0][1].$set;
    expect(mirrored).toEqual({ quick_sale_enable: true });
    expect('quotes_enable' in mirrored).toBe(false);
  });

  test('clearing at account level unsets there too, and mirrors nothing', async () => {
    const { features, branches } = writable();
    await repo.saveGroup('features', { quotes_enable: null }, ctx, { level: 'account' });
    expect(features.updateOne.mock.calls[0][0].branch_id).toBeNull();
    expect(features.updateOne.mock.calls[0][1].$unset).toEqual({ quotes_enable: '' });
    expect(branches.updateOne).not.toHaveBeenCalled();
  });
});

describe('what a reset would fall back to', () => {
  let repo;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repo = new SettingsRepository();
  });

  test('inherited reports the account value behind a branch override', async () => {
    seed({ branchRow: { quotes_enable: false }, accountRow: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(false);
    expect(r.data.inherited.quotes_enable).toBe(true);
  });

  test('it falls through to the legacy document when no account rule exists', async () => {
    seed({ branchRow: { quotes_enable: false }, legacy: { quotes_enable: true } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.inherited.quotes_enable).toBe(true);
  });

  test('nothing below means nothing to inherit', async () => {
    seed({ branchRow: { quotes_enable: false } });
    const r = await repo.resolveGroup('features', ctx);
    expect(r.data.inherited.quotes_enable).toBeUndefined();
  });
});

describe('the account level read on its own', () => {
  let repo;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repo = new SettingsRepository();
  });

  test('it returns what the account decides, never a branch override', async () => {
    seed({ branchRow: { quotes_enable: false }, accountRow: { quick_sale_enable: true } });
    const r = await repo.accountGroup('features', ctx);
    expect(r.data.level).toBe('account');
    expect(r.data.values.quick_sale_enable).toBe(true);
    // the branch's own choice must not appear, or saving this form back would
    // push one shop's decision onto every other shop
    expect(r.data.values.quotes_enable).toBeUndefined();
  });

  test('with NO account rule it returns nothing, never the branch answer', async () => {
    /* The case that matters: no shop-wide rule exists yet, but this branch has
       decided something. If the account read fell through to the branch row,
       the "applies to all shops" form would open pre-filled with one shop's
       choice and saving it would impose that on every other shop - without
       anyone having asked for it. */
    seed({ branchRow: { quotes_enable: false, quick_sale_enable: true } });
    const r = await repo.accountGroup('features', ctx);
    expect(r.data.values).toEqual({});
    expect(r.data.set).toEqual([]);
  });

  test('`set` distinguishes "all shops say false" from "no shop-wide rule"', async () => {
    seed({ accountRow: { quotes_enable: false } });
    const r = await repo.accountGroup('features', ctx);
    expect(r.data.values.quotes_enable).toBe(false);
    expect(r.data.set).toEqual(['quotes_enable']);
  });
});

/*
 * S6 - copy settings between branches.
 *
 * The design question is WHAT gets copied. Copying every resolved value would
 * bake the source's whole configuration into the target as explicit
 * overrides, and the target would never follow an account-level change again.
 * Copying only the new-collection row would copy almost nothing today,
 * because most shops still hold their values in the legacy branches doc.
 *
 * So the rule is: copy what the source DECIDES, skip what it INHERITS.
 */
describe('copying settings to another branch', () => {
  let repo;
  const OTHER = '64b000000000000000000009';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    repo = new SettingsRepository();
  });

  test('a key the source merely inherits is NOT copied', async () => {
    // quotes_enable comes from the account; quick_sale_enable is this branch's own
    seed({
      branchRow: { quick_sale_enable: true },
      accountRow: { quotes_enable: true },
    });
    mockCollections.branch_features.updateOne = jest.fn().mockResolvedValue({});
    mockCollections.branches.updateOne = jest.fn().mockResolvedValue({});

    const r = await repo.copyGroups(['features'], BRANCH, OTHER, { licenseId: LICENSE });
    expect(r.status).toBe(true);

    const written = mockCollections.branch_features.updateOne.mock.calls[0][1].$set;
    expect(written.quick_sale_enable).toBe(true);
    // freezing this in would stop the target following a shop-wide change
    expect('quotes_enable' in written).toBe(false);
    expect(r.data.copied.features).toEqual(['quick_sale_enable']);
  });

  test('legacy values count as the branch own decision', async () => {
    // the common case today: nothing in the new collection at all
    seed({ legacy: { quotes_enable: true } });
    mockCollections.branch_features.updateOne = jest.fn().mockResolvedValue({});
    mockCollections.branches.updateOne = jest.fn().mockResolvedValue({});

    const r = await repo.copyGroups(['features'], BRANCH, OTHER, { licenseId: LICENSE });
    expect(r.data.copied.features).toEqual(['quotes_enable']);
  });

  test('it writes to the DESTINATION branch, not the source', async () => {
    seed({ branchRow: { quick_sale_enable: true } });
    mockCollections.branch_features.updateOne = jest.fn().mockResolvedValue({});
    mockCollections.branches.updateOne = jest.fn().mockResolvedValue({});

    await repo.copyGroups(['features'], BRANCH, OTHER, { licenseId: LICENSE });
    const filter = mockCollections.branch_features.updateOne.mock.calls[0][0];
    expect(String(filter.branch_id)).toBe(OTHER);
  });

  test('credentials are refused by name, never quietly dropped', async () => {
    const r = await repo.copyGroups(['features', 'secrets'], BRANCH, OTHER, {
      licenseId: LICENSE,
    });
    expect(r.status).toBe(false);
    expect(r.data.refused).toEqual(['secrets']);
    expect(r.message).toMatch(/never copied/i);
  });

  test('copying a branch onto itself is refused', async () => {
    const r = await repo.copyGroups(['features'], BRANCH, BRANCH, { licenseId: LICENSE });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/two different branches/i);
  });

  test('an empty group list does nothing rather than everything', async () => {
    const r = await repo.copyGroups([], BRANCH, OTHER, { licenseId: LICENSE });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/at least one group/i);
  });

  test('an unknown group is named back', async () => {
    const r = await repo.copyGroups(['wibble'], BRANCH, OTHER, { licenseId: LICENSE });
    expect(r.status).toBe(false);
    expect(r.data.unknown).toEqual(['wibble']);
  });
});
