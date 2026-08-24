'use strict';

/*
 * The wiring, with NOTHING mocked.
 *
 * data-sharing.test.js mocks the settings repository, and that mock had a
 * shape the real module does not: settings.repository exports the CLASS, so
 * `settingsRepository.resolveGroup` is undefined on it. The first version of
 * this service called exactly that. It threw, the catch turned the throw into
 * "not shared", and the switch was dead in the one way that looks identical to
 * a working narrow default - twenty-one green tests and a setting nobody could
 * turn on.
 *
 * That is the same class as the two 500s in the queue (#78, #79): a call to a
 * method nobody wrote, waiting for a person to press the button. So this file
 * exists to assert the seam itself, and it must never mock the thing it is
 * checking.
 */

const SettingsRepository = require('../../../src/repositories/settings.repository');
const dataSharing = require('../../../src/services/data-sharing');
const { GROUPS } = require('../../../src/services/settings-groups');
const { COLLECTION_OF } = require('../../../src/repositories/settings.repository');

describe('the settings repository is reached the way it is actually exported', () => {
  test('the module exports a constructor, not a ready-made instance', () => {
    expect(typeof SettingsRepository).toBe('function');
    expect(SettingsRepository.prototype.resolveGroup).toBeInstanceOf(Function);
  });

  test('the service holds an INSTANCE, so resolveGroup is callable', () => {
    const repo = dataSharing._repo();
    expect(repo).toBeInstanceOf(SettingsRepository);
    expect(typeof repo.resolveGroup).toBe('function');
  });

  test('it is built once, not per query', () => {
    expect(dataSharing._repo()).toBe(dataSharing._repo());
  });
});

describe('the group the service asks for actually exists', () => {
  test('"sharing" is a registered settings group', () => {
    /* resolveGroup answers `status:false, "Unknown settings group"` for a name
       it does not know - which this service would swallow as "not shared". */
    expect(GROUPS.sharing).toBeDefined();
    expect(Array.isArray(GROUPS.sharing)).toBe(true);
  });

  test('it has a collection to resolve from', () => {
    expect(COLLECTION_OF.sharing).toBe('branch_sharing');
  });

  test('every key the service reads belongs to that group', () => {
    for (const key of Object.values(dataSharing.SHARING_KEYS)) {
      expect(GROUPS.sharing).toContain(key);
    }
    for (const key of Object.keys(dataSharing.READ_DEFAULTS)) {
      expect(GROUPS.sharing).toContain(key);
    }
  });

  test('sharing keys belong to sharing and nowhere else', () => {
    /* A key in two groups resolves from whichever collection is asked first,
       so one screen would save it and another would never see the change. */
    for (const [group, keys] of Object.entries(GROUPS)) {
      if (group === 'sharing') continue;
      for (const key of Object.values(dataSharing.SHARING_KEYS)) {
        expect(keys).not.toContain(key);
      }
    }
  });
});
