'use strict';

/**
 * The tax-summary-by-rate aggregation (T3). What must hold: the pipeline
 * SUMS stored per-line values and never recomputes tax (no rate math, no
 * engine call); rows group by (rate, name) so 5% CGST and 5% VAT stay
 * separate lines; net is derived as gross minus tax; untaxed lines fall
 * into their own zero bucket rather than disappearing.
 */

jest.mock('../../../src/repositories/sale.repository', () => ({
  aggregate: jest.fn(async () => []),
}));

const salesRepository = require('../../../src/repositories/sale.repository');
const { getTaxSummaryReportData } = require('../../../src/services/sale.service');

async function pipeline() {
  salesRepository.aggregate.mockClear();
  await getTaxSummaryReportData({ match: { x: 1 } }, { SaleModel: function Sale() {} });
  return salesRepository.aggregate.mock.calls[0][0];
}

describe('tax summary pipeline', () => {
  test('sums stored values only - the set stage reads tax_amount/total_amount, computes nothing', async () => {
    const p = await pipeline();
    const set = p.find((s) => s.$set).$set;
    expect(set._tax_amount).toEqual({ $toDouble: { $ifNull: ['$items.tax_amount', 0] } });
    expect(set._gross).toEqual({ $toDouble: { $ifNull: ['$items.total_amount', 0] } });
    expect(JSON.stringify(p)).not.toContain('multiply');
  });

  test('groups by rate AND name, so equal rates under different taxes stay separate', async () => {
    const p = await pipeline();
    const g = p.find((s) => s.$group).$group;
    expect(g._id).toEqual({ rate: '$_rate', name: '$_name' });
    expect(g.tax).toEqual({ $sum: '$_tax_amount' });
    expect(g.gross).toEqual({ $sum: '$_gross' });
  });

  test('net is gross minus tax - derived, never re-taxed', async () => {
    const p = await pipeline();
    const proj = p.find((s) => s.$project).$project;
    expect(proj.net).toEqual({ $subtract: ['$gross', '$tax'] });
  });

  test('the match the controller built is passed through untouched', async () => {
    const p = await pipeline();
    expect(p[0]).toEqual({ $match: { x: 1 } });
  });
});
