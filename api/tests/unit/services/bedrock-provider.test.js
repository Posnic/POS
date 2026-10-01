'use strict';
jest.mock('@aws-sdk/credential-provider-ini', () => ({ fromIni: jest.fn(() => async () => ({})) }));
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  ...jest.requireActual('@aws-sdk/client-bedrock-runtime'),
  BedrockRuntimeClient: jest.fn(() => ({ send: async () => ({ usage: {} }), destroy: jest.fn() })),
}));
const provider = require('../../../src/services/bedrock-provider');

test('a dedicated Bedrock profile does not replace process-wide AWS credentials', async () => {
  const prior = process.env.POSNIC_MANAGED_AI_AWS_PROFILE;
  const originalGlobal = process.env.AWS_PROFILE;
  process.env.POSNIC_MANAGED_AI_AWS_PROFILE = 'posnic-ask-bedrock';
  try {
    await provider.ask({ prompt: 'Synthetic request' });
    expect(require('@aws-sdk/credential-provider-ini').fromIni).toHaveBeenCalledWith({ profile: 'posnic-ask-bedrock' });
    expect(require('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient).toHaveBeenCalledWith(expect.objectContaining({ credentials: expect.any(Function) }));
    expect(process.env.AWS_PROFILE).toBe(originalGlobal);
  } finally { if (prior == null) delete process.env.POSNIC_MANAGED_AI_AWS_PROFILE; else process.env.POSNIC_MANAGED_AI_AWS_PROFILE = prior; }
});

test('Bedrock uses Converse with bounded output and returns usage for the ledger', async () => {
  const client = { send: jest.fn(async () => ({ output: { message: { content: [{ text: 'Supported [1]' }] } }, usage: { inputTokens: 15, outputTokens: 4 } })) };
  const result = await provider.ask({ prompt: 'Question', system: 'Only use approved sources', model: 'global.amazon.nova-2-lite-v1:0', maxOutputTokens: 9999 }, client);
  expect(client.send.mock.calls[0][0].input).toEqual({ modelId: 'global.amazon.nova-2-lite-v1:0', messages: [{ role: 'user', content: [{ text: 'Question' }] }], system: [{ text: 'Only use approved sources' }], inferenceConfig: { maxTokens: 4000, temperature: 0 } });
  expect(result).toMatchObject({ text: 'Supported [1]', tokensIn: 15, tokensOut: 4 });
});

test('Bedrock propagates failures to the common neutral error handler', async () => {
  await expect(provider.ask({ prompt: 'Question' }, { send: async () => { throw new Error('AccessDenied'); } })).rejects.toThrow('AccessDenied');
});

test('Titan embeddings use normalized 256-dimensional floats and return exact input usage', async () => {
  const vector = Array(256).fill(0.0625);
  const client = { send: jest.fn(async () => ({ body: Buffer.from(JSON.stringify({ embedding: vector, inputTextTokenCount: 9 })) })) };
  expect(await provider.embed('Approved passage', client)).toEqual({ vector, tokensIn: 9, tokensOut: 0, model: 'amazon.titan-embed-text-v2:0' });
  expect(JSON.parse(client.send.mock.calls[0][0].input.body)).toEqual({ inputText: 'Approved passage', dimensions: 256, normalize: true, embeddingTypes: ['float'] });
  await expect(provider.embed('க'.repeat(3000), client)).rejects.toThrow('8,000');
  expect(client.send).toHaveBeenCalledTimes(1);
});

test('embedding output with missing usage or invalid dimensions cannot be treated as free usable data', async () => {
  for (const data of [{ embedding: [1], inputTextTokenCount: 1 }, { embedding: Array(256).fill(0), inputTextTokenCount: 1 }, { embedding: Array(256).fill(0.1) }]) {
    await expect(provider.embed('Approved', { send: async () => ({ body: Buffer.from(JSON.stringify(data)) }) })).rejects.toThrow('Invalid embedding');
  }
});
