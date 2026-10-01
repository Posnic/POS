'use strict';

// Operational counters only: no question, answer, user, document or error text.
// Best effort; billing authority remains the managed-credit ledger.
const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const COLLECTION = 'ask_posnic_metrics';
const DAY = 86400000;
const indexed = new WeakMap();
const FIELDS = {
  request: ['requests', 'answered', 'unanswered', 'rejected', 'failed', 'duration_ms'],
  provider: ['calls', 'succeeded', 'failed', 'duration_ms'],
  quality: ['helpful', 'not_helpful', 'actions_confirmed'],
  cost: ['calls', 'tokens_in', 'tokens_out', 'cost_microminor'],
};

async function write(db, context, kind, values, dimensions = {}, at = new Date()) {
  const license = String(context?.licenseId || '');
  if (!license || !FIELDS[kind] || !Number.isFinite(at.getTime())) return;
  const counters = {};
  for (const key of FIELDS[kind]) {
    if (Number.isFinite(values[key]) && values[key] >= 0) counters[key] = values[key];
  }
  if (!Object.keys(counters).length) return;
  const currency =
    kind === 'cost' && /^[A-Z]{3}$/.test(dimensions.currency || '') ? dimensions.currency : '';
  if (kind === 'cost' && !currency) return;
  const payer = kind === 'cost' ? (dimensions.payer === 'posnic' ? 'posnic' : 'shop') : '';
  if (!indexed.has(db))
    indexed.set(
      db,
      Promise.all([
        db.collection(COLLECTION).createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
        db.collection(COLLECTION).createIndex({ day: 1, kind: 1 }),
      ]).catch((error) => {
        indexed.delete(db);
        throw error;
      })
    );
  await indexed.get(db);
  const day = new Date(Math.floor(at.getTime() / DAY) * DAY);
  const id = crypto
    .createHash('sha256')
    .update(JSON.stringify([license, day.toISOString(), kind, currency, payer]))
    .digest('hex');
  const update = {
    $setOnInsert: {
      license,
      day,
      kind,
      currency,
      payer,
      expires_at: new Date(day.getTime() + 91 * DAY),
    },
    $min: { first_at: at },
    $max: { last_at: at },
    $inc: counters,
  };
  try {
    await db.collection(COLLECTION).updateOne({ _id: id }, update, { upsert: true });
  } catch (error) {
    // Concurrent first observations can race the unique _id insert.
    if (error.code !== 11000) throw error;
    await db.collection(COLLECTION).updateOne({ _id: id }, update);
  }
}

async function record(context, kind, values, dimensions) {
  if (!context?.licenseId) return;
  try {
    await write(await BaseModel.getDb(), context, kind, values, dimensions);
  } catch {
    console.warn('[ask-posnic] operational counters unavailable');
  }
}

function observe(req, res, next) {
  const start = performance.now();
  const context = {
    licenseId: req.tenantContext?.licenseId || req.user?.license || req.user?.license_id,
  };
  const json = res.json;
  let sent = false;
  res.json = function (body) {
    if (!sent) {
      sent = true;
      const outcome =
        res.statusCode >= 500
          ? 'failed'
          : res.statusCode >= 400
            ? 'rejected'
            : body?.type !== 'success'
              ? 'failed'
              : body?.data?.verified === false
                ? 'unanswered'
                : 'answered';
      void record(context, 'request', {
        requests: 1,
        [outcome]: 1,
        duration_ms: Math.max(0, Math.round(performance.now() - start)),
      });
    }
    return json.call(this, body);
  };
  next();
}

async function providerCall(feature, context, run) {
  if (!String(feature).startsWith('ask_posnic_')) return run();
  const start = performance.now();
  let succeeded = false;
  try {
    const result = await run();
    succeeded = true;
    return result;
  } finally {
    void record(context, 'provider', {
      calls: 1,
      [succeeded ? 'succeeded' : 'failed']: 1,
      duration_ms: Math.max(0, Math.round(performance.now() - start)),
    });
  }
}

module.exports = { COLLECTION, FIELDS, write, record, observe, providerCall };
