'use strict';

const { sum, negate, nonNegative } = require('./decimal');
const { calendarPeriod } = require('./period');
const moment = require('moment-timezone');

const SOURCES = ['sales', 'purchases', 'salesAdjustments', 'purchaseAdjustments', 'expenses'];
const TYPES = {
  sale: ['sales', 'sales', 1],
  purchase: ['purchases', 'purchases', 1],
  saleCredit: ['salesAdjustments', 'sales', -1],
  saleDebit: ['salesAdjustments', 'sales', 1],
  purchaseCredit: ['purchaseAdjustments', 'purchases', -1],
  purchaseDebit: ['purchaseAdjustments', 'purchases', 1],
  expense: ['expenses', 'expenses', 1],
};
const NATURES = ['taxable', 'exempt', 'nilRated', 'nonTax', 'zeroRated', 'unknown'];

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required');
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new TypeError('Document date requires an explicit UTC offset');
  }
  const result = moment.parseZone(value, moment.ISO_8601, true);
  if (!result.isValid()) throw new TypeError('Invalid document date');
  return result.toDate();
}

/**
 * Pure aggregation boundary for source adapters. Scope comes from an authorised
 * server context; callers must also scope their database queries. Input records
 * are immutable document snapshots, not unwound rows or current item masters.
 * This function neither grants credit nor prepares a statutory return.
 */
function buildLedger({ scope, period: requestedPeriod, sources, documents }) {
  for (const key of ['tenantId', 'registrationId', 'currency']) required(scope[key], key);
  if (!Array.isArray(scope.branchIds) || !scope.branchIds.length) {
    throw new TypeError('At least one authorised branch is required');
  }
  scope.branchIds.forEach((id) => required(id, 'branchId'));
  const period = calendarPeriod(requestedPeriod);
  const exceptions = [];
  const coverage = SOURCES.map((name) => {
    const source = sources?.[name];
    const complete =
      source?.status === 'complete' && typeof source.watermark === 'string' && !!source.watermark;
    if (!complete) exceptions.push({ code: 'SOURCE_INCOMPLETE', source: name });
    return { source: name, complete, watermark: source?.watermark || null };
  });
  const registers = { sales: [], purchases: [], expenses: [] };
  const seen = new Set();
  const excluded = [];

  for (const document of documents) {
    const type = TYPES[document.type];
    if (!type) throw new TypeError('Unsupported tax document type');
    for (const key of ['tenantId', 'registrationId', 'currency']) {
      if (document[key] !== scope[key]) throw new Error('Document is outside report scope: ' + key);
    }
    if (!scope.branchIds.includes(document.branchId))
      throw new Error('Unauthorised document branch');
    const sourceId = required(document.sourceId, 'sourceId');
    required(document.revision, 'revision');
    const identity = JSON.stringify([type[0], document.branchId, sourceId]);
    if (seen.has(identity)) throw new Error('Duplicate source document: ' + sourceId);
    seen.add(identity);
    const date = instant(document.documentDate);
    if (date < period.start || date >= period.endExclusive) {
      excluded.push({ sourceId, source: type[0], reason: 'OUTSIDE_PERIOD' });
      continue;
    }
    // Source adapters must explicitly resolve holds, cancellations and deletes.
    // An unknown status cannot silently become either an invoice or a reversal.
    if (document.status !== 'posted') throw new Error('Unresolved document status: ' + sourceId);
    if (type[0].endsWith('Adjustments')) required(document.originalSourceId, 'originalSourceId');
    const sign = (value) => (type[2] < 0 ? negate(nonNegative(value)) : nonNegative(value));
    const gross = sign(document.gross);
    const row = {
      sourceId,
      source: type[0],
      type: document.type,
      revision: document.revision,
      branchId: document.branchId,
      documentDate: document.documentDate,
      originalSourceId: document.originalSourceId || null,
      gross,
      lines: [],
    };
    if (document.type === 'expense' && document.taxEvidence === 'notRecorded') {
      row.net = null;
      row.tax = null;
      row.taxEvidence = 'notRecorded';
      exceptions.push({ code: 'EXPENSE_TAX_NOT_RECORDED', sourceId });
    } else {
      if (!Array.isArray(document.lines) || !document.lines.length) {
        throw new TypeError('Document lines are required: ' + sourceId);
      }
      const lineIds = new Set();
      row.lines = document.lines.map((line) => {
        const lineId = required(line.lineId, 'lineId');
        if (lineIds.has(lineId)) throw new Error('Duplicate line identity: ' + sourceId);
        lineIds.add(lineId);
        const net = sign(line.net);
        const tax = sign(line.tax);
        const quantity = sign(line.quantity);
        if (!NATURES.includes(line.nature)) throw new TypeError('Supply nature must be explicit');
        if (line.nature === 'unknown')
          exceptions.push({ code: 'SUPPLY_NATURE_UNKNOWN', sourceId, lineId });
        // Missing classification is retained. Never fetch a current HSN/rate.
        return {
          lineId,
          net,
          tax,
          quantity,
          nature: line.nature,
          hsn: line.hsn || null,
          unit: line.unit || null,
        };
      });
      row.net = sum(row.lines.map((line) => line.net));
      row.tax = sum(row.lines.map((line) => line.tax));
      // Round-off is a signed source value, unlike gross and line magnitudes.
      row.adjustment =
        type[2] < 0 ? negate(document.adjustment ?? '0') : sum([document.adjustment ?? '0']);
      const difference = sum([gross, negate(row.net), negate(row.tax), negate(row.adjustment)]);
      row.difference = difference;
      if (difference !== '0')
        exceptions.push({ code: 'DOCUMENT_TOTAL_MISMATCH', sourceId, difference });
    }
    registers[type[1]].push(row);
  }

  const observedTotals = Object.fromEntries(
    Object.entries(registers).map(([name, rows]) => [
      name,
      {
        documents: rows.length,
        gross: sum(rows.map((row) => row.gross)),
        net: rows.some((row) => row.net === null) ? null : sum(rows.map((row) => row.net)),
        tax: rows.some((row) => row.tax === null) ? null : sum(rows.map((row) => row.tax)),
      },
    ])
  );
  const totals = Object.fromEntries(
    Object.entries(observedTotals).map(([name, values]) => {
      const dependencies =
        name === 'expenses'
          ? ['expenses']
          : [name, name === 'sales' ? 'salesAdjustments' : 'purchaseAdjustments'];
      const complete = dependencies.every(
        (source) => coverage.find((entry) => entry.source === source).complete
      );
      return [name, complete ? values : { documents: null, gross: null, net: null, tax: null }];
    })
  );
  return {
    schemaVersion: 1,
    scope: { ...scope, branchIds: [...scope.branchIds] },
    period,
    status: exceptions.length ? 'needsAttention' : 'readyForReview',
    coverage,
    registers,
    totals,
    observedTotals,
    exceptions,
    excluded,
    recordedPurchaseTax: totals.purchases.tax,
    reviewedEligibleCredit: null,
    filingReady: false,
  };
}

module.exports = { buildLedger, SOURCES };
