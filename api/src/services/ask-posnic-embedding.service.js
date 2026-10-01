'use strict';

const provider = require('./bedrock-provider');
const credits = require('./managed-ai-credits.service');
const budget = require('./ai-budget');

async function embed(text, context, feature = 'ask_posnic_query_embedding') {
  const ai = require('./ai.service');
  const settings = await ai.settingsFor(context);
  if (!settings.enabled || ai.modeFor(settings) !== 'managed' || settings.provider !== 'bedrock') return { status: false, message: 'Managed Bedrock embeddings are not enabled.' };
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 8000) return { status: false, message: 'Embedding text exceeds its limit.' };
  let hold, returned = false;
  try {
    hold = await credits.reserve(context, { feature, model: provider.EMBEDDING_MODEL, promptChars: Buffer.byteLength(text, 'utf8') * 3, maxOutputTokens: 0 });
    if (!hold.ok) return { status: false, message: hold.message };
    const result = await provider.embed(text);
    returned = true;
    await credits.reconcile(context, hold, result);
    await budget.record({ feature, ...result, payer: 'posnic' }, context).catch(() => {});
    return { status: true, data: { vector: result.vector, model: result.model } };
  } catch (error) {
    const rejected = !returned && ['AccessDeniedException', 'ValidationException', 'ThrottlingException', 'ResourceNotFoundException', 'UnrecognizedClientException'].includes(error.name);
    if (hold?.ok) {
      if (rejected) await credits.release(context, hold).catch(() => {});
      else await credits.markUncertain(context, hold).catch(() => {});
    }
    return { status: false, uncertain: Boolean(hold?.ok && !rejected), message: 'Semantic search is temporarily unavailable.' };
  }
}

module.exports = { embed };
