'use strict';
/*
 * Which shop the running code belongs to.
 *
 * Most of this API reaches the database through BaseModel, which keeps its
 * handle in a process-wide static. One process, one shop - right for a till,
 * wrong for a process serving several, because every request would read
 * whichever database was assigned at startup.
 *
 * The failure would be silent: no error, the query succeeds, and it returns
 * another shop's sales. So the tests that matter here are the negative ones -
 * that an escaped code path throws instead of quietly being served the wrong
 * database.
 */

const {
  enableMultiTenant,
  isMultiTenant,
  runWithTenant,
  currentTenant,
  currentDb,
} = require('../../../src/db/tenant-context');

const processWide = { databaseName: 'PosnicPro' };
const shopA = { databaseName: 'posnic_t_a' };
const shopB = { databaseName: 'posnic_t_b' };

afterEach(() => enableMultiTenant(false));

describe('standalone - a till or a self-hosted server', () => {
  test('is the default, so nothing existing changes', () => {
    expect(isMultiTenant()).toBe(false);
  });

  test('uses the process-wide handle, exactly as before', () => {
    expect(currentDb(processWide)).toBe(processWide);
  });

  test('does not throw outside any request', () => {
    expect(() => currentDb(processWide)).not.toThrow();
    expect(currentTenant()).toBeUndefined();
  });
});

describe('multi-tenant - one process, several shops', () => {
  beforeEach(() => enableMultiTenant(true));

  test('a request in scope reads its own shop', async () => {
    await runWithTenant({ db: shopA, tenantDb: 'posnic_t_a' }, async () => {
      expect(currentDb(processWide)).toBe(shopA);
    });
  });

  test('the process-wide handle is never used, even when one exists', async () => {
    await runWithTenant({ db: shopA }, async () => {
      expect(currentDb(processWide)).not.toBe(processWide);
    });
  });

  test('code outside a scope THROWS rather than being given a default', () => {
    /* The whole point. Returning `processWide` here would hand this caller
       whichever shop the process last touched - the silent leak. */
    expect(() => currentDb(processWide)).toThrow(/no shop in context/);
  });

  test('the scope survives awaits', async () => {
    await runWithTenant({ db: shopA }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentDb(processWide)).toBe(shopA);
      await Promise.resolve();
      expect(currentDb(processWide)).toBe(shopA);
    });
  });

  test('two overlapping requests never see each other', async () => {
    /* Interleaved on purpose: this is what concurrent requests to different
       shops actually do to an event loop. */
    const seen = [];
    await Promise.all([
      runWithTenant({ db: shopA }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(['A', currentDb(processWide).databaseName]);
      }),
      runWithTenant({ db: shopB }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(['B', currentDb(processWide).databaseName]);
      }),
    ]);
    expect(seen.sort()).toEqual([
      ['A', 'posnic_t_a'],
      ['B', 'posnic_t_b'],
    ]);
  });

  test('scopes nest without leaking outward', async () => {
    await runWithTenant({ db: shopA }, async () => {
      await runWithTenant({ db: shopB }, async () => {
        expect(currentDb(processWide)).toBe(shopB);
      });
      expect(currentDb(processWide)).toBe(shopA);
    });
  });

  test('a scope that throws does not leave its shop behind', async () => {
    await expect(
      runWithTenant({ db: shopA }, async () => {
        throw new Error('handler blew up');
      })
    ).rejects.toThrow('handler blew up');
    expect(() => currentDb(processWide)).toThrow(/no shop in context/);
  });

  test('a scope cannot be opened without a database', () => {
    expect(() => runWithTenant({}, () => {})).toThrow(/needs a database handle/);
    expect(() => runWithTenant(null, () => {})).toThrow(/needs a database handle/);
  });
});

describe('turning the mode off again', () => {
  test('restores the standalone behaviour', () => {
    enableMultiTenant(true);
    expect(() => currentDb(processWide)).toThrow();
    enableMultiTenant(false);
    expect(currentDb(processWide)).toBe(processWide);
  });
});
