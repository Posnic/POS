'use strict';

/**
 * The line-tax engine's contract (T1). These vectors pin the six field-
 * proven branches to hand-computed values from the exact formulas in
 * sale.service.js:357-551. A call site swapped onto the engine must keep
 * this suite AND the full sale suite green - that is the parity gate.
 */

const { computeLineTax } = require('../../../src/services/tax-engine');

const line = (over) => ({
  sellingPrice: 100,
  itemQuantity: 2,
  itemAmount: 200,
  itemTax: 0,
  taxType: '',
  discountAmount: 0,
  discountPercentage: 0,
  ...over,
});

describe('computeLineTax - the six branches, hand-computed', () => {
  test('exclusive + amount discount', () => {
    // subTotal = 200 - 10*2 = 180; tax = 18% of 180 = 32.4; total 212.4
    const r = computeLineTax(line({ itemTax: 18, taxType: 'exclusive', discountAmount: 10 }));
    expect(r.tax).toBeCloseTo(32.4, 10);
    expect(r.total).toBeCloseTo(212.4, 10);
    expect(r.discount).toBe(20);
    expect(r.subtotal).toBe(200);
    expect(r.taxForItem).toBe(32.4);
  });

  test('inclusive + amount discount', () => {
    // tax_price = 100*18/118 = 15.254237...; net unit = 84.745763...
    // net line = 169.491525; after discount 149.491525
    // total = 149.491525 * 1.18 = 176.4; tax = 26.9084746...
    const r = computeLineTax(line({ itemTax: 18, taxType: 'inclusive', discountAmount: 10 }));
    expect(r.total).toBeCloseTo(176.4, 6);
    expect(r.tax).toBeCloseTo(26.9084745762711, 8);
    expect(r.discount).toBe(20);
    expect(r.taxForItem).toBe(26.91);
  });

  test('exclusive + percent discount', () => {
    // after 10%: 180; tax 32.4; total 212.4; discount 20; subtotal 200
    const r = computeLineTax(line({ itemTax: 18, taxType: 'exclusive', discountPercentage: 10 }));
    expect(r.total).toBeCloseTo(212.4, 10);
    expect(r.tax).toBeCloseTo(32.4, 10);
    expect(r.discount).toBeCloseTo(20, 10);
    expect(r.subtotal).toBeCloseTo(200, 10);
  });

  test('inclusive + percent discount', () => {
    // net line 169.491525; discount 16.9491525; taxable 152.542372
    // tax = 27.4576271; TOTAL stays the discounted gross: 180
    const r = computeLineTax(line({ itemTax: 18, taxType: 'inclusive', discountPercentage: 10 }));
    expect(r.total).toBeCloseTo(180, 10);
    expect(r.tax).toBeCloseTo(27.457627118644, 8);
    expect(r.discount).toBeCloseTo(16.9491525423729, 8);
    expect(r.subtotal).toBeCloseTo(169.491525423729, 8);
  });

  test('exclusive, no discount', () => {
    const r = computeLineTax(line({ itemTax: 18, taxType: 'exclusive' }));
    expect(r.total).toBeCloseTo(236, 10);
    expect(r.tax).toBeCloseTo(36, 10);
    expect(r.subtotal).toBe(200);
  });

  test('inclusive, no discount', () => {
    // total = gross 200; net = 169.491525; tax = 30.5084746
    const r = computeLineTax(line({ itemTax: 18, taxType: 'inclusive' }));
    expect(r.total).toBe(200);
    expect(r.tax).toBeCloseTo(30.5084745762712, 8);
    expect(r.subtotal).toBeCloseTo(169.491525423729, 8);
  });

  test('discount only, no tax (amount and percent)', () => {
    const a = computeLineTax(line({ discountAmount: 10 }));
    expect(a).toMatchObject({ total: 180, tax: 0, discount: 20, subtotal: 200 });
    const p = computeLineTax(line({ discountPercentage: 10 }));
    expect(p).toMatchObject({ total: 180, tax: 0, discount: 20, subtotal: 200 });
  });

  test('plain line - nothing at all', () => {
    expect(computeLineTax(line({}))).toMatchObject({
      total: 200,
      tax: 0,
      taxForItem: 0,
      discount: 0,
      subtotal: 200,
    });
  });

  test('legacy fallback: rate-less line carrying a GST amount reconstructs the PHP shape', () => {
    // 10% discount on 200 -> lineTotal 180, gst 5.28
    // afterDiscountBeforeTax = 174.72; baseBeforeDiscount = 194.1333...
    // discount = 19.41333...; effective rate = 5.28/174.72*100 = 3.02
    const r = computeLineTax(line({ discountPercentage: 10, gstAmount: 5.28 }));
    expect(r.total).toBeCloseTo(180, 10);
    expect(r.tax).toBe(5.28);
    expect(r.taxForItem).toBe(5.28);
    expect(r.discount).toBeCloseTo(19.4133333333333, 8);
    expect(r.subtotal).toBeCloseTo(194.133333333333, 8);
    expect(r.effectiveTax).toBe(3.02);
    expect(r.effectiveTaxType).toBe('inclusive');
  });

  test('the deliberate asymmetry: stored line tax rounds, raw tax does not', () => {
    const r = computeLineTax(line({ itemTax: 18, taxType: 'inclusive' }));
    expect(r.taxForItem).toBe(30.51);
    expect(r.tax).not.toBe(r.taxForItem);
  });
});
