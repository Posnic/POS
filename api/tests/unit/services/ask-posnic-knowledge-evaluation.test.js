'use strict';

const { evaluate } = require('../../../scripts/evaluate-ask-posnic-knowledge');
const { retrievalCases } = require('../../../scripts/evaluate-ask-posnic-answers');

test('manual retrieval and fallback retain reviewed evidence and reject unsupported probes', () => {
  const result = evaluate();
  expect(result.source_count).toBeGreaterThanOrEqual(200);
  expect(result.supported_count).toBeGreaterThanOrEqual(20);
  expect(result.evidence_recall).toBeGreaterThanOrEqual(0.9);
  expect(result.fallback_evidence_coverage).toBeGreaterThanOrEqual(0.9);
  expect(result.unsupported_no_match).toBe(1);
}, 30000);

test('100-question development benchmark retains expected source evidence for at least ninety percent of supported cases', () => {
  const cases = retrievalCases(), supported = cases.filter((row) => !row.unsupported);
  expect(cases).toHaveLength(100);
  expect(supported).toHaveLength(80);
  expect(cases.filter((row) => row.unsupported)).toHaveLength(20);
  expect(supported.filter((row) => row.evidence_recalled).length / supported.length).toBeGreaterThanOrEqual(0.9);
  // Checkout credit policy cannot substitute for the restriction on returns.
  const creditReturn = cases.find((row) => row.id === 'expanded-sales-return-exchange-sale-3');
  expect(creditReturn.matches[0].document_id).toBe(creditReturn.source);
  expect(creditReturn.matches[0].text).toContain(creditReturn.evidence);
}, 60000);
