'use strict';

// One synthetic document and a paraphrase, never customer data. The unique
// vector is removed even on a failed assertion. Requires an explicitly set
// vector bucket/index/namespace and an authorized AWS profile.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const provider = require('../src/services/bedrock-provider');
const store = require('../src/services/ask-posnic-vector-store');

async function main() {
  const scope = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
  const key = crypto.createHash('sha256').update(scope + ':probe').digest('hex');
  let put = false;
  try {
    const source = await provider.embed('To export the item catalog, open Items, choose Export, and download the CSV file.');
    const question = await provider.embed('How can I get a spreadsheet containing my product list?');
    await store.put(key, source.vector, { scope, document_id: 'synthetic-probe', generation: 'synthetic-v1', chunk: 0 });
    put = true;
    const rows = await store.query(question.vector, scope);
    console.log(JSON.stringify({ query_matches: rows.length, distances: rows.map((row) => row.distance) }));
    assert.equal(rows[0]?.key, key);
    assert.ok(rows[0].distance < 0.6, 'Paraphrase exceeded the initial retrieval threshold');
    const unrelatedDistances = [];
    for (const text of ['Does Posnic control satellite weather radar automatically?', 'How can I make kitchen orders print automatically?', 'Does Posnic perform cryptocurrency staking using register float?']) {
      const unrelated = await provider.embed(text);
      const matches = await store.query(unrelated.vector, scope);
      unrelatedDistances.push(matches[0]?.distance);
      assert.ok(matches[0]?.distance > 0.6, 'An unrelated question passed the retrieval cutoff');
    }
    assert.equal((await store.query(question.vector, crypto.createHash('sha256').update('another-scope:' + scope).digest('hex'))).length, 0);
    console.log(JSON.stringify({ result: 'PASS', model: provider.EMBEDDING_MODEL, dimensions: source.vector.length, source_and_positive_query_tokens: source.tokensIn + question.tokensIn, distance: rows[0].distance, unrelated_distances: unrelatedDistances, scope_isolation: true }));
  } finally { if (put) await store.remove([key]); }
}
main().catch((error) => { console.error('Semantic probe failed:', error.name, error.code || '', error.name === 'AssertionError' ? error.message : ''); process.exitCode = 1; });
