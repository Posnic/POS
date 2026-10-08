'use strict';
const crypto = require('node:crypto');
async function initializeRateLimits(db) {
  await db
    .collection('registry_rate_limits')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
// Internal adapter: subject must come from trusted account middleware or a
// correctly configured proxy boundary, never a request body or bearer token.
function createRegistryRateLimit({ db, bucket, limit, windowMs, subject, clock = Date.now } = {}) {
  if (
    !db ||
    !/^[a-z0-9-]{1,60}$/.test(bucket || '') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1000 ||
    typeof subject !== 'function'
  )
    throw Error('registry_rate_limit_configuration_required');
  return async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const identity = subject(req),
        now = clock();
      if (
        typeof identity !== 'string' ||
        !identity.length ||
        identity.length > 512 ||
        !Number.isSafeInteger(now) ||
        now < 0
      )
        throw Error('invalid_rate_limit_subject');
      const start = Math.floor(now / windowMs) * windowMs,
        end = start + windowMs;
      const key = crypto
        .createHash('sha256')
        .update(JSON.stringify([bucket, identity, start]))
        .digest('hex');
      const collection = db.collection('registry_rate_limits');
      const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(end) } };
      let record;
      try {
        record = await collection.findOneAndUpdate({ _id: key }, update, {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: false,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        record = await collection.findOneAndUpdate({ _id: key }, update, {
          returnDocument: 'after',
          includeResultMetadata: false,
        });
      }
      if (!record) throw Error('rate_limit_unavailable');
      if (record.count > limit) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((end - now) / 1000))));
        return res.status(429).json({ error: 'Too many registry requests. Try again later.' });
      }
      next();
    } catch (_) {
      res.status(503).json({ error: 'Registry request service is unavailable.' });
    }
  };
}
module.exports = { initializeRateLimits, createRegistryRateLimit };
