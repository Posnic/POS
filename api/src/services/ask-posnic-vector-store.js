'use strict';

const { S3VectorsClient, PutVectorsCommand, QueryVectorsCommand, DeleteVectorsCommand, GetVectorsCommand } = require('@aws-sdk/client-s3vectors');
const { clientConfig, EMBEDDING_DIMENSIONS } = require('./bedrock-provider');

function configuration() {
  const bucket = process.env.ASK_POSNIC_VECTOR_BUCKET || '', index = process.env.ASK_POSNIC_VECTOR_INDEX || '', namespace = process.env.ASK_POSNIC_VECTOR_NAMESPACE || '';
  if (![bucket, index, namespace].every((value) => /^[a-z0-9][a-z0-9-]{2,62}$/.test(value))) return null;
  return { vectorBucketName: bucket, indexName: index, namespace };
}
function validVector(vector) {
  return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS && vector.every(Number.isFinite) && vector.some((value) => value !== 0);
}
async function send(Command, input, clientOverride) {
  const config = configuration();
  if (!config) throw new Error('Semantic index is not configured.');
  const client = clientOverride || new S3VectorsClient(clientConfig());
  try { return await client.send(new Command({ vectorBucketName: config.vectorBucketName, indexName: config.indexName, ...input }), { abortSignal: AbortSignal.timeout(15000) }); }
  finally { if (!clientOverride) client.destroy(); }
}
async function put(key, vector, metadata, client) {
  if (!validVector(vector) || !/^[a-f0-9]{64}$/.test(key) || !metadata?.scope || !metadata?.generation || !metadata?.document_id || !Number.isInteger(metadata.chunk) || metadata.chunk < 0) throw new Error('Invalid semantic vector.');
  return send(PutVectorsCommand, { vectors: [{ key, data: { float32: vector }, metadata }] }, client);
}
async function query(vector, scope, client) {
  if (!validVector(vector) || !/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid semantic query scope.');
  const response = await send(QueryVectorsCommand, { queryVector: { float32: vector }, topK: 10, filter: { scope: { $eq: scope } }, returnDistance: true, returnMetadata: true }, client);
  return response.vectors || [];
}
async function exists(keys, client, returnData = false) {
  if (!keys.length) return [];
  const response = await send(GetVectorsCommand, { keys, returnData, returnMetadata: true }, client);
  return response.vectors || [];
}
async function remove(keys, client) {
  if (!keys.length) return;
  if (keys.length > 500 || keys.some((key) => !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid semantic cleanup batch.');
  return send(DeleteVectorsCommand, { keys }, client);
}

module.exports = { configuration, validVector, put, query, exists, remove };
