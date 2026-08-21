'use strict';

/*
 * "This should be visible based on settings only."
 *
 * The owner's reframing of dedupe/merge, and the whole point of these tests is
 * the direction the failures point. A visibility switch has an asymmetric cost:
 * showing one shop another shop's customers when it should not is a data
 * incident, while failing to share when it should is an annoyance somebody
 * reports. So every uncertain path here is asserted to resolve NARROW.
 */

/*
 * The mock is a CONSTRUCTOR because the real module exports one. An
 * object-shaped mock passed here happily while the service - which calls
 * `new` - could never have worked. data-sharing-wiring.test.js checks that
 * seam with nothing mocked at all.
 */
const mockResolveGroup = jest.fn();
jest.mock('../../../src/repositories/settings.repository', () =>
  jest.fn().mockImplementation(() => ({ resolveGroup: mockResolveGroup }))
);

const dataSharing = require('../../../src/services/data-sharing');
const settingsRepository = { resolveGroup: mockResolveGroup };

const CTX = { licenseId: 'lic1', branchId: 'br1' };

const resolves = (values) =>
  settingsRepository.resolveGroup.mockResolvedValue({
    status: true,
    data: { group: 'sharing', values },
  });

beforeEach(() => {
  jest.clearAllMocks();
  dataSharing.invalidate();
});

describe('what an absent setting means', () => {
  test('nothing stored means NOT shared', async () => {
    /* An upgrade must never change who can see whom. Someone has to have made
       the decision; a deploy is not a decision. */
    resolves({});
    expect(await dataSharing.isShared('customers', CTX)).toBe(false);
    expect(await dataSharing.isShared('suppliers', CTX)).toBe(false);
  });

  test('a settings read that fails resolves narrow, not open', async () => {
    settingsRepository.resolveGroup.mockRejectedValue(new Error('mongo down'));
    expect(await dataSharing.isShared('customers', CTX)).toBe(false);
  });

  test('a settings read that fails does not fail the caller', async () => {
    settingsRepository.resolveGroup.mockRejectedValue(new Error('mongo down'));
    await expect(dataSharing.isShared('customers', CTX)).resolves.toBe(false);
  });

  test('missing context resolves narrow rather than guessing', async () => {
    expect(await dataSharing.isShared('customers', {})).toBe(false);
    expect(await dataSharing.isShared('customers', { licenseId: 'lic1' })).toBe(false);
    expect(settingsRepository.resolveGroup).not.toHaveBeenCalled();
  });

  test('an entity nobody registered is never shared', async () => {
    resolves({ share_customers: true });
    expect(await dataSharing.isShared('sales', CTX)).toBe(false);
    expect(await dataSharing.isShared(undefined, CTX)).toBe(false);
  });
});

describe('reading the stored value', () => {
  test('a true switch shares', async () => {
    resolves({ share_customers: true });
    expect(await dataSharing.isShared('customers', CTX)).toBe(true);
  });

  test('each entity is governed by its own switch', async () => {
    resolves({ share_customers: true, share_suppliers: false });
    expect(await dataSharing.isShared('customers', CTX)).toBe(true);
    expect(await dataSharing.isShared('suppliers', CTX)).toBe(false);
  });

  test('the string "false" is FALSE', async () => {
    /* Settings are written by several screens over several years and arrive as
       booleans, "true", "1" or "enable". `!!"false"` is true, and for a
       visibility switch that is the wrong direction to be wrong in. */
    for (const v of ['false', 'FALSE', '0', 'no', 'off', 'disable', '', null, undefined]) {
      dataSharing.invalidate();
      resolves({ share_customers: v });
      expect(await dataSharing.isShared('customers', CTX)).toBe(false);
    }
  });

  test('the strings a settings screen actually writes are TRUE', async () => {
    for (const v of [true, 'true', 'TRUE', '1', 'yes', 'on', 'enable', 'enabled']) {
      dataSharing.invalidate();
      resolves({ share_customers: v });
      expect(await dataSharing.isShared('customers', CTX)).toBe(true);
    }
  });
});

describe('scopeBranch - the whole integration surface', () => {
  test('not shared keeps the branch scope exactly as it was', async () => {
    resolves({ share_customers: false });
    expect(await dataSharing.scopeBranch('customers', 'br1', CTX)).toBe('br1');
  });

  test('shared returns null, which withBranchScope reads as "do not scope"', async () => {
    resolves({ share_customers: true });
    expect(await dataSharing.scopeBranch('customers', 'br1', CTX)).toBeNull();
  });

  test('a caller with no branch is left alone rather than widened', async () => {
    /* Some call sites legitimately pass nothing. Turning that into `null` would
       be indistinguishable from "shared", so the absent value is returned
       unchanged and no settings read happens at all. */
    resolves({ share_customers: true });
    expect(await dataSharing.scopeBranch('customers', undefined, CTX)).toBeUndefined();
    expect(await dataSharing.scopeBranch('customers', null, CTX)).toBeNull();
    expect(settingsRepository.resolveGroup).not.toHaveBeenCalled();
  });
});

describe('the cache', () => {
  test('it does not read settings once per query', async () => {
    resolves({ share_customers: true });
    for (let i = 0; i < 20; i += 1) await dataSharing.isShared('customers', CTX);
    expect(settingsRepository.resolveGroup).toHaveBeenCalledTimes(1);
  });

  test('one account does not answer for another', async () => {
    /* One process serves many shops. A cache keyed loosely here would show one
       account's setting to the next request, which is the same class of bug as
       the per-process index latch. */
    settingsRepository.resolveGroup
      .mockResolvedValueOnce({ status: true, data: { values: { share_customers: true } } })
      .mockResolvedValueOnce({ status: true, data: { values: { share_customers: false } } });

    expect(await dataSharing.isShared('customers', { licenseId: 'A', branchId: 'b' })).toBe(true);
    expect(await dataSharing.isShared('customers', { licenseId: 'B', branchId: 'b' })).toBe(false);
  });

  test('one branch does not answer for another - a branch may override', async () => {
    settingsRepository.resolveGroup
      .mockResolvedValueOnce({ status: true, data: { values: { share_customers: true } } })
      .mockResolvedValueOnce({ status: true, data: { values: { share_customers: false } } });

    expect(await dataSharing.isShared('customers', { licenseId: 'A', branchId: 'b1' })).toBe(true);
    expect(await dataSharing.isShared('customers', { licenseId: 'A', branchId: 'b2' })).toBe(false);
  });

  test('invalidate clears one account without clearing the others', async () => {
    resolves({ share_customers: true });
    await dataSharing.isShared('customers', { licenseId: 'A', branchId: 'b' });
    await dataSharing.isShared('customers', { licenseId: 'B', branchId: 'b' });
    expect(settingsRepository.resolveGroup).toHaveBeenCalledTimes(2);

    dataSharing.invalidate('A');
    await dataSharing.isShared('customers', { licenseId: 'A', branchId: 'b' });
    await dataSharing.isShared('customers', { licenseId: 'B', branchId: 'b' });
    expect(settingsRepository.resolveGroup).toHaveBeenCalledTimes(3);
  });

  test('an entry expires, so another process flipping the switch takes hold', async () => {
    jest.useFakeTimers();
    try {
      resolves({ share_customers: true });
      await dataSharing.isShared('customers', CTX);
      jest.advanceTimersByTime(31 * 1000);
      await dataSharing.isShared('customers', CTX);
      expect(settingsRepository.resolveGroup).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the defaults offered when a branch is created', () => {
  test('customers and suppliers arrive ticked', async () => {
    /* The owner asked for these "auto selected as true based on standard
       values". A person who visits two shops of one chain is one person. */
    expect(dataSharing.CREATE_DEFAULTS.share_customers).toBe(true);
    expect(dataSharing.CREATE_DEFAULTS.share_suppliers).toBe(true);
  });

  test('inventory is NOT a sharing switch at all', async () => {
    /* Stock lives on the item document and each branch owns its own items, so
       widening the item read would show N copies of every product with N
       different counts - and selling the wrong row would decrement another
       shop's stock. The catalogue is COPIED instead (catalogue-copy.js). */
    expect(dataSharing.CREATE_DEFAULTS).not.toHaveProperty('share_inventory');
    expect(dataSharing.READ_DEFAULTS).not.toHaveProperty('share_inventory');
    expect(Object.values(dataSharing.SHARING_KEYS)).not.toContain('share_inventory');
  });

  test('the form default and the stored default are deliberately different', async () => {
    /* A pre-ticked box is a decision somebody can untick. An upgrade that flips
       a default is not. */
    expect(dataSharing.CREATE_DEFAULTS.share_customers).toBe(true);
    expect(dataSharing.READ_DEFAULTS.share_customers).toBe(false);
  });

  test('every create default names a real setting', async () => {
    const known = Object.values(dataSharing.SHARING_KEYS);
    for (const key of Object.keys(dataSharing.CREATE_DEFAULTS)) {
      expect(known).toContain(key);
    }
  });
});
