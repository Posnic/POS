'use strict';
const crypto = require('node:crypto');
const { MetricError } = require('./business-metrics');
const {
  validateStockSummary,
  validateStockFact,
  MAX_LOW_ITEMS,
} = require('./business-stock-contract');
const fail = (code) => {
  throw new MetricError(code);
};
const factDigest = (fact) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        fact.itemId,
        fact.name,
        fact.unit,
        fact.availableMilli,
        fact.thresholdMilli,
        fact.thresholdSource,
        fact.low,
      ])
    )
    .digest('hex');
/** Private observation contract, not a public response. The complete verified set
 * must agree with coverage and the capped public list before any state changes. */
function validateStockObservation(value, branch, options) {
  if (!value || Object.keys(value).sort().join(',') !== 'facts,summary')
    fail('invalid_stock_observation');
  validateStockSummary(value.summary, branch, options);
  if (!Array.isArray(value.facts) || value.facts.length !== value.summary.coverage.verifiedItems)
    fail('invalid_stock_observation');
  let previous = '';
  const low = [];
  for (const fact of value.facts) {
    validateStockFact(fact);
    if (fact.itemId <= previous) fail('invalid_stock_observation');
    previous = fact.itemId;
    if (fact.low) low.push(fact);
  }
  if (
    low.length !== value.summary.lowItemCount ||
    low
      .slice(0, MAX_LOW_ITEMS)
      .some((fact, i) => factDigest(fact) !== factDigest(value.summary.lowItems[i]))
  )
    fail('invalid_stock_observation');
  return value;
}
module.exports = { validateStockObservation };
