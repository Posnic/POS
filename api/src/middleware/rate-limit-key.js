'use strict';
/*
 * What a rate limit counts against.
 *
 * With a process per shop this never needed thinking about: the default key is
 * the client address, and the process only ever saw one shop, so "1000 requests
 * per address" meant "per address, per shop" for free.
 *
 * Sharing a process removes that for free. The same default now means 1000
 * requests per address across every shop on the machine, so one busy till can
 * spend the allowance and the next shop's cashier is told "Too many requests"
 * for traffic they had no part in. That was measured rather than reasoned
 * about - a load test against twenty shops returned 429 from shops it had not
 * reached yet.
 *
 * Two decisions come out of that, and they go opposite ways on purpose:
 *
 *   - the general limiter guards *availability*, so its key includes the shop.
 *     Each shop keeps the allowance it always had and cannot spend another's;
 *   - the sign-in limiters guard *credentials*, so their key does not. Somebody
 *     spraying one password across twenty shops from one address is one
 *     attacker, and should get one budget, not twenty.
 *
 * Both live here so the difference is a visible decision rather than a default
 * nobody revisited.
 */

/**
 * The client, as well as it can be known.
 *
 * req.ip is only trustworthy when Express has `trust proxy` set and nginx sends
 * X-Forwarded-For. The tenant server blocks sent X-Real-IP alone, so req.ip was
 * 127.0.0.1 for every request on the machine and every customer shared one
 * bucket. nginx sends both now; this reads whichever is there so a machine
 * whose config has not caught up still separates its customers.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientAddress(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (req.ip && req.ip !== '127.0.0.1' && req.ip !== '::1' && req.ip !== '::ffff:127.0.0.1') {
    return req.ip;
  }
  /* Only consulted when req.ip is loopback, which means the proxy headers were
     not trusted. The leftmost entry is the original client; the rest are
     proxies that added themselves. */
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  const real = req.headers && req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || req.ip || 'unknown';
}

/**
 * Which shop a request belongs to, or '' in a process that serves only one.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function shopOf(req) {
  try {
    const { currentTenant, isMultiTenant } = require('../db/tenant-context');
    if (!isMultiTenant()) return '';
    const t = currentTenant();
    /* The host is a usable fallback: a request that reached the app at all was
       resolved from it, so it names a shop even if the scope is unavailable. */
    return (t && t.tenantDb) || (req.headers && req.headers.host) || '';
  } catch (e) {
    /* Rate limiting must never be the reason a sale fails. Without a shop the
       key degrades to the address alone, which is the old behaviour. */
    return '';
  }
}

/**
 * Key for a limiter guarding availability: per shop, per client.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function perShopKey(req) {
  const ip = clientAddress(req);
  const shop = shopOf(req);
  return shop ? `${shop}|${ip}` : ip;
}

/**
 * Key for a limiter guarding credentials: per client, across every shop.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function perClientKey(req) {
  return clientAddress(req);
}

module.exports = { perShopKey, perClientKey, clientAddress, shopOf };
