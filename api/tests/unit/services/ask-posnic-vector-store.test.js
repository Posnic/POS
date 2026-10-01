'use strict';
const store = require('../../../src/services/ask-posnic-vector-store');
const semantic = require('../../../src/services/ask-posnic-semantic.service');
const saved = { ...process.env };
beforeEach(() => { process.env.ASK_POSNIC_VECTOR_BUCKET = 'test-bucket'; process.env.ASK_POSNIC_VECTOR_INDEX = 'test-index'; process.env.ASK_POSNIC_VECTOR_NAMESPACE = 'test-installation'; });
afterAll(() => { process.env = saved; });
test('S3 search always sends a scoped metadata filter and requests distances', async () => {
  const client = { send: jest.fn(async () => ({ vectors: [] })) };
  await store.query(Array(256).fill(0.0625), 'a'.repeat(64), client);
  expect(client.send.mock.calls[0][0].input).toMatchObject({ vectorBucketName: 'test-bucket', indexName: 'test-index', filter: { scope: { $eq: 'a'.repeat(64) } }, returnDistance: true, returnMetadata: true, topK: 10 });
  await expect(store.query(Array(256).fill(0), 'a'.repeat(64), client)).rejects.toThrow('Invalid');
  await expect(store.query(Array(256).fill(1), '', client)).rejects.toThrow('Invalid');
  expect(client.send).toHaveBeenCalledTimes(1);
});
test('semantic scopes isolate installations, databases and licenses', () => {
  const a = semantic.scopeHash({ databaseName: 'tenant-a' }, 'license');
  expect(semantic.scopeHash({ databaseName: 'tenant-b' }, 'license')).not.toBe(a);
  expect(semantic.scopeHash({ databaseName: 'tenant-a' }, 'other')).not.toBe(a);
  process.env.ASK_POSNIC_VECTOR_NAMESPACE = 'another-installation';
  expect(semantic.scopeHash({ databaseName: 'tenant-a' }, 'license')).not.toBe(a);
});
test('hybrid ranks shared evidence first, deduplicates chunks and preserves exact FAQ bypass', () => {
  const first = { document_id: 'a', chunk: 0, text: 'Keyword evidence' }, shared = { document_id: 'b', chunk: 1, text: 'Both paths' };
  expect(semantic.merge([first, shared], [shared])).toEqual([expect.objectContaining(shared), expect.objectContaining(first)]);
  expect(semantic.merge([{ ...first, exact: true }], [shared])).toHaveLength(1);
});
