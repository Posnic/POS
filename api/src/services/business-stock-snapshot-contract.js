'use strict';
const crypto = require('node:crypto');
const { MetricError } = require('./business-metrics');
const { validateStockSummary, validateStockFact } = require('./business-stock-contract');
const { validateStockObservation } = require('./business-stock-observation-contract');
const PAGE_SIZE = 100;
// Notification revalidation requires a recent desktop observation, including
// after quiet hours. This does not assert a transactional or complete balance.
const FRESHNESS_MS = 5 * 60000;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const digestOf = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const fail = () => {
  throw new MetricError('invalid_stock_snapshot');
};
const pageCount = (summary) => Math.max(1, Math.ceil(summary.coverage.verifiedItems / PAGE_SIZE));
function validateSnapshotPage(page, branch, options) {
  if (
    !page ||
    Object.keys(page).sort().join(',') !== 'facts,pageIndex,schemaVersion,snapshotId,summary' ||
    page.schemaVersion !== 1 ||
    typeof page.snapshotId !== 'string' ||
    !/^[a-f\d]{64}$/.test(page.snapshotId)
  )
    fail();
  validateStockSummary(page.summary, branch, options);
  if (
    !Number.isInteger(page.pageIndex) ||
    page.pageIndex < 0 ||
    page.pageIndex >= pageCount(page.summary) ||
    !Array.isArray(page.facts) ||
    page.facts.length !==
      Math.min(PAGE_SIZE, page.summary.coverage.verifiedItems - page.pageIndex * PAGE_SIZE)
  )
    fail();
  let previous = '';
  for (const fact of page.facts) {
    validateStockFact(fact);
    if (fact.itemId <= previous) fail();
    previous = fact.itemId;
  }
  return page;
}
function createSnapshotPages(input, branch, options) {
  const observation = structuredClone(input);
  validateStockObservation(observation, branch, options);
  const snapshotId = digestOf(observation);
  return Array.from({ length: pageCount(observation.summary) }, (_, pageIndex) => ({
    schemaVersion: 1,
    snapshotId,
    summary: observation.summary,
    pageIndex,
    facts: observation.facts.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
  }));
}
function assembleSnapshot(pages, branch, options) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 100) fail();
  for (const page of pages) validateSnapshotPage(page, branch, options);
  const first = pages[0];
  if (pages.length !== pageCount(first.summary)) fail();
  const summaryDigest = digestOf(first.summary);
  const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  if (
    sorted.some(
      (page, i) =>
        page.pageIndex !== i ||
        page.snapshotId !== first.snapshotId ||
        digestOf(page.summary) !== summaryDigest
    )
  )
    fail();
  const observation = { summary: first.summary, facts: sorted.flatMap((page) => page.facts) };
  validateStockObservation(observation, branch, options);
  if (digestOf(observation) !== first.snapshotId) fail();
  return observation;
}
module.exports = {
  PAGE_SIZE,
  FRESHNESS_MS,
  digestOf,
  pageCount,
  validateSnapshotPage,
  createSnapshotPages,
  assembleSnapshot,
};
