'use strict';

/*
 * The statutory credit order, as a pure function (PURCHASE_TAX_PLAN P4).
 *
 * IGST credit spends against IGST, then CGST, then SGST. CGST credit spends
 * against CGST then IGST. SGST credit spends against SGST then IGST. CGST
 * and SGST never pay each other - the one rule everyone gets wrong, and the
 * reason this lives alone where a test can hold it still.
 *
 * Single-head regimes pass zeros in cgst/sgst and the function degrades to
 * plain output-minus-input on the igst column.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {{igst:number,cgst:number,sgst:number}} output - tax collected
 * @param {{igst:number,cgst:number,sgst:number}} input - creditable tax paid
 * @returns {{net:{igst,cgst,sgst,total}, credit_carried:number}}
 */
function netTaxHeads(output, input) {
  const liab = { igst: r2(output.igst), cgst: r2(output.cgst), sgst: r2(output.sgst) };
  const cred = { igst: r2(input.igst), cgst: r2(input.cgst), sgst: r2(input.sgst) };
  const spend = (from, to) => {
    const used = Math.min(cred[from], liab[to]);
    cred[from] = r2(cred[from] - used);
    liab[to] = r2(liab[to] - used);
  };
  spend('igst', 'igst');
  spend('igst', 'cgst');
  spend('igst', 'sgst');
  spend('cgst', 'cgst');
  spend('cgst', 'igst');
  spend('sgst', 'sgst');
  spend('sgst', 'igst');
  const net = { igst: liab.igst, cgst: liab.cgst, sgst: liab.sgst };
  net.total = r2(net.igst + net.cgst + net.sgst);
  return { net, credit_carried: r2(cred.igst + cred.cgst + cred.sgst) };
}

module.exports = { netTaxHeads };
