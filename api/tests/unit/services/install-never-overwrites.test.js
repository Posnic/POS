'use strict';

/**
 * Installing must never destroy a shop that already exists.
 *
 * WHAT HAPPENED, so nobody removes this thinking it is theoretical.
 *
 * On 28 August 2026 a live white-label customer - a horticultural corporation
 * with five branches, 265 products and 87 sales going back to April 2025 - had
 * every bit of it replaced by a fresh shop and demo data.
 *
 * Nobody deleted anything. Their tenant row was set provisioned:false, the
 * provisioner read that as "a new signup", and called /api/install/add against
 * their live database. This service did exactly what it was asked to do.
 *
 * That is the whole failure: install is a CREATE, and nothing checked whether
 * there was already something to destroy. The check belongs at this end rather
 * than only in the caller, because the caller that did it WAS trusted, and the
 * next one will be trusted too.
 *
 * The data was recovered from a backup taken 22 minutes earlier. There is no
 * version of this where that recovery was guaranteed.
 */

const InstallService = require('../../../src/services/install.service');

function serviceWithBranches(count) {
  const service = new InstallService();
  service.repository = {
    countExistingBranches: jest.fn(async () => count),
    /* If any of these are reached the guard has already failed. */
    findExistingUser: jest.fn(async () => {
      throw new Error('the install was allowed to proceed');
    }),
    insertUser: jest.fn(async () => {
      throw new Error('the install was allowed to proceed');
    }),
  };
  return service;
}

const payload = (extra = {}) => ({
  register_companyname: 'Someone Else Shop',
  register_username: 'owner@example.com',
  register_useremail: 'owner@example.com',
  register_country: 'India',
  ...extra,
});

describe('installing into a database that already holds a shop', () => {
  it('is refused', async () => {
    const service = serviceWithBranches(5);
    const res = await service.processInstallation(payload());
    expect(res.status).toBe(false);
    expect(res.message).toMatch(/already contains a shop/i);
    expect(service.repository.findExistingUser).not.toHaveBeenCalled();
  });

  it('says how many branches it found, so the refusal can be understood', async () => {
    /* "Refused" with no reason is a thing somebody forces past. */
    const service = serviceWithBranches(5);
    const res = await service.processInstallation(payload());
    expect(res.data).toEqual({ existingBranches: 5 });
  });

  it('is refused for a single branch, not only for a big shop', async () => {
    /* A one-branch shop is somebody's whole business. */
    const service = serviceWithBranches(1);
    const res = await service.processInstallation(payload());
    expect(res.status).toBe(false);
  });

  it('can be forced, but only on purpose', async () => {
    /*
     * The deliberate rebuild of a shop known to be empty of anything worth
     * keeping. It has to be passed explicitly - no truthy string, no default.
     */
    const service = serviceWithBranches(5);
    /* processInstallation catches and REPORTS rather than throwing, so getting
       past the guard shows up as the sentinel coming back in the message. */
    const res = await service.processInstallation(payload({ force: true }));
    expect(res.message).toMatch(/allowed to proceed/);
  });

  it('a force that is not exactly true does not count', async () => {
    for (const forced of ['true', 1, 'yes', {}]) {
      const service = serviceWithBranches(2);
      const res = await service.processInstallation(payload({ force: forced }));
      expect(res.status).toBe(false);
    }
  });
});

describe('installing into an empty database', () => {
  it('proceeds, because that is what install is for', async () => {
    /* The guard must not break the thing it protects: a genuine new signup has
       no branches, and reaching findExistingUser proves it got past. */
    const service = serviceWithBranches(0);
    const res = await service.processInstallation(payload());
    expect(res.message).toMatch(/allowed to proceed/);
    expect(res.message).not.toMatch(/already contains a shop/);
    expect(service.repository.countExistingBranches).toHaveBeenCalled();
  });

  it('proceeds when the count cannot be taken at all', async () => {
    /*
     * A brand-new database can fail this read for reasons that are not "there
     * is a shop here" - the collection does not exist yet. Refusing then would
     * block every real signup, which is a worse failure than the one being
     * prevented, so an unanswerable question is treated as empty.
     */
    const service = new InstallService();
    service.repository = {
      countExistingBranches: jest.fn(async () => {
        throw new Error('no such collection');
      }),
      findExistingUser: jest.fn(async () => {
        throw new Error('the install was allowed to proceed');
      }),
    };
    const res = await service.processInstallation(payload());
    expect(res.message).toMatch(/allowed to proceed/);
    expect(res.message).not.toMatch(/already contains a shop/);
  });
});
