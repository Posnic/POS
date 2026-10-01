'use strict';

const platform = require('./ask-posnic-platform.service');
const { currentTenant } = require('../db/tenant-context');
const checks = new Map();

async function sync(req, { force = false, fetcher = fetch } = {}) {
  const address = process.env.ASK_POSNIC_KNOWLEDGE_URL;
  const token = process.env.ASK_POSNIC_KNOWLEDGE_TOKEN;
  if (!address || !token) return { configured: false };
  const url = new URL(address);
  if (url.protocol !== 'https:') throw new Error('Knowledge distribution requires HTTPS.');
  const key = `${currentTenant()?.tenantDb || ''}:${platform.scope(req).license}`;
  const existing = checks.get(key);
  if (existing?.pending) return existing.pending;
  if (!force && existing && Date.now() - existing.at < 15 * 60 * 1000) return { cached: true };
  const pending = (async () => {
    const response = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Published knowledge could not be fetched.');
    const maxBytes = 12 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Published knowledge is too large.');
    const reader = response.body.getReader();
    const parts = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBytes) throw new Error('Published knowledge is too large.');
        parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bundle = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (bundle.snapshot !== true || bundle.source !== 'posnic-intranet') throw new Error('An authoritative knowledge snapshot is required.');
    return platform.importBundle(req, bundle);
  })();
  checks.set(key, { at: Date.now(), pending });
  try { return await pending; }
  finally {
    checks.set(key, { at: Date.now() });
    if (checks.size > 5000) checks.delete(checks.keys().next().value);
  }
}

module.exports = { sync };
