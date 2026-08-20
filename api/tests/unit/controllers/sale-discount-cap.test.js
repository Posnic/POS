'use strict';

/*
 * The manager-approval cap on discounts, and the parsing bug that broke it.
 *
 * The sale screen sends totals as DISPLAY text taken straight from the
 * totals row - "1,459.00", not 1459. Number.parseFloat stops at the comma
 * and yields 1, so a 34-rupee line discount was measured as 3400% of the
 * bill. Every discounted sale over a thousand rupees therefore demanded
 * manager approval, including for an owner whose cap is 100%.
 *
 * The cap was broken in exactly the direction that matters: it passed the
 * small bills and blocked the large ones.
 */

const {
  estimateManualDiscountPct: estimate,
} = require('../../../src/controllers/sales.controller');

describe('manual discount percentage estimate', () => {
  test('the estimator is actually exported - otherwise everything below is vacuous', () => {
    expect(typeof estimate).toBe('function');
  });

  test("the owner's real bill: 34 off 1,459.00 is 2.3%, not 3400%", () => {
    const pct = estimate({
      sales_sub_total: '1,459.00',
      items: [
        { item_id: 'a', item_discount: 0, item_discount_percentage: 0 },
        { item_id: 'b', item_discount: '34', item_discount_percentage: 0 },
      ],
    });
    expect(pct).toBeCloseTo(2.33, 1);
    expect(pct).toBeLessThan(100);
  });

  test('a plain number subtotal behaves identically', () => {
    const formatted = estimate({
      sales_sub_total: '1,459.00',
      items: [{ item_id: 'b', item_discount: '34' }],
    });
    const plain = estimate({
      sales_sub_total: 1459,
      items: [{ item_id: 'b', item_discount: 34 }],
    });
    expect(formatted).toBeCloseTo(plain, 6);
  });

  test('a European-formatted total parses too', () => {
    // "1.459,00" - dot groups thousands, comma is the decimal
    const pct = estimate({
      sales_sub_total: '1.459,00',
      items: [{ item_id: 'b', item_discount: '34' }],
    });
    expect(pct).toBeCloseTo(2.33, 1);
  });

  test('a currency-prefixed total parses', () => {
    const pct = estimate({
      sales_sub_total: '₹ 1,459.00',
      items: [{ item_id: 'b', item_discount: '34' }],
    });
    expect(pct).toBeCloseTo(2.33, 1);
  });

  test('a genuinely deep discount is still reported as deep', () => {
    // the cap must keep working - this is not a licence to discount freely
    const pct = estimate({
      sales_sub_total: '1,000.00',
      items: [{ item_id: 'b', item_discount: '800' }],
    });
    expect(pct).toBeCloseTo(80, 1);
  });

  test('a percentage line discount is taken at face value', () => {
    const pct = estimate({
      sales_sub_total: '5,000.00',
      items: [{ item_id: 'b', item_discount_percentage: '40' }],
    });
    expect(pct).toBeCloseTo(40, 1);
  });

  test('a percent-typed bill discount counts as that percent', () => {
    const pct = estimate({
      sales_sub_total: '2,500.00',
      extra_discount: '15',
      extra_discount_type: 'percent',
      items: [],
    });
    expect(pct).toBeCloseTo(15, 1);
  });

  test('an amount-typed bill discount is measured against the real subtotal', () => {
    const pct = estimate({
      sales_sub_total: '2,000.00',
      extra_discount: '100',
      extra_discount_type: 'price',
      items: [],
    });
    expect(pct).toBeCloseTo(5, 1);
  });
});
