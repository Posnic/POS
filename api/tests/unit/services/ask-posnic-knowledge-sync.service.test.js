'use strict';
jest.mock('../../../src/services/ask-posnic-platform.service', () => ({
  scope: () => ({ license: 'test-shop' }),
  importBundle: jest.fn(async (_req, bundle) => ({ imported: bundle.documents.length })),
}));
const platform = require('../../../src/services/ask-posnic-platform.service');
const { sync } = require('../../../src/services/ask-posnic-knowledge-sync.service');
const bundle = {
  schema: 'posnic.ask-knowledge.v1',
  source: 'posnic-intranet',
  snapshot: true,
  documents: [],
};
beforeEach(() => {
  process.env.ASK_POSNIC_KNOWLEDGE_URL =
    'https://intranet.example.test/api/ask-posnic/published-bundle';
  process.env.ASK_POSNIC_KNOWLEDGE_TOKEN = 'test-token';
  jest.clearAllMocks();
});
afterAll(() => {
  delete process.env.ASK_POSNIC_KNOWLEDGE_URL;
  delete process.env.ASK_POSNIC_KNOWLEDGE_TOKEN;
});

test('downloads only the configured snapshot and coalesces concurrent requests', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify(bundle)));
  await Promise.all([sync({}, { force: true, fetcher }), sync({}, { force: true, fetcher })]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    headers: { authorization: 'Bearer test-token' },
    redirect: 'error',
  });
  expect(platform.importBundle).toHaveBeenCalledTimes(1);
});

test('failed or unauthoritative responses cannot change existing knowledge', async () => {
  await expect(
    sync({}, { force: true, fetcher: async () => new Response('{}', { status: 403 }) })
  ).rejects.toThrow('could not be fetched');
  await expect(
    sync({}, { force: true, fetcher: async () => new Response('{"documents":[]}') })
  ).rejects.toThrow('authoritative');
  expect(platform.importBundle).not.toHaveBeenCalled();
});

test('refuses insecure distribution and oversized responses', async () => {
  process.env.ASK_POSNIC_KNOWLEDGE_URL = 'http://intranet.example.test';
  await expect(sync({}, { force: true })).rejects.toThrow('HTTPS');
  process.env.ASK_POSNIC_KNOWLEDGE_URL = 'https://intranet.example.test';
  await expect(
    sync(
      {},
      {
        force: true,
        fetcher: async () =>
          new Response('{}', { headers: { 'content-length': String(13 * 1024 * 1024) } }),
      }
    )
  ).rejects.toThrow('too large');
});
