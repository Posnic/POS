'use strict';

/*
 * The mock is a CONSTRUCTOR because the real module exports one. An
 * object-shaped mock would pass here while the service - which calls `new` -
 * could never have worked. Mocking the MODULE rather than spying on _repo
 * matters too: the service calls its own local _repo, so a spy on the export
 * replaces something nothing calls, and every test then exercises the
 * catch-all default instead of the code.
 */
const mockResolveGroup = jest.fn();
jest.mock('../../../src/repositories/settings.repository', () =>
  jest.fn().mockImplementation(() => ({ resolveGroup: mockResolveGroup }))
);

const demoData = require('../../../src/services/demo-data');

/*
 * The Demo Data switch.
 *
 * Owner ask: "one feature called Demo Data. when user switch off then all demo
 * data will be hidden or removed."
 *
 * These tests are mostly about the DEFAULTS, because that is where this kind
 * of switch goes wrong. Getting "off" wrong hides a few sample products for a
 * moment. Getting "on" wrong empties a shop's catalogue, and to the shop that
 * is indistinguishable from data loss.
 */
describe('demo-data switch', () => {
  const ctx = { licenseId: 'L1', branchId: 'B1' };
  const resolveGroup = mockResolveGroup;

  beforeEach(() => {
    jest.clearAllMocks();
    demoData.invalidate();
  });

  const stored = (value) =>
    resolveGroup.mockResolvedValue({
      status: true,
      data: { values: value === undefined ? {} : { module_demo_data_enable: value } },
    });

  describe('what an absent setting means', () => {
    test('no setting at all means demo data is SHOWN', async () => {
      /*
       * Every shop running today has these records visible. A deploy that
       * silently emptied their catalogue would look exactly like data loss,
       * so hiding is the change and needs a decision behind it.
       */
      stored(undefined);
      expect(await demoData.isShown(ctx)).toBe(true);
      expect(await demoData.filter(ctx)).toEqual({});
    });

    test('no branch or licence means shown, not hidden', async () => {
      /* Without a scope there is no setting to read, and the safe answer is
         the one that shows a shop everything it has. */
      expect(await demoData.isShown({})).toBe(true);
      expect(await demoData.isShown({ licenseId: 'L1' })).toBe(true);
      expect(await demoData.filter({})).toEqual({});
    });

    test('a settings read that throws still shows the catalogue', async () => {
      /* A failure here must not empty the item list. */
      jest.spyOn(console, 'error').mockImplementation(() => {});
      resolveGroup.mockRejectedValue(new Error('mongo down'));
      expect(await demoData.isShown(ctx)).toBe(true);
      expect(await demoData.filter(ctx)).toEqual({});
    });

    test('a failed settings response shows the catalogue', async () => {
      resolveGroup.mockResolvedValue({ status: false, data: null });
      expect(await demoData.isShown(ctx)).toBe(true);
    });
  });

  describe('switching it off', () => {
    test('false hides demo records', async () => {
      stored(false);
      expect(await demoData.isShown(ctx)).toBe(false);
      expect(await demoData.filter(ctx)).toEqual({ demo_pack: { $exists: false } });
    });

    test("the string 'false' hides them too", async () => {
      /* Settings arrive from a form as strings. Reading only the boolean is
         how a switch ends up doing nothing at all. */
      demoData._cache.clear();
      stored('false');
      expect(await demoData.isShown(ctx)).toBe(false);
    });

    test('true and anything truthy shows them', async () => {
      for (const v of [true, 'true', 1, 'on']) {
        demoData._cache.clear();
        stored(v);
        expect(await demoData.isShown(ctx)).toBe(true);
      }
    });
  });

  describe('the clause itself', () => {
    test('hiding tests for the ABSENCE of a tag, so untagged data survives', async () => {
      /*
       * Records created before tagging existed carry no demo_pack. They are
       * the shop's own products, and a clause that hid them would delete a
       * catalogue from view on the day this shipped.
       */
      stored(false);
      const f = await demoData.filter(ctx);
      expect(f.demo_pack).toEqual({ $exists: false });
      expect(JSON.stringify(f)).not.toContain('$eq');
    });

    test('showing returns an empty object, so callers can spread it blindly', async () => {
      stored(true);
      expect(await demoData.filter(ctx)).toEqual({});
      expect({ a: 1, ...(await demoData.filter(ctx)) }).toEqual({ a: 1 });
    });
  });

  describe('caching', () => {
    test('the setting is read once per branch, not once per query', async () => {
      stored(false);
      await demoData.isShown(ctx);
      await demoData.isShown(ctx);
      await demoData.isShown(ctx);
      expect(resolveGroup).toHaveBeenCalledTimes(1);
    });

    test('two branches do not share an answer', async () => {
      /* One branch hiding demo data must not hide it for the branch next
         door, which is its own shop as far as the person there is concerned. */
      /* (group, context) - destructuring the first argument reads branchId off
         the string 'features', which is undefined, and the test then proves
         nothing about branches at all. */
      resolveGroup.mockImplementation((group, { branchId }) =>
        Promise.resolve({
          status: true,
          data: { values: { module_demo_data_enable: branchId === 'B1' ? false : true } },
        })
      );
      expect(await demoData.isShown({ licenseId: 'L1', branchId: 'B1' })).toBe(false);
      expect(await demoData.isShown({ licenseId: 'L1', branchId: 'B2' })).toBe(true);
    });

    test('flipping the switch is not delayed by the cache', async () => {
      /* The thirty seconds exist for other processes, never for the person
         who just moved the switch. */
      stored(false);
      expect(await demoData.isShown(ctx)).toBe(false);
      demoData.invalidate('L1');
      stored(true);
      expect(await demoData.isShown(ctx)).toBe(true);
    });

    test('invalidate clears only the licence asked for', async () => {
      stored(false);
      await demoData.isShown({ licenseId: 'L1', branchId: 'B1' });
      await demoData.isShown({ licenseId: 'L2', branchId: 'B1' });
      demoData.invalidate('L1');
      expect(demoData._cache.has('L1::B1')).toBe(false);
      expect(demoData._cache.has('L2::B1')).toBe(true);
    });

    test('the cache does not grow without limit', async () => {
      /* One entry per (licence, branch) held forever is a slow leak in a
         process that serves many shops. */
      stored(true);
      for (let i = 0; i < demoData.SWEEP_ABOVE + 5; i++) {
        await demoData.isShown({ licenseId: 'L' + i, branchId: 'B' });
      }
      const before = demoData._cache.size;
      for (const [, v] of demoData._cache) v.until = 0;
      demoData._sweep(Date.now());
      expect(demoData._cache.size).toBe(0);
      expect(before).toBeGreaterThan(0);
    });
  });

  describe('wiring', () => {
    test('_repo returns something with resolveGroup on it', async () => {
      /* settings.repository exports the CLASS, not an instance. Calling
         resolveGroup on the class gives undefined, which throws, which the
         catch turns into "shown" - a dead switch that looks like it works. */
      const r = demoData._repo();
      expect(typeof r.resolveGroup).toBe('function');
    });

    test('it reads the features group, where the other module flags live', async () => {
      stored(false);
      await demoData.isShown(ctx);
      expect(resolveGroup).toHaveBeenCalledWith('features', {
        licenseId: 'L1',
        branchId: 'B1',
      });
    });
  });
});

describe('every doorway to selling honours the demo filter', () => {
  /*
   * Owner report, verbatim: "i see nothing in item list but sales page is
   * showing item... i hard refreshed page. not removed. whats going on?"
   *
   * listScope's own comment promised the demo clause lived in "the ONE place
   * the item list builds its filter" precisely so it could not be applied to
   * some reads and forgotten on others - and the sale grid, the search box
   * and the category tabs never went through listScope. The item list hid;
   * the shelf sold. This sweep reads the three sale-path queries and fails
   * if any of them drops the demo clause or the deleted clause - the
   * deleted one matters doubly now that switching Demo Data off DELETES.
   */
  const fs = require('fs');
  const path = require('path');
  const src = fs
    .readFileSync(path.join(__dirname, '../../../src/repositories/item.repository.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  const fnBody = (name, until) => {
    const at = src.indexOf(name);
    expect(at).toBeGreaterThan(-1);
    const end = src.indexOf(until, at);
    expect(end).toBeGreaterThan(at);
    return src.slice(at, end);
  };

  const DOORWAYS = [
    ['async getOnlineSalesItems(', 'const items = await collection'],
    ['async getOnlineItemsAjaxList(', 'const data = await collection'],
    ['async getItemsByCategoryId(', 'const items = await collection'],
  ];

  test.each(DOORWAYS)('%s applies the demo clause', (name, until) => {
    const body = fnBody(name, until);
    expect(body).toMatch(/demoData\.filter\(\{ licenseId, branchId \}\)/);
    expect(body).toMatch(/demoClause/);
  });

  test.each(DOORWAYS)('%s excludes deleted items', (name, until) => {
    const body = fnBody(name, until);
    expect(body).toMatch(/del_status: \{ \$nin: \[1, '1', true\] \}/);
  });

  test('the demo clause is never spread into $and as a bare empty object', () => {
    /* {$and:[{}, ...]} is legal but a spread of {} into a filter OBJECT is
       where an "empty means everything" bug hides; the $and arrays must gate
       on Object.keys length or filter(Boolean). */
    const grid = fnBody('async getOnlineSalesItems(', 'const items = await collection');
    expect(grid).toMatch(/Object\.keys\(demoClause\)\.length/);
  });
});
