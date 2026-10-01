'use strict';

const crypto = require('node:crypto');
const budget = require('./ai-budget');
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256;
const ledgerCollection = 'ask_posnic_embedding_budget';
const validVector = (v) =>
  Array.isArray(v) && v.length === DIMENSIONS && v.every(Number.isFinite) && v.some((n) => n !== 0);

// One atomic monthly document owns all active reservations. Unknown outcomes
// retain their reservation; neither a timeout nor a new worker releases it.
async function reserve(db, context, cap, amount, currency) {
  if (
    !context?.licenseId ||
    !context?.branchId ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isFinite(cap) ||
    cap <= 0
  )
    throw new Error('An outlet and embedding budget are required.');
  const id = crypto
    .createHash('sha256')
    .update(JSON.stringify([context.licenseId, context.branchId, budget.monthKey(), currency]))
    .digest('hex');
  const ledger = db.collection(ledgerCollection);
  try {
    await ledger.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          license: String(context.licenseId),
          branch_id: String(context.branchId),
          month: budget.monthKey(),
          currency,
          spent: 0,
          held: 0,
          count: 0,
          holds: {},
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const claim = crypto.randomUUID(),
    limit = Math.floor(cap * 100 * 1e6);
  const row = await ledger.findOneAndUpdate(
    {
      _id: id,
      count: { $lt: 100 },
      $expr: { $lte: [{ $add: ['$spent', '$held', amount] }, limit] },
    },
    {
      $inc: { held: amount, count: 1 },
      $set: {
        [`holds.${claim}`]: {
          amount,
          at: new Date(),
          model: MODEL,
          unit_price: { ...budget.priceFor(MODEL) },
          exchange_rate: budget.USD_RATES[currency] || budget.USD_TO_INR,
          execution_owner: require('./ask-posnic-execution-owner').current(),
          operation_id: String(context.operationId || crypto.randomUUID()),
        },
      },
    },
    { returnDocument: 'after' }
  );
  if (!row)
    throw new Error('The monthly knowledge-search budget is used or pending calls need review.');
  return { id, claim, amount };
}

async function settle(db, hold, actual) {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > hold.amount)
    throw new Error('Embedding usage exceeds its reservation.');
  const result = await db.collection(ledgerCollection).updateOne(
    { _id: hold.id, [`holds.${hold.claim}.amount`]: hold.amount },
    {
      $inc: { held: -hold.amount, count: -1, spent: actual },
      $unset: { [`holds.${hold.claim}`]: '' },
    }
  );
  if (result.matchedCount !== 1) throw new Error('Embedding reservation could not be settled.');
}

async function embed(db, text, context, preferences, dependencies = {}) {
  const ai = require('./ai.service');
  const settings = await (dependencies.settingsFor || ai.settingsFor)(context);
  if (
    !settings.enabled ||
    ai.modeFor(settings) !== 'own_key' ||
    settings.provider !== 'openai' ||
    preferences?.own_key_semantic !== true ||
    preferences.help_enabled === false
  )
    throw new Error('Own-key knowledge search is disabled.');
  const bytes = typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0;
  if (!bytes || bytes > 8000 || !text.trim())
    throw new Error('Embedding input must be between 1 and 8000 UTF-8 bytes.');
  const meter = dependencies.budget || budget;
  if (!(await meter.withinCap(context, settings.cap)).ok)
    throw new Error('The overall AI spending limit has been reached.');
  const currency = await meter.currencyOf(context);
  // Each UTF-8 byte bounds a token. Reserve against the documented 8192 input
  // limit as an additional margin; returned usage must fit before settlement.
  const hold = await reserve(
    db,
    context,
    Number(preferences.own_key_semantic_budget),
    meter.costMicrominor({ model: MODEL, tokensIn: 8192, tokensOut: 0, rate: currency.rate }),
    currency.code
  );
  let sent = false,
    completed = false;
  try {
    sent = true;
    const response = await (dependencies.fetch || fetch)('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: text,
        dimensions: DIMENSIONS,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok) {
      if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) {
        await settle(db, hold, 0);
        completed = true;
      }
      throw new Error('The embedding provider did not accept the request.');
    }
    const data = await response.json(),
      tokens = data.usage?.total_tokens;
    if (
      data.model !== MODEL ||
      data.data?.length !== 1 ||
      data.data[0].index !== 0 ||
      !validVector(data.data[0].embedding) ||
      !Number.isInteger(tokens) ||
      tokens < 1 ||
      tokens > 8192
    )
      throw new Error('The embedding response could not be validated.');
    const actual = meter.costMicrominor({
      model: MODEL,
      tokensIn: tokens,
      tokensOut: 0,
      rate: currency.rate,
    });
    await settle(db, hold, actual);
    completed = true;
    // The atomic embedding ledger is authoritative even if the display meter
    // is temporarily unavailable. Never retry a paid call to repair a meter.
    try {
      await meter.record(
        {
          feature: 'ask_posnic_own_key_embedding',
          model: MODEL,
          tokensIn: tokens,
          tokensOut: 0,
          payer: 'shop',
        },
        context
      );
    } catch (_error) {
      console.warn('[ask-posnic] own-key embedding usage display unavailable');
    }
    return data.data[0].embedding;
  } catch (_error) {
    throw Object.assign(
      new Error(
        completed
          ? 'Knowledge search is temporarily unavailable.'
          : 'Embedding outcome requires operator review.'
      ),
      { uncertain: sent && !completed }
    );
  }
}

async function status(context, cap) {
  const db = await require('../models/base.model').getDb();
  const currency = await budget.currencyOf(context);
  const row = await db.collection(ledgerCollection).findOne({
    license: String(context.licenseId),
    branch_id: String(context.branchId),
    month: budget.monthKey(),
    currency: currency.code,
  });
  return {
    currency: currency.code,
    spent_minor: Number(row?.spent || 0) / 1e6,
    held_minor: Number(row?.held || 0) / 1e6,
    remaining_minor: Math.max(
      0,
      Number(cap) * 100 - Number(row?.spent || 0) / 1e6 - Number(row?.held || 0) / 1e6
    ),
    pending_calls: Number(row?.count || 0),
  };
}

module.exports = {
  embed,
  reserve,
  settle,
  status,
  validVector,
  MODEL,
  DIMENSIONS,
  ledgerCollection,
};
