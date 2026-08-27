'use strict';

/*
 * The statutory credit order, held still (PURCHASE_TAX_PLAN P4). The rule
 * everyone gets wrong is the one asserted hardest: CGST and SGST never pay
 * each other, whatever is left over.
 */

const { netTaxHeads } = require('../../../src/utils/tax-netting');

describe('netTaxHeads - the statutory credit order', () => {
  test("the owner's worked example: 27 collected, 18 paid, 9 owed", () => {
    const { net } = netTaxHeads({ igst: 0, cgst: 13.5, sgst: 13.5 }, { igst: 0, cgst: 9, sgst: 9 });
    expect(net).toEqual({ igst: 0, cgst: 4.5, sgst: 4.5, total: 9 });
  });

  test('IGST credit crosses into CGST and then SGST', () => {
    const { net, credit_carried } = netTaxHeads(
      { igst: 10, cgst: 20, sgst: 20 },
      { igst: 40, cgst: 0, sgst: 0 }
    );
    // 40 IGST credit: 10 against IGST, 20 against CGST, 10 against SGST
    expect(net).toEqual({ igst: 0, cgst: 0, sgst: 10, total: 10 });
    expect(credit_carried).toBe(0);
  });

  test('CGST credit NEVER pays SGST, and the surplus carries forward', () => {
    const { net, credit_carried } = netTaxHeads(
      { igst: 0, cgst: 5, sgst: 30 },
      { igst: 0, cgst: 25, sgst: 0 }
    );
    // 25 CGST credit: 5 against CGST, nothing against IGST (none owed),
    // and NOT ONE RUPEE against the 30 SGST still due.
    expect(net).toEqual({ igst: 0, cgst: 0, sgst: 30, total: 30 });
    expect(credit_carried).toBe(20);
  });

  test('SGST credit mirrors: SGST then IGST, never CGST', () => {
    const { net, credit_carried } = netTaxHeads(
      { igst: 8, cgst: 12, sgst: 0 },
      { igst: 0, cgst: 0, sgst: 20 }
    );
    expect(net).toEqual({ igst: 0, cgst: 12, sgst: 0, total: 12 });
    expect(credit_carried).toBe(12);
  });

  test('a single-head regime degrades to plain output minus input', () => {
    const { net } = netTaxHeads({ igst: 100, cgst: 0, sgst: 0 }, { igst: 60, cgst: 0, sgst: 0 });
    expect(net.total).toBe(40);
  });

  test('more credit than liability owes nothing and carries the rest', () => {
    const { net, credit_carried } = netTaxHeads(
      { igst: 5, cgst: 5, sgst: 5 },
      { igst: 30, cgst: 0, sgst: 0 }
    );
    expect(net.total).toBe(0);
    expect(credit_carried).toBe(15);
  });

  test('paise survive the rounding', () => {
    const { net } = netTaxHeads(
      { igst: 0, cgst: 10.005, sgst: 10.004 },
      { igst: 0, cgst: 3.333, sgst: 3.333 }
    );
    expect(net.cgst).toBeCloseTo(6.68, 2);
    expect(net.sgst).toBeCloseTo(6.67, 2);
  });
});
