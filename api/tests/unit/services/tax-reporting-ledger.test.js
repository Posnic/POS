'use strict';

const { buildLedger, SOURCES } = require('../../../src/services/tax-reporting/ledger');
const { calendarPeriod } = require('../../../src/services/tax-reporting/period');
const { sum, negate } = require('../../../src/services/tax-reporting/decimal');

const scope = {
  tenantId: 'tenant-a',
  registrationId: 'registration-a',
  currency: 'INR',
  branchIds: ['branch-a'],
};
const period = { from: '2024-02-01', through: '2024-02-29', timezone: 'Asia/Kolkata' };
function document(overrides = {}) {
  return {
    ...scope,
    branchId: 'branch-a',
    sourceId: 'invoice-1',
    revision: 'revision-1',
    type: 'sale',
    status: 'posted',
    documentDate: '2024-02-15T10:00:00+05:30',
    gross: '118',
    lines: [
      { lineId: '1', quantity: '0.125', net: '100', tax: '18', nature: 'taxable', unit: 'kg' },
    ],
    ...overrides,
  };
}
function run(documents, overrides = {}) {
  return buildLedger({
    scope,
    period,
    sources: Object.fromEntries(
      SOURCES.map((name) => [name, { status: 'complete', watermark: 'cutoff-1' }])
    ),
    documents,
    ...overrides,
  });
}

describe('tax reporting exact decimals', () => {
  test('keeps source precision and does not use floating point summation', () => {
    expect(sum(['0.1', '0.2', '0.000001'])).toBe('0.300001');
    expect(sum(['999999999999999999.99', '0.01'])).toBe('1000000000000000000');
    expect(negate('-0.125')).toBe('0.125');
  });
  test.each([null, undefined, '', 'NaN', '1,000', '1e3', 1, '0.0000000000001'])(
    'rejects invalid evidence %s',
    (value) => {
      expect(() => sum([value])).toThrow();
    }
  );
  test('sums more than a spreadsheet page without an argument-stack limit', () => {
    expect(sum(Array(150000).fill('0.01'))).toBe('1500');
  });
});

describe('tax calendar boundaries', () => {
  test('leap February ends at local March midnight, exclusively', () => {
    const p = calendarPeriod(period);
    expect(p.start.toISOString()).toBe('2024-01-31T18:30:00.000Z');
    expect(p.endExclusive.toISOString()).toBe('2024-02-29T18:30:00.000Z');
  });
  test('daylight saving is a calendar day, not an added 24 hours', () => {
    const p = calendarPeriod({
      from: '2024-03-10',
      through: '2024-03-10',
      timezone: 'America/New_York',
    });
    expect(p.endExclusive - p.start).toBe(23 * 60 * 60 * 1000);
  });
  test.each([{ through: '2024-02-31' }, { timezone: 'invalid' }, { from: '2024-03-01' }])(
    'rejects invalid period %j',
    (change) => {
      expect(() => calendarPeriod({ ...period, ...change })).toThrow();
    }
  );
});

describe('canonical tax ledger contract', () => {
  test('equal-valued purchases remain separate documents and both count', () => {
    const result = run([
      document({ type: 'purchase' }),
      document({ type: 'purchase', sourceId: 'invoice-2' }),
    ]);
    expect(result.totals.purchases).toEqual({ documents: 2, net: '200', tax: '36', gross: '236' });
    expect(result.recordedPurchaseTax).toBe('36');
    expect(result.reviewedEligibleCredit).toBeNull();
    expect(result.filingReady).toBe(false);
  });
  test('mixed rate invoice gross counts once; fractional units survive', () => {
    const first = document();
    const result = run([
      document({
        gross: '223',
        lines: [
          ...first.lines,
          { lineId: '2', quantity: '1.75', unit: 'meter', net: '100', tax: '5', nature: 'taxable' },
        ],
      }),
    ]);
    expect(result.totals.sales).toEqual({ documents: 1, net: '200', tax: '23', gross: '223' });
    expect(result.registers.sales[0].lines.map((line) => line.quantity)).toEqual(['0.125', '1.75']);
  });
  test('source edit date never moves an invoice across reporting periods', () => {
    expect(run([document({ updated_date: '2024-06-01' })]).totals.sales.gross).toBe('118');
  });
  test('includes start, excludes next period start', () => {
    const result = run([
      document({ documentDate: '2024-01-31T18:30:00Z' }),
      document({ sourceId: 'next', documentDate: '2024-02-29T18:30:00Z' }),
    ]);
    expect(result.totals.sales.documents).toBe(1);
    expect(result.excluded).toEqual([
      { sourceId: 'next', source: 'sales', reason: 'OUTSIDE_PERIOD' },
    ]);
  });
  test('later credit note reverses in its own period with original reference', () => {
    const result = run([
      document({ documentDate: '2024-01-15T10:00:00Z' }),
      document({ type: 'saleCredit', sourceId: 'credit-1', originalSourceId: 'invoice-1' }),
    ]);
    expect(result.totals.sales).toEqual({ documents: 1, net: '-100', tax: '-18', gross: '-118' });
    expect(result.registers.sales[0].originalSourceId).toBe('invoice-1');
  });
  test('negative source round-off reconciles without changing tax', () => {
    const result = run([document({ gross: '117.99', adjustment: '-0.01' })]);
    expect(result.registers.sales[0].difference).toBe('0');
    expect(result.status).toBe('readyForReview');
  });
  test('missing expense tax stays unknown, never becomes credit', () => {
    const result = run([
      document({ type: 'expense', taxEvidence: 'notRecorded', lines: undefined }),
    ]);
    expect(result.totals.expenses).toEqual({ documents: 1, gross: '118', net: null, tax: null });
    expect(result.status).toBe('needsAttention');
    expect(result.reviewedEligibleCredit).toBeNull();
  });
  test('a failed or absent source cannot produce a complete report', () => {
    const result = run([], { sources: { sales: { status: 'failed' } } });
    expect(result.coverage.every((entry) => !entry.complete)).toBe(true);
    expect(result.exceptions).toHaveLength(5);
    expect(result.status).toBe('needsAttention');
    expect(result.totals.purchases.tax).toBeNull();
    expect(result.recordedPurchaseTax).toBeNull();
  });
  test('missing watermark is incomplete even if the query says complete', () => {
    expect(run([], { sources: { sales: { status: 'complete' } } }).coverage[0].complete).toBe(
      false
    );
  });
  test('totals mismatch is exposed and retained for review', () => {
    const result = run([document({ gross: '120' })]);
    expect(result.exceptions).toContainEqual({
      code: 'DOCUMENT_TOTAL_MISMATCH',
      sourceId: 'invoice-1',
      difference: '2',
    });
    expect(result.totals.sales.gross).toBe('120');
  });
  test.each(['tenantId', 'registrationId', 'currency', 'branchId'])(
    'rejects out-of-scope %s',
    (key) => {
      expect(() => run([document({ [key]: 'other' })])).toThrow();
    }
  );
  test('rejects duplicate documents instead of silently double counting', () => {
    expect(() => run([document(), document()])).toThrow('Duplicate source document');
  });
  test('rejects duplicate line identities without collapsing equal-valued distinct lines', () => {
    const doc = document();
    expect(() => run([document({ lines: [...doc.lines, ...doc.lines] })])).toThrow(
      'Duplicate line'
    );
  });
  test.each([
    { type: 'saleCredit' },
    { status: 'cancelled' },
    { documentDate: '2024-02-01' },
    { documentDate: '2024-02-31T00:00:00Z' },
    { gross: null },
    { lines: [] },
  ])('rejects unresolved source contract %j', (change) => {
    expect(() => run([document(change)])).toThrow();
  });
  test('unknown supply nature stays visible and never guesses exemption', () => {
    const doc = document();
    doc.lines[0].nature = 'unknown';
    const result = run([doc]);
    expect(result.exceptions).toContainEqual({
      code: 'SUPPLY_NATURE_UNKNOWN',
      sourceId: 'invoice-1',
      lineId: '1',
    });
  });
  test('does not modify source documents and produces JSON-safe output', () => {
    const doc = document();
    const before = JSON.stringify(doc);
    expect(() => JSON.stringify(run([doc]))).not.toThrow();
    expect(JSON.stringify(doc)).toBe(before);
  });
});
