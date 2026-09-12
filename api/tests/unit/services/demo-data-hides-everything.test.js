'use strict';
/*
 * Switching sample data off hides ALL of it, not just the products.
 *
 * Owner, with a screen of sample purchases in front of him after switching
 * the feature off: "when i disable demo feature just dont show or delete
 * product only demo products and demo sales and demo purchase as well. i see
 * demo purchase after disabling. fix this very important."
 *
 * Two things were wrong. The read filter was wired into the item repository
 * and nowhere else, so purchases, sales, quotes and people were never hidden
 * by the switch - they depended entirely on the removal having run. And the
 * removal could not find the oldest of them: sales, purchases and quotes only
 * started carrying `demo_pack` in August 2026, and a shop seeded before that
 * has samples no tag will ever match.
 */
const fs = require('fs');
const path = require('path');
const demoData = require('../../../src/services/demo-data');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('what counts as a demo record', () => {
  test('a tagged row is one, in every collection', () => {
    for (const c of ['items', 'sales', 'receivings', 'quotes', 'customers', 'suppliers']) {
      expect(JSON.stringify(demoData.seededClause(c))).toContain('demo_pack');
      expect(demoData.notSeededClause(c).demo_pack).toEqual({ $exists: false });
    }
  });

  test('an untagged sample is one too, by the number the seeder gave it', () => {
    /* The rows that survived the switch: seeded before the tag existed. */
    expect(demoData.seededClause('receivings')).toEqual({
      $or: [{ demo_pack: { $exists: true } }, { receiving_id: /^R-DEMO-/ }],
    });
    expect(demoData.seededClause('sales').$or[1]).toEqual({ sales_id: /^S-DEMO-/ });
    expect(demoData.seededClause('quotes').$or[1]).toEqual({ quote_id: /^QUO-DEMO-/ });
    expect(demoData.notSeededClause('receivings')).toEqual({
      demo_pack: { $exists: false },
      receiving_id: { $not: /^R-DEMO-/ },
    });
  });

  test('a collection with no legacy shape is answered by the tag alone', () => {
    expect(demoData.seededClause('customers')).toEqual({ demo_pack: { $exists: true } });
    expect(demoData.notSeededClause('items')).toEqual({ demo_pack: { $exists: false } });
  });

  test('the hiding clause is flat, so it cannot wipe out a query that already has an $or', () => {
    /* A customer search owns a top-level $or for name, email and phone. A
       $nor clause spread into it would replace those terms and return every
       customer in the shop. */
    for (const c of ['items', 'sales', 'receivings', 'quotes']) {
      const clause = demoData.notSeededClause(c);
      expect(clause.$or).toBeUndefined();
      expect(clause.$nor).toBeUndefined();
      expect(clause.$and).toBeUndefined();
    }
  });
});

describe('the switch decides, per collection', () => {
  const CONTEXT = { licenseId: 'lic', branchId: 'br' };
  /* Through the settings repository, which is how the module really reads
     it: spying on the export would not intercept the module's own call. */
  const switchIs = (value) =>
    jest.spyOn(demoData._repo(), 'resolveGroup').mockResolvedValue({
      status: true,
      data: { group: 'features', values: { module_demo_data_enable: value } },
    });

  beforeEach(() => demoData.invalidate());
  afterEach(() => {
    jest.restoreAllMocks();
    demoData.invalidate();
  });

  test('shown: nothing is added to any query', async () => {
    switchIs(true);
    for (const c of ['items', 'receivings', 'sales']) {
      await expect(demoData.filterFor(c, CONTEXT)).resolves.toEqual({});
    }
  });

  test('switched off: every collection gets its own hiding clause', async () => {
    switchIs(false);
    await expect(demoData.filterFor('receivings', CONTEXT)).resolves.toEqual(
      demoData.notSeededClause('receivings')
    );
    await expect(demoData.filterFor('items', CONTEXT)).resolves.toEqual({
      demo_pack: { $exists: false },
    });
    /* filter() is the old items-only door and must not have changed. */
    await expect(demoData.filter(CONTEXT)).resolves.toEqual({ demo_pack: { $exists: false } });
  });

  test('no scope to read is not "hide everything"', async () => {
    /* A query that cannot say which shop it is for must not come back empty:
       the forgiving answer is the catalogue the shop already had. */
    await expect(demoData.filterFor('receivings', {})).resolves.toEqual({});
  });
});

describe('the read paths actually ask', () => {
  /*
   * A clause nobody spreads into a query hides nothing, and looks exactly
   * like a clause that works. The repositories are read here for the same
   * reason the AI endpoints are: the failure is silent and indistinguishable
   * from correct behaviour on a shop that has no samples.
   */
  const surfaces = [
    ['repositories/purchases', 'receiving.repository.js', 'receivings', 5],
    ['repositories/customers', 'customer.repository.js', 'customers', 3],
    ['repositories/suppliers', 'supplier.repository.js', 'suppliers', 3],
  ];

  for (const [label, file, collection, count] of surfaces) {
    test(`${label} hide samples on every list they serve`, () => {
      const src = read('repositories', file);
      expect(src).toContain("require('../services/demo-data')");
      const asked = src.split(`demoData.filterCurrent('${collection}')`).length - 1;
      expect(asked).toBeGreaterThanOrEqual(count);
    });
  }

  test('the sales history and the quote list hide them too', () => {
    const sales = read('repositories', 'sale.repository.js');
    expect(sales).toMatch(
      /const query = \{ \.\.\.\(await demoData\.filterCurrent\('sales'\)\) \};/
    );
    const quotes = read('repositories', 'quote.repository.js');
    expect(quotes).toMatch(/\.\.\.\(await demoData\.filterFor\('quotes', context\)\)/);
  });

  test('the products still do, which is where this started', () => {
    const items = read('repositories', 'item.repository.js');
    expect(items.split('demoData.filter(').length - 1).toBeGreaterThanOrEqual(4);
  });
});

describe('the removal', () => {
  test('looks for untagged samples, and for both shapes of id', () => {
    /*
     * A branch that reached a seeder as a string wrote strings. An
     * ObjectId-only filter deletes nothing and reports success, which is the
     * shape of every silent failure in this codebase.
     */
    const src = read('repositories', 'item.repository.js');
    expect(src).toMatch(/\.\.\.demoData\.seededClause\(collection\)/);
    expect(src).toMatch(/branch_id: \{ \$in: \[branch, String\(branch\)\] \}/);
    expect(src).toMatch(/license: \{ \$in: \[license, String\(license\)\] \}/);
    for (const c of ['sales', 'quotes', 'receivings', 'customers', 'suppliers']) {
      expect(src).toContain(`demoScopeFor('${c}')`);
    }
  });
});
