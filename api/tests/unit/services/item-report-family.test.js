'use strict';

/**
 * The family view of the item sales report (V1 tail) and its invariant:
 * grouping by family is OFF by default, and when on it only changes the
 * GROUP KEY and display name - the summed inputs are the same per-line
 * values, and non-family items key exactly as before.
 *
 * Tested against the pipeline the service builds, via a captured
 * aggregate call - no database.
 */

jest.mock('../../../src/repositories/sale.repository', () => ({
  aggregate: jest.fn(async () => [{ total: 0, list: [] }]),
}));

const salesRepository = require('../../../src/repositories/sale.repository');
const { getItemSalesReportTableData } = require('../../../src/services/sale.service');

const groupStage = (pipeline) => pipeline.find((s) => s.$group).$group;

async function pipelineFor(opts) {
  salesRepository.aggregate.mockClear();
  await getItemSalesReportTableData(
    { match: {}, skip: 0, limit: 5, ...opts },
    { SaleModel: function Sale() {} }
  );
  return salesRepository.aggregate.mock.calls[0][0];
}

describe('item report family view', () => {
  test('default (flag absent): the group key is the item, exactly as always', async () => {
    const g = groupStage(await pipelineFor({}));
    expect(g._id).toEqual({ $ifNull: ['$normalizedItemId', '$normalizedItemName'] });
    expect(g.family_members).toBeUndefined();
  });

  test('family view: group key falls back item-first for anything without a family', async () => {
    const g = groupStage(await pipelineFor({ groupByFamily: true }));
    expect(g._id).toEqual({
      $ifNull: [
        '$item_info.variant_group_id',
        { $ifNull: ['$normalizedItemId', '$normalizedItemName'] },
      ],
    });
    expect(g.name).toEqual({
      $first: { $ifNull: ['$item_info.variant_parent_name', '$normalizedItemName'] },
    });
    expect(g.family_members).toBeDefined();
  });

  test('the summed inputs are IDENTICAL in both modes - the rollup reads, never recomputes', async () => {
    const off = groupStage(await pipelineFor({}));
    const on = groupStage(await pipelineFor({ groupByFamily: true }));
    for (const key of [
      'total_amount',
      'item_quantity',
      'total_company_price',
      'total_tax_amount',
      'sales_avg',
      'sales_count',
    ]) {
      expect(on[key]).toEqual(off[key]);
    }
  });
});
