'use strict';
const { fail } = require('../utils/branch-access');

// One journal entry settles the selected bill; its tender parts are projected
// together. Never send separate network requests for parts of a mixed payment.
function validate(tenders, amount, methods) {
  if (!Array.isArray(tenders) || tenders.length < 2 || tenders.length > 3)
    fail('Choose two or three payment methods.');
  const seen = new Set();
  const result = tenders.map(tender => {
    if (!tender || !methods.includes(tender.method) || seen.has(tender.method))
      fail('This payment method is not enabled in Captain.', 403);
    seen.add(tender.method);
    if (!Number.isSafeInteger(tender.amountMinor) || tender.amountMinor <= 0 ||
        !Number.isSafeInteger(tender.receivedMinor) || tender.receivedMinor < tender.amountMinor ||
        tender.receivedMinor > 1e12 || (tender.method !== 'Cash' && tender.receivedMinor !== tender.amountMinor))
      fail('Enter the amount received.');
    if (tender.method !== 'Cash' && tender.verified !== true)
      fail('Verify the received payment.');
    if (typeof (tender.reference || '') !== 'string' || (tender.reference || '').length > 100)
      fail('Invalid payment reference.');
    return {method:tender.method, amountMinor:tender.amountMinor, receivedMinor:tender.receivedMinor,
      reference:(tender.reference || '').trim(), verified:tender.method !== 'Cash'};
  });
  if (result.reduce((sum, tender) => sum + tender.amountMinor, 0) !== amount)
    fail('The payment amounts must equal the bill.', 409);
  return result;
}

function allocate(tenders, allocations) {
  const remaining = {...allocations};
  return tenders.map(tender => {
    let due = tender.amountMinor;
    const parts = {};
    for (const id of Object.keys(remaining).sort()) {
      const take = Math.min(due, remaining[id]);
      if (take) parts[id] = take;
      remaining[id] -= take; due -= take;
    }
    if (due) throw new Error('Tender allocation exceeds the bill.');
    return {...tender, allocations:parts};
  });
}
module.exports = {validate, allocate};
