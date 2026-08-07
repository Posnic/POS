const { checkSale, expectedLineTotal } = require('../../../src/utils/money-invariants');

/*
 * Money, to the paisa.
 *
 * A till wrong by a paisa a line is wrong by real money by the end of a year,
 * and the shop finds out from an accountant rather than from the software. The
 * cases here are the ones floating-point arithmetic actually gets wrong -
 * thirds, 18% inclusive GST, repeating decimals - rather than the round numbers
 * that make a calculator look correct.
 *
 * These same rules run over a shop's live sales via scripts/audit-money.js. A
 * test proves the code was right about the cases somebody imagined; running the
 * rules over real data proves the database is right about the ones nobody did.
 */

const line = (over = {}) => ({
  item_quantity: 1,
  sale_inline_item_price: 100,
  sale_inline_discount_pervalue: 0,
  sale_inline_discount_value: 0,
  tax_type: 'exclusive',
  tax_amount: 0,
  total_amount: 100,
  ...over,
});

const sale = (lines, over = {}) => {
  const sum = lines.reduce((a, l) => a + l.total_amount, 0);
  const gross = lines.reduce((a, l) => a + l.item_quantity * l.sale_inline_item_price, 0);
  return {
    sales_id: 'TEST',
    items: lines,
    round_off: 0,
    items_total: sum,
    sales_sub_total: gross,
    sales_total: sum,
    ...over,
  };
};

describe('a line of a sale', () => {
  it('is quantity times price', () => {
    expect(expectedLineTotal(line({ item_quantity: 3, sale_inline_item_price: 45 }))).toBe(135);
  });

  it('applies a percentage discount', () => {
    expect(expectedLineTotal(line({ sale_inline_discount_pervalue: 50 }))).toBe(50);
  });

  it('applies a flat discount', () => {
    expect(expectedLineTotal(line({ sale_inline_discount_value: 15 }))).toBe(85);
  });

  it('adds tax charged on top, and not tax already in the price', () => {
    // Inclusive tax added again is the customer paying it twice.
    expect(expectedLineTotal(line({ tax_type: 'exclusive', tax_amount: 18 }))).toBe(118);
    expect(expectedLineTotal(line({ tax_type: 'inclusive', tax_amount: 18 }))).toBe(100);
  });

  it('prices a weight to the gram', () => {
    // 0.375kg at 94/kg. Round the weight to 2dp and the shop gives away 5g.
    expect(
      expectedLineTotal(
        line({
          item_quantity: 0.375,
          sale_inline_item_price: 94,
        })
      )
    ).toBeCloseTo(35.25, 6);
  });
});

describe('a sale that adds up', () => {
  it('passes when every rule holds', () => {
    expect(
      checkSale(sale([line(), line({ sale_inline_item_price: 55, total_amount: 55 })]))
    ).toEqual([]);
  });

  it('passes with a discounted line, the shape that fooled a hand-written audit', () => {
    // 94 at 50% is 47. Read the wrong discount field and this looks like a
    // line that lost half its value.
    const l = line({
      sale_inline_item_price: 94,
      sale_inline_discount_pervalue: 50,
      total_amount: 47,
    });
    expect(checkSale(sale([l]))).toEqual([]);
  });

  it('passes when rounding is what closes the gap', () => {
    const l = line({ item_quantity: 1.3, sale_inline_item_price: 383.5, total_amount: 498.55 });
    expect(checkSale(sale([l], { items_total: 499, sales_total: 499, round_off: 0.45 }))).toEqual(
      []
    );
  });

  it('passes on thirds, where floating point is at its worst', () => {
    const l = () => line({ item_quantity: 1, sale_inline_item_price: 33.33, total_amount: 33.33 });
    expect(checkSale(sale([l(), l(), l()]))).toEqual([]);
  });
});

describe('a sale that does not add up', () => {
  it('catches a line that is wrong', () => {
    const bad = line({ total_amount: 99 }); // should be 100
    const problems = checkSale(
      sale([bad], { items_total: 99, sales_total: 99, sales_sub_total: 100 })
    );
    expect(problems.some((p) => p.rule === 'line-total')).toBe(true);
    expect(problems.find((p) => p.rule === 'line-total').difference).toBeCloseTo(-1, 6);
  });

  it('catches a total that does not match its lines', () => {
    const problems = checkSale(sale([line(), line()], { items_total: 199 }));
    expect(problems.some((p) => p.rule === 'lines-vs-items-total')).toBe(true);
  });

  it('catches a customer being charged something other than the items', () => {
    const problems = checkSale(sale([line()], { sales_total: 120 }));
    expect(problems.some((p) => p.rule === 'items-vs-sales-total')).toBe(true);
  });

  it('catches split payments that do not cover the sale', () => {
    // Cash plus UPI must equal the bill; a shortfall here is a till that will
    // not balance at closing and nobody knowing which sale did it.
    const s = sale([line()], { multi_payment: [{ amount: 60 }, { amount: 30 }] });
    const problems = checkSale(s);
    expect(problems.some((p) => p.rule === 'payments-vs-total')).toBe(true);
    expect(problems.find((p) => p.rule === 'payments-vs-total').difference).toBeCloseTo(-10, 6);
  });

  it('says which sale and by how much, not merely that something is wrong', () => {
    // "A sale is bad" cannot be acted on. "SID000034 line 2 is 40 paise light"
    // can be.
    const problems = checkSale(
      sale([line({ total_amount: 99.6 })], {
        sales_id: 'SID000034',
        items_total: 99.6,
        sales_total: 99.6,
        sales_sub_total: 100,
      })
    );
    expect(problems[0].sale).toBe('SID000034');
    expect(problems[0].detail).toMatch(/line 1/);
    expect(problems[0].difference).toBeCloseTo(-0.4, 6);
  });

  it('tolerates float noise, not real differences', () => {
    // 0.1 + 0.2 is 0.30000000000000004 and must not be reported; half a paisa
    // out on every line of every sale is a real loss and must be.
    const noisy = line({ item_quantity: 3, sale_inline_item_price: 0.1, total_amount: 0.1 + 0.2 });
    expect(
      checkSale(
        sale([noisy], {
          items_total: 0.1 + 0.2,
          sales_total: 0.1 + 0.2,
          sales_sub_total: 0.30000000000000004,
        })
      )
    ).toEqual([]);
  });
});
