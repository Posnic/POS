'use strict';

/**
 * A demo shop must not greet its owner with zero revenue.
 *
 * Owner, reading a fresh Kenyan signup's stats: "why no sales data
 * installed and i see revenue 0." The 14 bills were all there - but the
 * seeder wrote its own abbreviated sale shape without `items_total`, and
 * items_total is what the shop's own dashboard, the intranet's business
 * stats and every report SUM. Fourteen bills, ₹0 everywhere.
 *
 * This pins the seeded shape to the read paths: every demo sale carries a
 * numeric items_total equal to its total, the companion fields the same
 * aggregations subtract, and a staff name (the by-staff table said
 * "not set" for every demo bill).
 */

const demoSeed = require('../../../src/services/demo-seed');

const branch = { branch_id: 'b1', branch_name: 'Test', license: 'lic1' };
const items = [
  { _id: 'i1', name: 'Thing', selling_price: 100, unit: 'qty' },
  { _id: 'i2', name: 'Other', selling_price: 50, unit: 'qty' },
];

describe('demo sales revenue shape', () => {
  const sales = demoSeed.buildSales({
    items,
    customers: [],
    customer: null,
    branch,
    pack: 'retail',
    now: new Date('2026-08-26T00:00:00Z'),
    userName: 'owner@example.com',
  });

  it('builds sales at all', () => {
    expect(sales.length).toBeGreaterThan(0);
  });

  it('every demo sale carries a numeric items_total equal to its total', () => {
    for (const s of sales) {
      expect(typeof s.items_total).toBe('number');
      expect(s.items_total).toBeGreaterThan(0);
      expect(s.items_total).toBe(s.total_amount);
      expect(s.items_total).toBe(s.sales_total);
    }
  });

  it('the companion fields the aggregations subtract are present zeros', () => {
    for (const s of sales) {
      for (const k of ['tax', 'gst', 'discount', 'round_off', 'items_return_total']) {
        expect(s[k]).toBe(0);
      }
    }
  });

  it('the staff column has a name, not "not set"', () => {
    for (const s of sales) {
      expect(s.user_name).toBe('owner@example.com');
    }
  });
});
