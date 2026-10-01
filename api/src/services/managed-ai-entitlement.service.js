'use strict';

const BaseModel = require('../models/base.model');
const cache = new Map();
const TTL_MS = 30000;

function configured() {
  return !!process.env.ASK_POSNIC_BILLING_URL;
}

function validate(value) {
  if (value?.active === false) return { active: false, allowance_minor: 0, currency: 'USD' };
  if (
    value?.active !== true ||
    !/^[a-f0-9]{64}$/.test(value.period_id || '') ||
    value.currency !== 'USD' ||
    !Number.isSafeInteger(value.allowance_minor) ||
    value.allowance_minor < 0 ||
    value.allowance_minor > 100000000 ||
    !Number.isFinite(Date.parse(value.valid_until)) ||
    Date.parse(value.valid_until) <= Date.now()
  )
    throw new Error('Managed AI allowance could not be verified.');
  return {
    active: true,
    period_id: value.period_id,
    allowance_minor: value.allowance_minor,
    currency: 'USD',
    valid_until: new Date(value.valid_until),
    source: 'paid',
  };
}

async function get({ fetcher = fetch, force = false } = {}) {
  const url = new URL(process.env.ASK_POSNIC_BILLING_URL);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Managed AI billing requires HTTPS.');
  const token = process.env.ASK_POSNIC_BILLING_TOKEN;
  if (!token) throw new Error('Managed AI billing is not configured.');
  const db = await BaseModel.getDb();
  const tenantDb = db.databaseName;
  if (!tenantDb) throw new Error('Managed AI requires a database identity.');
  const key = `${url.href}:${tenantDb}`;
  const saved = cache.get(key);
  if (saved?.pending) return saved.pending;
  if (
    !force &&
    saved &&
    Date.now() - saved.at < TTL_MS &&
    (!saved.value.active || new Date(saved.value.valid_until) > new Date())
  )
    return saved.value;
  const pending = (async () => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantDb }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Managed AI billing is temporarily unavailable.');
    if (Number(response.headers.get('content-length')) > 16384)
      throw new Error('Invalid managed AI allowance response.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 16384) {
        throw new Error('Invalid managed AI allowance response.');
      }
      chunks.push(Buffer.from(chunk));
    }
    return validate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  })();
  cache.set(key, { pending });
  try {
    const value = await pending;
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return value;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

module.exports = { configured, get, validate };
