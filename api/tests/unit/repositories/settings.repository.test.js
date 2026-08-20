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

  test('the account row is looked up with branch_id null, not a missing field', async () => {
    seed({ legacy: {} });
    await repo.resolveGroup('features', ctx);
    const filters = mockCollections.branch_features.findOne.mock.calls.map((c) => c[0]);
    expect(filters.some((f) => f.branch_id === null)).toBe(true);
    // and both lookups are walled to the licence
    expect(filters.every((f) => f.license)).toBe(true);
  });
});
