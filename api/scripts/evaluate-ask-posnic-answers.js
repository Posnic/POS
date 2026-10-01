'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const corpus = require('../tests/fixtures/ask-posnic-knowledge-sources.json');
const dataset = require('../tests/fixtures/ask-posnic-answer-cases.json');
const { rank, excerptAnswer, privateCredentialQuestion } = require('../src/services/ask-posnic-retrieval');
const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

function retrievalCases() {
  for (const source of corpus.documents) if (crypto.createHash('sha256').update(source.content).digest('hex') !== source.sha256) throw new Error('Corpus integrity failed.');
  return dataset.cases.map((test) => {
    const acceptable = test.unsupported ? [] : [{ source: test.source, evidence: test.evidence }, ...(test.alternatives || [])];
    for (const item of acceptable) {
      const source = corpus.documents.find((row) => row._id === item.source);
      if (!source || !normalize(source.content).includes(normalize(item.evidence)) || test.source_sha256 && source._id === test.source && source.sha256 !== test.source_sha256) throw new Error(`Expected evidence changed: ${test.id}`);
    }
    const matches = rank(corpus.documents, test.question);
    return { ...test, acceptable, matches, evidence_recalled: test.unsupported ? null : matches.some((row) => acceptable.some((item) => row.document_id === item.source && normalize(row.text).includes(normalize(item.evidence)))), context_evidence_recalled: test.unsupported ? null : matches.some((row) => acceptable.some((item) => row.document_id === item.source && normalize(row.context || row.text).includes(normalize(item.evidence)))) };
  });
}

async function main() {
  const live = process.argv.includes('--live');
  const conditions = process.argv.includes('--conditions');
  const offered = process.argv.indexOf('--limit');
  const limit = offered >= 0 ? Number(process.argv[offered + 1]) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100.');
  const tests = (conditions ? require('../tests/fixtures/ask-posnic-condition-cases.json').cases : retrievalCases()).slice(0, limit), results = [];
  const fingerprints = Object.fromEntries(['../src/services/ask-posnic-retrieval.js', '../src/services/ask-posnic-grounding.service.js', `../tests/fixtures/ask-posnic-${conditions ? 'condition' : 'answer'}-cases.json`].map((file) => [path.basename(file), crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, file))).digest('hex')]));
  const output = path.resolve(__dirname, `../../output/ask-posnic-${conditions ? 'conditions' : 'answers'}-${live ? 'live' : 'offline'}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let memory, mongoose, db, grounding, context;
  const report = () => {
    const supported = results.filter((row) => !row.unsupported), unsupported = results.filter((row) => row.unsupported);
    return {
      scope: conditions ? 'Fixed candidate answers with real provider verification; controlled modality probes and recorded public-manual regression. Not customer answer accuracy.' : '100-case source-grounded development benchmark against the lexical manual retrieval path. Model checks are not an independent human correctness score; semantic retrieval and multilingual acceptance require separate assessment.',
      ...(conditions ? { incorrect_verdicts: results.filter((row) => (row.generated?.mode === 'rag') !== row.expected_accept).map((row) => row.id), unsafe_acceptances: results.filter((row) => !row.expected_accept && row.generated?.mode === 'rag').map((row) => row.id) } : {}),
      live, fingerprints, model: live ? 'global.amazon.nova-2-lite-v1:0' : null, completed: results.length, expected: tests.length,
      supported: supported.length, unsupported: unsupported.length,
      expected_evidence_recall: !conditions && supported.length ? supported.filter((row) => row.evidence_recalled).length / supported.length : null,
      expected_context_recall: !conditions && supported.length ? supported.filter((row) => row.context_evidence_recalled).length / supported.length : null,
      generated_answer_count: supported.filter((row) => row.generated?.mode === 'rag').length,
      unsupported_generated_claims: unsupported.filter((row) => row.generated?.mode === 'rag').map((row) => row.id),
      requires_independent_review: live, results,
    };
  };
  const save = () => fs.writeFileSync(output, JSON.stringify(report(), null, 2) + '\n');
  try {
    if (live) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memory = await MongoMemoryServer.create();
      process.env.MONGODB_URI = memory.getUri('ask_posnic_answer_evaluation');
      process.env.NODE_ENV = 'test'; process.env.POSNIC_MANAGED_AI_PROVIDER = 'bedrock';
      process.env.POSNIC_MANAGED_AI_MODEL = 'global.amazon.nova-2-lite-v1:0';
      process.env.POSNIC_MANAGED_AI_KEY = ''; process.env.POSNIC_MANAGED_AI_MONTHLY_CAP = '2';
      delete process.env.ASK_POSNIC_BILLING_URL; delete process.env.ASK_POSNIC_BILLING_TOKEN;
      mongoose = require('mongoose'); await mongoose.connect(process.env.MONGODB_URI);
      db = mongoose.connection.db;
      const BaseModel = require('../src/models/base.model'), { ObjectId } = require('mongodb');
      BaseModel.mongoClient = mongoose.connection.getClient(); BaseModel.database = db;
      const license = new ObjectId(), branch = new ObjectId();
      context = { licenseId: String(license), branchId: String(branch) };
      await db.collection('branches').insertOne({ _id: branch, license, currency: 'USD' });
      grounding = require('../src/services/ask-posnic-grounding.service');
    }
    let unavailable = 0;
    for (const test of tests) {
      const started = performance.now();
      const trace = [];
      let generated = null;
      if (live && test.matches.length && !privateCredentialQuestion(test.question)) generated = await grounding.answer(test.question, test.matches, { response_language: 'en' }, context, { ask: async (input, scope) => {
        if (conditions && input.feature === 'ask_posnic_help') return { status: true, data: { text: JSON.stringify(test.draft) } };
        const response = await require('../src/services/ai.service').ask(input, scope);
        trace.push({ feature: input.feature, status: response.status, text: response.data?.text || null });
        return response;
      } });
      unavailable = generated?.reason === 'generation_unavailable' ? unavailable + 1 : 0;
      const result = { ...test, generated, ...(live ? { trace } : {}), fallback: excerptAnswer(test.matches), elapsed_ms: Math.round(performance.now() - started) };
      results.push(result); save();
      if (results.length % 5 === 0 || results.length === tests.length) console.log(JSON.stringify({ completed: results.length, total: tests.length, last: test.id, outcome: generated?.reason || (live ? 'no_eligible_source' : 'offline_retrieval') }));
      if (unavailable >= 3) throw new Error('Three provider/allowance failures; evaluation stopped without retrying paid requests.');
    }
    if (live) {
      const account = await db.collection('managed_ai_credits').findOne({ license: context.licenseId });
      const pricing = { currency: account?.currency, used_minor: account?.used_minor || 0, used_microminor: account?.used_microminor || 0, reserved_minor: account?.reserved_minor || 0, calls: await db.collection('managed_ai_reservations').countDocuments({ status: 'reconciled' }) };
      const final = report(); final.cost = pricing; fs.writeFileSync(output, JSON.stringify(final, null, 2) + '\n');
      console.log(JSON.stringify({ cost: pricing }));
    }
    const { results: ignored, ...summary } = report(); console.log(JSON.stringify({ ...summary, output }));
  } finally { if (mongoose) await mongoose.disconnect(); if (memory) await memory.stop(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { retrievalCases };
