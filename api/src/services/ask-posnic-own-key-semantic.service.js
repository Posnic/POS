'use strict';

const crypto = require('node:crypto');
const { chunks, contextForChunk, privateCredentialQuestion } = require('./ask-posnic-retrieval');
const embeddings = require('./ask-posnic-own-key-embedding.service');
const vectorCollection = 'ask_posnic_local_vectors';
const CAPACITY = 5000;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = (doc) => hash([embeddings.MODEL, embeddings.DIMENSIONS, doc.title, String(doc.revision || doc.version || 1), doc.chunks || chunks(doc.content)]);
const chunkKey = (license, title, text) => hash([String(license), embeddings.MODEL, embeddings.DIMENSIONS, title, text]);
const published = (license) => ({ license: String(license), status: 'published', visibility: 'customer' });

async function eligible(db, context, dependencies = {}) {
  const preferences = await db.collection('ask_posnic_preferences').findOne({ license: String(context.licenseId) });
  if (preferences?.own_key_semantic !== true || preferences.help_enabled === false) return null;
  const ai = require('./ai.service');
  const settings = await (dependencies.settingsFor || ai.settingsFor)(context);
  return settings.enabled && settings.provider === 'openai' && ai.modeFor(settings) === 'own_key' ? preferences : null;
}

async function withinCapacity(db, license) {
  const rows = await db.collection('ask_posnic_documents').aggregate([
    { $match: published(license) }, { $project: { size: { $cond: [{ $isArray: '$chunks' }, { $size: '$chunks' }, { $ceil: { $divide: [{ $strLenBytes: { $ifNull: ['$content', ''] } }, 1000] } }] } } },
    { $group: { _id: null, count: { $sum: '$size' } } },
  ]).toArray();
  return (rows[0]?.count || 0) <= CAPACITY;
}

async function cachedVector(db, doc, text, context, preferences, dependencies) {
  const vectors = db.collection(vectorCollection), id = chunkKey(doc.license, doc.title, text);
  const saved = await vectors.findOne({ _id: id, license: doc.license });
  if (saved?.state === 'ready' && embeddings.validVector(saved.vector)) {
    const touched = await vectors.updateOne({ _id: id, state: 'ready' }, { $set: { updated_at: new Date() } });
    if (touched.matchedCount !== 1) throw new Error('Cached embedding expired during indexing.');
    return id;
  }
  if (saved && saved.state !== 'retry') throw Object.assign(new Error('An earlier embedding is pending or needs review.'), { uncertain: saved.state !== 'processing' });
  const claim = crypto.randomUUID();
  try {
    const row = await vectors.findOneAndUpdate({ _id: id, state: 'retry' }, { $set: { license: doc.license, state: 'processing', claim, operation_id: context.operationId, execution_owner: require('./ask-posnic-execution-owner').current(), updated_at: new Date() } }, { upsert: true, returnDocument: 'after' });
    if (!row) throw new Error('Embedding claim unavailable.');
  } catch (error) {
    if (error.code === 11000) throw new Error('Embedding already claimed.', { cause: error });
    throw error;
  }
  try {
    const vector = await (dependencies.embed || embeddings.embed)(db, `${doc.title}\n\n${text}`, context, preferences, dependencies);
    if (!embeddings.validVector(vector)) throw Object.assign(new Error('Invalid embedding.'), { uncertain: true });
    const result = await vectors.updateOne({ _id: id, claim, state: 'processing' }, { $set: { state: 'ready', vector, updated_at: new Date() }, $unset: { claim: '' } });
    if (result.matchedCount !== 1) throw Object.assign(new Error('Embedding claim changed.'), { uncertain: true });
    return id;
  } catch (error) {
    await vectors.updateOne({ _id: id, claim }, { $set: { state: error.uncertain ? 'needs_review' : 'retry', updated_at: new Date() }, $unset: { claim: '' } });
    throw error;
  }
}

async function indexBatch(db, dependencies = {}) {
  db = db || await require('../models/base.model').getDb();
  const documents = db.collection('ask_posnic_documents');
  // Iterate enabled shops so an unconfigured shop cannot monopolize the worker.
  const preferences = db.collection('ask_posnic_preferences').find({ own_key_semantic: true, help_enabled: { $ne: false } }).sort({ own_key_index_checked_at: 1 }).limit(20);
  for await (const pref of preferences) {
    await db.collection('ask_posnic_preferences').updateOne({ _id: pref._id }, { $set: { own_key_index_checked_at: new Date() } });
    const doc = await documents.findOne({ ...published(pref.license), 'own_semantic.state': { $nin: ['processing', 'needs_review'] },
      $and: [{ $or: [{ 'own_semantic.state': { $ne: 'ready' } }, { $expr: { $ne: ['$own_semantic.generation', '$own_semantic_source_hash'] } }] },
        { $or: [{ 'own_semantic.retry_at': { $exists: false } }, { 'own_semantic.retry_at': { $lte: new Date() } }] }],
    }, { sort: { updated_at: 1, _id: 1 } });
    if (!doc) continue;
    const context = { licenseId: doc.license, branchId: doc.branch_id };
    const settings = await eligible(db, context, dependencies);
    if (!settings) continue;
    const generation = sourceHash(doc), claim = crypto.randomUUID();
    context.operationId = claim;
    const filter = { _id: doc._id, ...published(doc.license), 'own_semantic.claim': claim };
    const claimed = await documents.updateOne({ _id: doc._id, 'own_semantic.state': { $nin: ['processing', 'needs_review'] } }, { $set: { 'own_semantic.state': 'processing', 'own_semantic.claim': claim, 'own_semantic.operation': claim, 'own_semantic.execution_owner': require('./ask-posnic-execution-owner').current(), 'own_semantic.started_at': new Date() } });
    if (!claimed.modifiedCount) continue;
    try {
      if (!await withinCapacity(db, doc.license)) throw new Error('Local semantic capacity reached.');
      const passages = doc.chunks || chunks(doc.content);
      const same = doc.own_semantic?.generation === generation;
      let next = same ? Number(doc.own_semantic.next || 0) : 0;
      const keys = same ? (doc.own_semantic.keys || []) : [];
      await documents.updateOne(filter, { $set: { own_semantic_source_hash: generation, 'own_semantic.generation': generation, 'own_semantic.next': next, 'own_semantic.keys': keys } });
      const end = Math.min(next + 8, passages.length);
      for (; next < end; next++) {
        const fresh = await documents.findOne(filter);
        if (!fresh || sourceHash(fresh) !== generation || !await eligible(db, context, dependencies)) throw new Error('Source or settings changed.');
        keys[next] = await cachedVector(db, doc, passages[next], context, settings, dependencies);
        await documents.updateOne(filter, { $set: { 'own_semantic.next': next + 1, 'own_semantic.keys': keys } });
      }
      const fresh = await documents.findOne(filter);
      if (!fresh || sourceHash(fresh) !== generation) throw new Error('Source changed.');
      const state = next === passages.length ? 'ready' : 'pending';
      await documents.updateOne(filter, { $set: { 'own_semantic.state': state }, $unset: { 'own_semantic.claim': '', 'own_semantic.retry_at': '' } });
      return { state, chunks: next };
    } catch (error) {
      const state = error.uncertain ? 'needs_review' : 'pending';
      await documents.updateOne({ _id: doc._id, 'own_semantic.claim': claim }, { $set: { 'own_semantic.state': state, 'own_semantic.retry_at': new Date(Date.now() + 15 * 60000) }, $unset: { 'own_semantic.claim': '' } });
      return { state };
    }
  }
  // Remove bounded batches of unreferenced completed vectors after a grace
  // period. Pending/unknown calls are evidence and are never automatically lost.
  const stale = db.collection(vectorCollection).find({ state: 'ready', updated_at: { $lt: new Date(Date.now() - 7 * 86400000) } }, { projection: { _id: 1, license: 1, updated_at: 1 } }).limit(100);
  for await (const vector of stale) {
    const filter = { _id: vector._id, state: 'ready', updated_at: vector.updated_at };
    if (!await documents.findOne({ ...published(vector.license), 'own_semantic.keys': vector._id }, { projection: { _id: 1 } })) await db.collection(vectorCollection).deleteOne(filter);
    else await db.collection(vectorCollection).updateOne(filter, { $set: { updated_at: new Date() } });
  }
  return { state: 'idle' };
}

function distance(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return Math.max(0, Math.min(2, 1 - dot / Math.sqrt(aa * bb)));
}

async function retrieve(db, license, question, context, dependencies = {}) {
  if (!license || String(context?.licenseId) !== String(license)) throw new Error('Knowledge query scope does not match its shop.');
  if (privateCredentialQuestion(question)) return [];
  const preferences = await eligible(db, context, dependencies);
  if (!preferences || !await withinCapacity(db, license)) return [];
  const documents = db.collection('ask_posnic_documents');
  const filter = { ...published(license), 'own_semantic.state': 'ready' };
  if (!await documents.findOne(filter, { projection: { _id: 1 } })) return [];
  const query = await (dependencies.embed || embeddings.embed)(db, question, context, preferences, dependencies);
  if (!embeddings.validVector(query)) return [];
  const best = [];
  let scanned = 0;
  // Cursor/batches bound memory. The 5000 published-passage ceiling bounds CPU;
  // above it the caller retains keyword retrieval without a paid query call.
  for await (const doc of documents.find(filter).batchSize(10)) {
    if (sourceHash(doc) !== doc.own_semantic.generation) continue;
    const texts = doc.chunks || chunks(doc.content);
    scanned += texts.length;
    if (scanned > CAPACITY) return [];
    const rows = await db.collection(vectorCollection).find({ license: String(license), state: 'ready', _id: { $in: doc.own_semantic.keys || [] } }).toArray();
    const byId = new Map(rows.map((row) => [row._id, row.vector]));
    texts.forEach((text, index) => {
      const vector = byId.get(chunkKey(license, doc.title, text));
      if (!embeddings.validVector(vector)) return;
      const score = distance(query, vector);
      if (score > 0.6) return;
      best.push({ document_id: String(doc._id), revision: String(doc.revision || doc.version || 1), title: doc.title, chunk: index, text, semantic_distance: score, generation: doc.own_semantic.generation });
      best.sort((a, b) => a.semantic_distance - b.semantic_distance || a.document_id.localeCompare(b.document_id) || a.chunk - b.chunk);
      if (best.length > 10) best.pop();
    });
  }
  // Publication can be revoked during a scan: recheck each returned passage.
  const matches = [];
  const { ObjectId } = require('mongodb');
  for (const match of best) {
    const fresh = await documents.findOne({ ...filter, _id: new ObjectId(match.document_id), 'own_semantic.generation': match.generation });
    if (fresh && sourceHash(fresh) === match.generation) { delete match.generation; matches.push({ ...match, context: contextForChunk(fresh, match.chunk) }); }
  }
  return matches;
}

module.exports = { indexBatch, retrieve, sourceHash, chunkKey, distance, withinCapacity, CAPACITY, vectorCollection };
