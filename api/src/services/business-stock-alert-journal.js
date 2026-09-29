'use strict';
const crypto = require('node:crypto');
const { isMultiTenant } = require('../db/tenant-context');
const { MetricError } = require('./business-metrics');
const {
  validateStockSummary,
  validateStockFact,
  MAX_LOW_ITEMS,
} = require('./business-stock-contract');
const MAX_PENDING_EVENTS = 20;
const fail = (code) => {
  throw new MetricError(code);
};
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factDigest = (fact) =>
  hash([
    fact.itemId,
    fact.name,
    fact.unit,
    fact.availableMilli,
    fact.thresholdMilli,
    fact.thresholdSource,
    fact.low,
  ]);
/** Internal desktop contract, not a public response. The complete verified set
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
/** Persist classification and its event together in one Mongo document. A crash
 * can replay a completed observation without losing or duplicating an episode.
 * This journals low episodes only: healthy observations re-arm, but never assert
 * that goods were received. Unknown/excluded/absent items do not change state. */
async function journalStockObservation(
  db,
  observation,
  branch,
  { now = Date.now, signal, afterItemId = null, limit = 100 } = {}
) {
  if (process.env.POSNIC_DESKTOP !== '1' || isMultiTenant()) fail('desktop_required');
  observation = structuredClone(observation);
  validateStockObservation(observation, branch, { now });
  const { summary, facts } = observation;
  if (now() - Date.parse(summary.preparedAt) > 24 * 60 * 60 * 1000) fail('stale_stock_observation');
  const collection = db.collection('business_stock_alert_local');
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (afterItemId !== null && !facts.some((fact) => fact.itemId === afterItemId))
  )
    fail('invalid_stock_alert_cursor');
  const started = now();
  let queued = 0,
    processed = 0,
    last = afterItemId;
  const remaining = facts.filter((fact) => afterItemId === null || fact.itemId > afterItemId);
  const progress = () => ({
    queued,
    processed,
    complete: processed === remaining.length,
    nextAfter: processed < remaining.length ? last : null,
  });
  for (const fact of remaining) {
    if (processed >= limit || now() - started >= 3000) return progress();
    const key = branch.license + ':' + branch.id + ':' + fact.itemId;
    const digest = factDigest(fact);
    let saved = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) fail('cancelled');
      if (now() - started >= 3000) return progress();
      const prior = await collection.findOne({ _id: key }, { maxTimeMS: 500 });
      if (prior) {
        if (
          prior.schemaVersion !== 1 ||
          prior.license !== branch.license ||
          prior.branchId !== branch.id ||
          prior.itemId !== fact.itemId ||
          !Number.isSafeInteger(prior.revision) ||
          prior.revision < 1 ||
          prior.revision >= Number.MAX_SAFE_INTEGER ||
          !Number.isSafeInteger(prior.episode) ||
          prior.episode < 0 ||
          prior.episode >= Number.MAX_SAFE_INTEGER ||
          typeof prior.low !== 'boolean' ||
          !Array.isArray(prior.pendingEvents) ||
          prior.pendingEvents.length > MAX_PENDING_EVENTS ||
          !/^[a-f\d]{64}$/.test(prior.digest) ||
          typeof prior.preparedAt !== 'string' ||
          !Number.isFinite(Date.parse(prior.preparedAt)) ||
          new Date(prior.preparedAt).toISOString() !== prior.preparedAt
        )
          fail('invalid_stock_alert_state');
        if (prior.preparedAt > summary.preparedAt) {
          saved = true;
          break;
        }
        if (prior.preparedAt === summary.preparedAt) {
          if (prior.digest !== digest) fail('conflicting_stock_observation');
          saved = true;
          break;
        }
        if (prior.preparedAt > summary.observedFrom) fail('overlapping_stock_observation');
      }
      if (now() - started >= 3000) return progress();
      const newLow = fact.low && prior?.low !== true;
      if (newLow && (prior?.pendingEvents.length ?? 0) >= MAX_PENDING_EVENTS)
        fail('stock_alert_backpressure');
      const episode = (prior?.episode ?? 0) + (newLow ? 1 : 0);
      const event = newLow
        ? {
            eventId: hash([key, episode]),
            episode,
            fact,
            observedFrom: summary.observedFrom,
            preparedAt: summary.preparedAt,
            sourceComplete: false,
          }
        : null;
      const update = {
        $set: {
          schemaVersion: 1,
          license: branch.license,
          branchId: branch.id,
          itemId: fact.itemId,
          low: fact.low,
          episode,
          digest,
          preparedAt: summary.preparedAt,
          revision: (prior?.revision ?? 0) + 1,
        },
        ...(event ? { $push: { pendingEvents: event } } : {}),
        ...(!prior && !event ? { $setOnInsert: { pendingEvents: [] } } : {}),
      };
      try {
        const result = await collection.updateOne(
          { _id: key, revision: prior ? prior.revision : { $exists: false } },
          update,
          { upsert: !prior, maxTimeMS: 500 }
        );
        if (result.matchedCount || result.upsertedCount) {
          queued += newLow ? 1 : 0;
          saved = true;
          break;
        }
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    if (!saved) fail('stock_alert_busy');
    processed++;
    last = fact.itemId;
  }
  return progress();
}
module.exports = { validateStockObservation, journalStockObservation, MAX_PENDING_EVENTS };
