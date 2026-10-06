'use strict';

const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const store = require('./ask-posnic-vector-store');
const embeddings = require('./ask-posnic-embedding.service');
const { chunks, contextForChunk } = require('./ask-posnic-retrieval');
const pageMap = require('./knowledge-page-map');
const { EMBEDDING_MODEL } = require('./bedrock-provider');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sourceHash = (doc) =>
  hash(
    JSON.stringify([
      doc.title,
      String(doc.revision || doc.version || 1),
      doc.chunks || chunks(doc.content),
      EMBEDDING_MODEL,
    ])
  );
const indexHash = () => hash(JSON.stringify(store.configuration()));
function scopeHash(db, license) {
  const config = store.configuration();
  if (!config || !db?.databaseName || !license)
    throw new Error('An authenticated database and shop are required for semantic search.');
  return hash(JSON.stringify([config.namespace, db.databaseName, String(license)]));
}
const vectorKey = (scope, document, generation, chunk) =>
  hash(JSON.stringify([scope, String(document), generation, chunk]));

// One source and at most eight embedding calls per worker tick. Each completed
// chunk is checkpointed. Ambiguous paid calls/process crashes require review;
// elapsed time alone never authorizes another paid attempt.
async function indexBatch(db, dependencies = {}) {
  if (!store.configuration()) return { state: 'disabled' };
  db = db || (await require('../models/base.model').getDb());
  const embed = dependencies.embed || embeddings.embed,
    vectors = dependencies.store || store;
  const documents = db.collection('ask_posnic_documents');
  const retired = await documents.findOne({
    'semantic.state': { $ne: 'processing' },
    $and: [
      {
        $or: [
          { 'semantic.keys.0': { $exists: true } },
          { 'semantic.previous.0': { $exists: true } },
        ],
      },
      { $or: [{ status: { $ne: 'published' } }, { visibility: { $ne: 'customer' } }] },
    ],
  });
  const replacement = retired?.central_id
    ? await documents.findOne({
        license: retired.license,
        central_id: retired.central_id,
        _id: { $ne: retired._id },
        status: 'published',
        visibility: 'customer',
        'semantic.state': { $ne: 'ready' },
      })
    : null;
  if (retired && !replacement) {
    const retiredKeys = [
      ...new Set([
        ...(retired.semantic.keys || []),
        ...(retired.semantic.previous || []).map((entry) => entry.key),
      ]),
    ];
    for (let start = 0; start < retiredKeys.length; start += 500)
      await vectors.remove(retiredKeys.slice(start, start + 500));
    await documents.updateOne(
      {
        _id: retired._id,
        'semantic.generation': retired.semantic.generation,
        'semantic.state': { $ne: 'processing' },
      },
      {
        $set: {
          'semantic.state': 'retired',
          'semantic.keys': [],
          'semantic.previous': [],
          'semantic.next': 0,
        },
      }
    );
    return { state: 'retired', document_id: String(retired._id) };
  }
  const configHash = indexHash();
  const operation = crypto.randomUUID();
  const doc = await documents.findOneAndUpdate(
    {
      status: 'published',
      visibility: 'customer',
      'semantic.state': { $nin: ['processing', 'needs_review'] },
      $or: [
        { 'semantic.state': { $ne: 'ready' } },
        { 'semantic.index': { $ne: configHash } },
        { $expr: { $ne: ['$semantic.generation', '$semantic_source_hash'] } },
      ],
      $and: [
        {
          $or: [
            { 'semantic.retry_at': { $exists: false } },
            { 'semantic.retry_at': { $lte: new Date() } },
          ],
        },
      ],
    },
    {
      $set: {
        'semantic.state': 'processing',
        'semantic.claim': operation,
        'semantic.operation': operation,
        'semantic.execution_owner': require('./ask-posnic-execution-owner').current(),
        'semantic.started_at': new Date(),
      },
    },
    { sort: { updated_at: 1, _id: 1 }, returnDocument: 'after' }
  );
  if (!doc) return { state: 'idle' };
  const claim = { _id: doc._id, license: doc.license, 'semantic.claim': doc.semantic.claim };
  const generation = sourceHash(doc),
    scope = scopeHash(db, doc.license);
  const passages = doc.chunks || chunks(doc.content);
  const current = doc.semantic.generation === generation && doc.semantic.index === configHash;
  let next = current ? Number(doc.semantic.next || 0) : 0;
  let keys = current ? doc.semantic.keys || [] : [];
  const chunkHashes = passages.map((text) => hash(`${EMBEDDING_MODEL}\n${doc.title}\n\n${text}`));
  let previous = current
    ? doc.semantic.previous || []
    : [
        ...(doc.semantic.previous || []),
        ...(doc.semantic.keys || []).map((key, index) => ({
          key,
          hash: doc.semantic.chunk_hashes?.[index] || '',
        })),
      ];
  try {
    // Intranet revisions have new immutable document IDs. Reuse embeddings from
    // the same licensed series before its retired generation is cleaned up.
    if (!current && !previous.length && doc.central_id) {
      const prior = await documents.findOne(
        {
          license: doc.license,
          central_id: doc.central_id,
          _id: { $ne: doc._id },
          'semantic.index': configHash,
          'semantic.state': 'ready',
          'semantic.keys.0': { $exists: true },
        },
        { sort: { updated_at: -1 } }
      );
      if (prior)
        previous = prior.semantic.keys.map((key, index) => ({
          key,
          hash: prior.semantic.chunk_hashes?.[index] || '',
        }));
    }
    const context = { licenseId: doc.license, branchId: doc.branch_id, operationId: operation };
    const ai = require('./ai.service');
    if (!dependencies.embed) {
      const preferences = await db
        .collection('ask_posnic_preferences')
        .findOne({ license: String(doc.license) });
      if (preferences?.help_enabled === false) throw new Error('Ask Posnic help is disabled.');
      const settings = await ai.settingsFor(context);
      if (
        !settings.enabled ||
        !settings.askPosnicEnabled ||
        ai.modeFor(settings) !== 'managed' ||
        settings.provider !== 'bedrock'
      )
        throw new Error('Semantic indexing is disabled for this shop.');
    }
    // A stale generation may remain stored temporarily but cannot be returned:
    // every query rechecks its generation and publication against MongoDB.
    await documents.updateOne(claim, {
      $set: {
        semantic_source_hash: generation,
        'semantic.generation': generation,
        'semantic.index': configHash,
        'semantic.next': next,
        'semantic.keys': keys,
        'semantic.chunk_hashes': chunkHashes,
        'semantic.previous': previous,
      },
    });
    const end = Math.min(passages.length, next + 8);
    for (; next < end; next++) {
      const fresh = await documents.findOne({
        ...claim,
        status: 'published',
        visibility: 'customer',
      });
      if (!fresh || sourceHash(fresh) !== generation)
        throw new Error('Source publication changed.');
      const key = vectorKey(scope, doc._id, generation, next);
      const existing = await vectors.exists([key]);
      if (!existing.length) {
        const reusable = previous.find((entry) => entry.hash === chunkHashes[next]);
        const saved = reusable ? (await vectors.exists([reusable.key], undefined, true))[0] : null;
        let vector =
          saved?.metadata?.scope === scope && store.validVector(saved?.data?.float32)
            ? saved.data.float32
            : null;
        if (!vector) {
          const result = await embed(
            `${doc.title}\n\n${passages[next]}`,
            context,
            'ask_posnic_document_embedding'
          );
          if (!result.status)
            throw Object.assign(new Error(result.message), { uncertain: result.uncertain });
          vector = result.data.vector;
        }
        await vectors.put(key, vector, {
          scope,
          document_id: String(doc._id),
          generation,
          chunk: next,
        });
      }
      keys = [...new Set([...keys, key])];
      await documents.updateOne(claim, {
        $set: { 'semantic.next': next + 1, 'semantic.keys': keys },
      });
    }
    const state = next >= passages.length ? 'ready' : 'pending';
    const published = await documents.findOne({
      ...claim,
      status: 'published',
      visibility: 'customer',
    });
    if (!published || sourceHash(published) !== generation)
      throw new Error('Source publication changed.');
    if (state === 'ready' && previous.length) {
      const obsolete = [...new Set(previous.map((entry) => entry.key))].filter(
        (key) => !keys.includes(key)
      );
      for (let start = 0; start < obsolete.length; start += 500)
        await vectors.remove(obsolete.slice(start, start + 500));
      await documents.updateOne(claim, { $set: { 'semantic.previous': [] } });
    }
    await documents.updateOne(claim, {
      $set: { 'semantic.state': state, 'semantic.updated_at': new Date() },
      $unset: { 'semantic.claim': '', 'semantic.retry_at': '' },
    });
    return { state, chunks: next, document_id: String(doc._id) };
  } catch (error) {
    dependencies.onError?.(error);
    const state = error.uncertain ? 'needs_review' : 'pending';
    await documents.updateOne(claim, {
      $set: {
        'semantic.state': state,
        'semantic.retry_at': new Date(Date.now() + 15 * 60000),
        'semantic.error': error.uncertain
          ? 'Embedding outcome requires review.'
          : 'Indexing could not finish; existing keyword help remains available.',
      },
      $unset: { 'semantic.claim': '' },
    });
    return { state, document_id: String(doc._id) };
  }
}

async function retrieve(db, license, question, context, dependencies = {}) {
  if (!store.configuration()) return [];
  if (String(context?.licenseId || '') !== String(license) || !license)
    throw new Error('Semantic query scope does not match its authenticated shop.');
  const vectors = dependencies.store || store,
    embed = dependencies.embed || embeddings.embed;
  const documents = db.collection('ask_posnic_documents');
  const filter = {
    license: String(license),
    status: 'published',
    visibility: 'customer',
    'semantic.state': 'ready',
    'semantic.index': indexHash(),
  };
  // No query charge while initial indexing is incomplete or nothing is eligible.
  if (!(await documents.findOne(filter, { projection: { _id: 1 } }))) return [];
  const result = await embed(question, context);
  if (!result.status) return [];
  const scope = scopeHash(db, license);
  const candidates = await vectors.query(result.data.vector, scope);
  const matches = [];
  for (const candidate of candidates) {
    const meta = candidate.metadata || {};
    // A distance is only a retrieval threshold, never an answer confidence.
    if (
      !Number.isFinite(candidate.distance) ||
      candidate.distance < 0 ||
      candidate.distance > 0.6 ||
      meta.scope !== scope ||
      !ObjectId.isValid(meta.document_id) ||
      !Number.isInteger(meta.chunk) ||
      meta.chunk < 0
    )
      continue;
    const doc = await documents.findOne({
      ...filter,
      _id: new ObjectId(meta.document_id),
      'semantic.generation': meta.generation,
    });
    if (
      !doc ||
      sourceHash(doc) !== meta.generation ||
      candidate.key !== vectorKey(scope, doc._id, meta.generation, meta.chunk)
    )
      continue;
    const text = (doc.chunks || chunks(doc.content))[meta.chunk];
    if (!text) continue;
    matches.push({
      document_id: String(doc._id),
      revision: String(doc.revision || doc.version || 1),
      title: doc.title,
      chunk: meta.chunk,
      text,
      context: contextForChunk(doc, meta.chunk),
      pages: pageMap.forChunk(doc, meta.chunk),
      semantic_distance: candidate.distance,
    });
  }
  return matches;
}

function merge(lexical, semantic, limit = 3) {
  if (lexical[0]?.exact) return lexical.slice(0, 1);
  const results = new Map();
  [lexical, semantic].forEach((list) =>
    list.forEach((match, index) => {
      const key = `${match.document_id}:${match.chunk}`;
      const prior = results.get(key);
      results.set(key, {
        ...(prior || match),
        hybrid_score: (prior?.hybrid_score || 0) + 1 / (60 + index + 1),
      });
    })
  );
  return [...results.values()]
    .sort(
      (a, b) =>
        b.hybrid_score - a.hybrid_score ||
        a.document_id.localeCompare(b.document_id) ||
        a.chunk - b.chunk
    )
    .slice(0, Math.max(1, Math.min(10, limit)));
}

function start({ tenants, everyMs = 60000 } = {}) {
  let running = false;
  const run = async (db) => {
    try {
      await require('./ask-posnic-own-key-semantic.service').indexBatch(db);
    } catch (_error) {
      console.warn('[ask-posnic] own-key semantic indexing unavailable');
    }
    return indexBatch(db);
  };
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (tenants) {
        const seen = new Set();
        for (const tenant of tenants()) {
          if (tenant.suspended || seen.has(tenant.tenantDb)) continue;
          seen.add(tenant.tenantDb);
          try {
            await require('../db/tenant-context').runWithTenant(tenant, () => run(tenant.db));
          } catch (_error) {
            console.warn('[ask-posnic] tenant semantic indexing unavailable');
          }
        }
      } else await run(await require('../models/base.model').getDb());
    } catch (_error) {
      console.warn('[ask-posnic] semantic indexing unavailable');
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  sourceHash,
  scopeHash,
  vectorKey,
  indexHash,
  indexBatch,
  retrieve,
  merge,
  start,
};
