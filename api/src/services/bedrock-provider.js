'use strict';

const { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { fromIni } = require('@aws-sdk/credential-provider-ini');
const DEFAULT_MODEL = 'global.amazon.nova-2-lite-v1:0';
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 256;

function clientConfig() {
  return {
    region: process.env.AWS_REGION || 'ap-south-1', maxAttempts: 1,
    ...(process.env.POSNIC_MANAGED_AI_AWS_PROFILE ? { credentials: fromIni({ profile: process.env.POSNIC_MANAGED_AI_AWS_PROFILE }) } : {}),
  };
}

async function embed(text, clientOverride) {
  // At most one conservative byte per token: even non-English text stays below
  // Titan's 8,192-token input limit. Never silently truncate an indexed passage.
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 8000) throw new Error('Embedding text must contain between 1 and 8,000 UTF-8 bytes.');
  const client = clientOverride || new BedrockRuntimeClient(clientConfig());
  try {
    const response = await client.send(new InvokeModelCommand({
      modelId: EMBEDDING_MODEL, contentType: 'application/json', accept: 'application/json',
      body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true, embeddingTypes: ['float'] }),
    }), { abortSignal: AbortSignal.timeout(30000) });
    const data = JSON.parse(Buffer.from(response.body).toString('utf8'));
    const vector = data.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite) || !vector.some((value) => value !== 0)
      || !Number.isInteger(data.inputTextTokenCount) || data.inputTextTokenCount < 1 || data.inputTextTokenCount > 8192) throw new Error('Invalid embedding response.');
    return { vector, tokensIn: data.inputTextTokenCount, tokensOut: 0, model: EMBEDDING_MODEL };
  } finally { if (!clientOverride) client.destroy(); }
}

async function ask({ prompt, system, images = [], model = DEFAULT_MODEL, maxOutputTokens = 1000 }, clientOverride = undefined) {
  // SSO locally; a workload role or dedicated server profile in production.
  // Never copy SSO tokens into tenant settings or return credentials to clients.
  const client = clientOverride || new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    maxAttempts: 1,
    // A Lightsail-specific profile applies only to this client. Setting the
    // process-wide AWS_PROFILE would also change S3 and other AWS integrations.
    ...(process.env.POSNIC_MANAGED_AI_AWS_PROFILE ? { credentials: fromIni({ profile: process.env.POSNIC_MANAGED_AI_AWS_PROFILE }) } : {}),
  });
  const content = images.map((image) => ({ image: {
    format: image.mimeType.replace('image/', '').replace('jpg', 'jpeg'),
    source: { bytes: Buffer.from(image.data, 'base64') },
  } }));
  content.push({ text: prompt });
  try {
    const result = await client.send(new ConverseCommand({
      modelId: model || DEFAULT_MODEL,
      messages: [{ role: 'user', content }],
      ...(system ? { system: [{ text: String(system).slice(0, 16000) }] } : {}),
      inferenceConfig: { maxTokens: Math.min(4000, Math.max(1, maxOutputTokens)), temperature: 0 },
    }), { abortSignal: AbortSignal.timeout(90000) });
    return {
      text: (result.output?.message?.content || []).map((part) => part.text || '').join('').trim(),
      tokensIn: Number(result.usage?.inputTokens || 0),
      tokensOut: Number(result.usage?.outputTokens || 0),
      model: model || DEFAULT_MODEL,
    };
  } finally {
    if (!clientOverride) client.destroy();
  }
}

module.exports = { ask, embed, clientConfig, DEFAULT_MODEL, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
