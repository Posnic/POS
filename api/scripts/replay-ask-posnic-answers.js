'use strict';
// Re-evaluate captured public benchmark outputs through current validation without
// another provider call. This is explicitly offline replay, never a new live run.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const grounding = require('../src/services/ask-posnic-grounding.service');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  const input = path.resolve(__dirname, '../../output/ask-posnic-answers-live.json');
  const raw = fs.readFileSync(input), captured = JSON.parse(raw);
  if (!captured.live || captured.completed !== captured.expected || !captured.fingerprints) throw new Error('A complete captured live benchmark is required.');
  const files = ['../src/services/ask-posnic-retrieval.js', '../src/services/ask-posnic-grounding.service.js', '../tests/fixtures/ask-posnic-answer-cases.json'];
  const fingerprints = Object.fromEntries(files.map((file) => [path.basename(file), hash(fs.readFileSync(path.resolve(__dirname, file)))]));
  for (const name of ['ask-posnic-retrieval.js', 'ask-posnic-answer-cases.json']) if (fingerprints[name] !== captured.fingerprints[name]) throw new Error('Retrieval or fixture changed; a new retrieval run is required.');
  const results = [];
  for (const row of captured.results) {
    let offset = 0, generated = row.generated;
    if (row.trace?.length) generated = await grounding.answer(row.question, row.matches, { response_language: 'en' }, {}, { ask: async (request) => {
      const original = row.trace[offset++];
      if (!original || original.feature !== request.feature) throw new Error(`Unrecorded provider request for ${row.id}; replay stopped.`);
      return { status: original.status, data: { text: original.text } };
    } });
    results.push({ id: row.id, unsupported: !!row.unsupported, before: row.generated, after: generated });
  }
  const report = { scope: 'Offline replay of previously captured public model responses through current validation. No new model call; not an independent answer-correctness score.', live: false, fingerprints, captured_fingerprints: captured.fingerprints, captured_sha256: hash(raw), completed: results.length, generated_answer_count: results.filter((row) => !row.unsupported && row.after?.mode === 'rag').length, unsupported_generated_claims: results.filter((row) => row.unsupported && row.after?.mode === 'rag').map((row) => row.id), changed: results.filter((row) => JSON.stringify(row.before) !== JSON.stringify(row.after)).map((row) => row.id), results };
  const output = path.resolve(__dirname, '../../output/ask-posnic-answers-replay.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const { results: ignored, ...summary } = report; console.log(JSON.stringify(summary));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
