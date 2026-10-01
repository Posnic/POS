'use strict';
const mockResolve = jest.fn();
jest.mock('../../../src/repositories/settings.repository', () => class { resolveGroup(...args) { return mockResolve(...args); } });
jest.mock('../../../src/services/ai-budget', () => ({ withinCap: jest.fn(), record: jest.fn(async () => {}) }));
jest.mock('../../../src/services/managed-ai-credits.service', () => ({ reserve: jest.fn(), reconcile: jest.fn(), release: jest.fn(), markUncertain: jest.fn(async () => {}) }));
jest.mock('../../../src/services/bedrock-provider', () => ({ DEFAULT_MODEL: 'global.amazon.nova-2-lite-v1:0', ask: jest.fn() }));
const ai = require('../../../src/services/ai.service');
const ledger = require('../../../src/services/managed-ai-credits.service');
const bedrock = require('../../../src/services/bedrock-provider');
const originalEnv = { ...process.env };
const context = { licenseId: 'shop-a', branchId: 'branch-a' };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.POSNIC_MANAGED_AI_PROVIDER = 'bedrock';
  delete process.env.POSNIC_MANAGED_AI_KEY;
  delete process.env.POSNIC_MANAGED_AI_MODEL;
  mockResolve.mockResolvedValue({ status: true, data: { values: {} } });
  ledger.reserve.mockResolvedValue({ ok: true, id: 'hold' });
  ledger.reconcile.mockResolvedValue();
  ledger.release.mockResolvedValue();
  bedrock.ask.mockResolvedValue({ text: 'Approved answer [1]', tokensIn: 42, tokensOut: 8 });
});
afterAll(() => { process.env = originalEnv; });

test('managed Bedrock works without a tenant API key and reconciles the reservation', async () => {
  expect(await ai.available(context)).toBe(true);
  const settings = await ai.settingsFor(context);
  expect(settings.key).toBe('');
  expect(ai.modeFor(settings)).toBe('managed');
  expect(await ai.ask({ prompt: 'Question', system: 'Approved sources only', feature: 'ask_posnic_help' }, context)).toEqual({ status: true, data: { text: 'Approved answer [1]' } });
  expect(ledger.reserve).toHaveBeenCalledWith(context, expect.objectContaining({ feature: 'ask_posnic_help', model: bedrock.DEFAULT_MODEL }));
  expect(ledger.reconcile).toHaveBeenCalledWith(context, expect.anything(), { model: bedrock.DEFAULT_MODEL, tokensIn: 42, tokensOut: 8 });
});
test('exhausted allowance prevents any AWS request', async () => {
  ledger.reserve.mockResolvedValue({ ok: false, message: 'Allowance exhausted' });
  expect((await ai.ask({ prompt: 'Question' }, context)).status).toBe(false);
  expect(bedrock.ask).not.toHaveBeenCalled();
});
test('a definite provider rejection releases the hold and returns no credential detail', async () => {
  bedrock.ask.mockRejectedValue(Object.assign(new Error('private provider detail'), { name: 'AccessDeniedException' }));
  const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await ai.ask({ prompt: 'Question' }, context);
  expect(result.message).toBe('The AI service did not answer');
  expect(ledger.release).toHaveBeenCalled();
  logger.mockRestore();
});

test('a timeout retains its hold until billing can be reconciled', async () => {
  bedrock.ask.mockRejectedValue(Object.assign(new Error('private timeout detail'), { name: 'TimeoutError' }));
  const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await ai.ask({ prompt: 'Question' }, context)).status).toBe(false);
    expect(ledger.release).not.toHaveBeenCalled();
    expect(ledger.markUncertain).toHaveBeenCalledWith(context, expect.objectContaining({ id: 'hold' }));
  } finally { logger.mockRestore(); }
});
test('empty paid response still reconciles reported usage', async () => {
  bedrock.ask.mockResolvedValue({ text: '', tokensIn: 42, tokensOut: 1 });
  expect((await ai.ask({ prompt: 'Question' }, context)).status).toBe(false);
  expect(ledger.reconcile).toHaveBeenCalled();
});
test('own provider takes precedence over managed model settings', async () => {
  mockResolve.mockImplementation(async (group) => ({ status: true, data: { values: group === 'secrets' ? { ai_api_key: 'own-key' } : group === 'preferences' ? { ai_provider: 'openai', ai_model: 'gpt-4o-mini' } : {} } }));
  const settings = await ai.settingsFor(context);
  expect(settings.provider).toBe('openai');
  expect(settings.model).toBe('gpt-4o-mini');
  expect(ai.modeFor(settings)).toBe('own_key');
});
