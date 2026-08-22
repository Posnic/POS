'use strict';

const ItemService = require('../../../src/services/item.service');

/*
 * The JSON-LD catalogue export.
 *
 * Two things are being guarded, and the second is the one that bites later:
 * the output has to be a valid schema.org graph, and building it must not hold
 * the catalogue in memory. This repository has already paid for the second
 * once - the catalogue copy read everything with .toArray() and then built a
 * second full array of the same rows, so two copies of a shop's entire item
 * list were resident at once on a process shared with every other shop.
 */
describe('exportCatalogueJsonLd', () => {
  const service = new ItemService();

  const withRows = (rows) => {
    service.repository = {
      /* A stand-in for the streaming grouper: hands over one family at a time,
         exactly as the real one does. */
      streamCatalogue: async ({ branchId, licenseId }, onGroup) => {
        expect(branchId).toBeTruthy();
        expect(licenseId).toBeTruthy();
        const groups = new Map();
        const singles = [];
        rows.forEach((r) => {
          const g = r.variant_group_id ? String(r.variant_group_id) : '';
          if (!g) return singles.push(r);
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(r);
        });
        for (const members of groups.values()) await onGroup(members);
        for (const one of singles) await onGroup([one]);
        return rows.length;
      },
    };
    return service;
  };

  test('produces a valid schema.org graph', async () => {
    const svc = withRows([
      { _id: 'a', name: 'Rice', itemid: 'R1', selling_price: 80 },
    ]);
    const r = await svc.exportCatalogueJsonLd({ branchId: 'b', licenseId: 'l', currency: 'INR' });
    expect(r.status).toBe(true);
    expect(r.data['@context']).toBe('https://schema.org');
    expect(r.data['@graph'][0]['@type']).toBe('Product');
    expect(r.data['@graph'][0].offers.priceCurrency).toBe('INR');
  });

  test('a family becomes one ProductGroup', async () => {
    const svc = withRows([
      { _id: 'a', name: 'Shirt / L', variant_group_id: 'g1', variant_parent_name: 'Shirt',
        variant_axis: 'size', variant_value: 'L', selling_price: 499 },
      { _id: 'b', name: 'Shirt / M', variant_group_id: 'g1', variant_parent_name: 'Shirt',
        variant_axis: 'size', variant_value: 'M', selling_price: 499 },
    ]);
    const r = await svc.exportCatalogueJsonLd({ branchId: 'b', licenseId: 'l' });
    expect(r.data['@graph']).toHaveLength(1);
    expect(r.data['@graph'][0]['@type']).toBe('ProductGroup');
    expect(r.data['@graph'][0].hasVariant).toHaveLength(2);
  });

  test('no currency means no priceCurrency, rather than a guessed one', () => {
    /* A guessed currency on a price is the confident wrong answer this export
       exists to avoid - and "$" does not even identify one. */
    return withRows([{ _id: 'a', name: 'Rice', selling_price: 80 }])
      .exportCatalogueJsonLd({ branchId: 'b', licenseId: 'l' })
      .then((r) => {
        expect(r.data['@graph'][0].offers).not.toHaveProperty('priceCurrency');
      });
  });

  test('it streams - the repository is never asked for everything at once', async () => {
    /* The guard against the .toArray() mistake. If this ever calls a method
       that returns the whole catalogue, the test fails rather than the
       memory. */
    let usedStream = false;
    service.repository = {
      streamCatalogue: async (_ctx, onGroup) => {
        usedStream = true;
        await onGroup([{ _id: 'a', name: 'Rice' }]);
        return 1;
      },
      findPage: () => { throw new Error('findPage must not be used - it pages the whole catalogue'); },
      exportItems: () => { throw new Error('exportItems must not be used - it calls toArray'); },
    };
    const r = await service.exportCatalogueJsonLd({ branchId: 'b', licenseId: 'l' });
    expect(usedStream).toBe(true);
    expect(r.status).toBe(true);
  });

  test('branch and licence are required', async () => {
    /*
     * A repository that would happily answer, so the ONLY way to get a refusal
     * is the guard itself. The first version of this used the asserting mock
     * above, which threw on a falsy branch id - so removing the guard still
     * produced status:false and the test passed for the wrong reason. Found by
     * mutation testing.
     */
    service.repository = {
      streamCatalogue: async (_ctx, onGroup) => { await onGroup([{ _id: 'a', name: 'Rice' }]); return 1; },
    };
    const r = await service.exportCatalogueJsonLd({});
    expect(r.status).toBe(false);
    expect(String(r.message)).toMatch(/branch|licen/i);
  });

  test('a repository failure is reported, not thrown', async () => {
    service.repository = {
      streamCatalogue: async () => { throw new Error('cursor died'); },
    };
    const r = await service.exportCatalogueJsonLd({ branchId: 'b', licenseId: 'l' });
    expect(r.status).toBe(false);
    expect(r.message).toContain('cursor died');
  });
});
