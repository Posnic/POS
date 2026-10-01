'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const retrieval = require('../src/services/ask-posnic-retrieval');
const corpus = require('../tests/fixtures/ask-posnic-knowledge-sources.json');
const cases = require('../tests/fixtures/ask-posnic-knowledge-cases.json');
const normalize = (value) => String(value).replace(/\s+/g, ' ').toLowerCase();

function evaluate() {
  for (const source of corpus.documents) {
    if (crypto.createHash('sha256').update(source.content).digest('hex') !== source.sha256) throw new Error(`Source hash mismatch: ${source._id}`);
  }
  const results = cases.map((test) => {
    const accepted = test.unsupported ? [] : [{ source: test.source, evidence: test.evidence }, ...(test.alternatives || [])];
    for (const evidence of accepted) {
      const source = corpus.documents.find((doc) => doc._id === evidence.source);
      if (!source || !normalize(source.content).includes(normalize(evidence.evidence))) throw new Error(`Expected evidence is absent from its recorded source: ${test.id}`);
    }
    const matches = retrieval.rank(corpus.documents, test.question);
    const answer = retrieval.excerptAnswer(matches);
    return {
      id: test.id, question: test.question, unsupported: Boolean(test.unsupported),
      expected_source: test.source || null, expected_evidence: test.evidence || null,
      accepted_evidence: accepted,
      source_recalled: test.unsupported ? null : matches.some((row) => row.document_id === test.source),
      primary_evidence_recalled: test.unsupported ? null : matches.some((row) => row.document_id === test.source && normalize(row.text).includes(normalize(test.evidence))),
      evidence_recalled: test.unsupported ? null : matches.some((row) => accepted.some((evidence) => row.document_id === evidence.source && normalize(row.text).includes(normalize(evidence.evidence)))),
      fallback_contains_evidence: test.unsupported ? null : accepted.some((evidence) => matches.some((row) => row.document_id === evidence.source) && normalize(answer).includes(normalize(evidence.evidence))),
      no_match: matches.length === 0,
      answer_excerpt: answer,
      candidates: matches.map((row) => ({ document_id: row.document_id, revision: row.revision, chunk: row.chunk, coverage: row.coverage, text: row.text })),
    };
  });
  const supported = results.filter((row) => !row.unsupported), unsupported = results.filter((row) => row.unsupported);
  return {
    scope: 'Offline retrieval and fallback evidence coverage against recorded manual snapshots. Not a generated-answer correctness score or production pilot.',
    generated_at: new Date().toISOString(), source_count: corpus.documents.length,
    supported_count: supported.length, unsupported_count: unsupported.length,
    source_recall: supported.filter((row) => row.source_recalled).length / supported.length,
    primary_evidence_recall: supported.filter((row) => row.primary_evidence_recalled).length / supported.length,
    evidence_recall: supported.filter((row) => row.evidence_recalled).length / supported.length,
    fallback_evidence_coverage: supported.filter((row) => row.fallback_contains_evidence).length / supported.length,
    unsupported_no_match: unsupported.filter((row) => row.no_match).length / unsupported.length,
    generated_answer_review: 'Not run; requires separate source-grounded review.', results,
  };
}

if (require.main === module) {
  const report = evaluate();
  const output = path.resolve(__dirname, '../../output/ask-posnic-knowledge-evaluation.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const { results, ...summary } = report;
  console.log(JSON.stringify({ ...summary, output, missing_evidence: results.filter((row) => !row.unsupported && !row.evidence_recalled).map((row) => row.id), unsupported_matches: results.filter((row) => row.unsupported && !row.no_match).map((row) => row.id) }, null, 2));
  if (process.argv.includes('--assert') && (report.evidence_recall < 0.9 || report.fallback_evidence_coverage < 0.9 || report.unsupported_no_match !== 1)) process.exitCode = 1;
}

module.exports = { evaluate };
