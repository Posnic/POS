'use strict';
jest.mock('../../../src/services/ai.service', () => ({ settingsFor: jest.fn(async () => ({ enabled: true, provider: 'bedrock' })), modeFor: jest.fn(() => 'managed') }));
jest.mock('../../../src/services/managed-ai-credits.service', () => ({ reserve: jest.fn(async () => ({ ok: true, id: 'hold' })), reconcile: jest.fn(async () => {}), release: jest.fn(async () => {}), markUncertain: jest.fn(async () => {}) }));
jest.mock('../../../src/services/ai-budget', () => ({ record: jest.fn(async () => {}) }));
jest.mock('../../../src/services/bedrock-provider', () => ({ EMBEDDING_MODEL: 'amazon.titan-embed-text-v2:0', embed: jest.fn(async () => ({ vector: [0.1], tokensIn: 8, tokensOut: 0, model: 'amazon.titan-embed-text-v2:0' })) }));
const service = require('../../../src/services/ask-posnic-embedding.service');
const credits = require('../../../src/services/managed-ai-credits.service');
const provider = require('../../../src/services/bedrock-provider');
beforeEach(() => jest.clearAllMocks());
test('embedding reserves before inference, with zero output tokens, then settles actual input usage', async () => {
  const result = await service.embed('தமிழ்', { licenseId: 'shop', branchId: 'outlet' });
  expect(result.status).toBe(true);
  expect(credits.reserve.mock.calls[0][1]).toMatchObject({ promptChars: Buffer.byteLength('தமிழ்') * 3, maxOutputTokens: 0 });
  expect(credits.reserve.mock.invocationCallOrder[0]).toBeLessThan(provider.embed.mock.invocationCallOrder[0]);
  expect(credits.reconcile).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ tokensIn: 8, tokensOut: 0 }));
});
test('an exhausted allowance performs no network request', async () => {
  credits.reserve.mockResolvedValueOnce({ ok: false, message: 'Exhausted' });
  expect((await service.embed('Question', { licenseId: 'shop' })).status).toBe(false);
  expect(provider.embed).not.toHaveBeenCalled();
});
test('timeouts retain holds while definite provider rejections release them', async () => {
  provider.embed.mockRejectedValueOnce(Object.assign(new Error('sensitive request'), { name: 'TimeoutError' }));
  expect(await service.embed('Question', { licenseId: 'shop' })).toMatchObject({ status: false, uncertain: true });
  expect(credits.markUncertain).toHaveBeenCalledTimes(1);
  provider.embed.mockRejectedValueOnce(Object.assign(new Error('sensitive credential'), { name: 'AccessDeniedException' }));
  const rejected = await service.embed('Question', { licenseId: 'shop' });
  expect(rejected).toMatchObject({ status: false, uncertain: false });
  expect(JSON.stringify(rejected)).not.toContain('sensitive');
  expect(credits.release).toHaveBeenCalledTimes(1);
});
