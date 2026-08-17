'use strict';
/*
 * Webhooks (INTEGRATION_PLATFORM_ARCHITECTURE step 1).
 *
 * The S2 change-event seam already knows the moment anything in a shop
 * changes; this module fans that signal out to registered HTTPS endpoints so
 * an accounting system, an e-commerce sync or any counterparty learns within
 * seconds instead of polling.
 *
 * The contract (deliberately coarse in v1, same honesty as the bell):
 *   POST <url>  body {event:'change', entity, at, shop}
 *   headers     X-Posnic-Signature: sha256=<HMAC-SHA256(body, secret)>
 *               X-Posnic-Delivery: <delivery id>   X-Posnic-Event: change
 * The payload carries NO business data - the receiver fetches through its
 * own scoped credentials, so a leaked webhook secret alone leaks nothing.
 *
 * Delivery discipline (the outbox's, restated for HTTP):
 *  - a delivery row is written BEFORE the attempt (durable intent),
 *  - failures retry with exponential backoff (1m, 5m, 25m, ~2h, ~10h),
 *  - after MAX_ATTEMPTS the row is marked dead and left visible - a
 *    subscriber's outage must be diagnosable, never silent,
 *  - per (subscription, entity) COALESCING while a delivery is pending:
 *    a rush of sales becomes one "sales changed", not a queue of them.
 *  - retries drain lazily on the shop's own traffic (no global timers - a
 *    shard must not need a scheduler per tenant).
 *
 * Everything is fire-safe: webhooks are a courtesy to outsiders and may
 * never slow or fail the write that triggered them.
 */

const crypto = require('crypto');

const SUBS = 'webhook_subscriptions';
const DELIVERIES = 'webhook_deliveries';
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60e3, 300e3, 1500e3, 7500e3, 37500e3];
const TIMEOUT_MS = 10_000;
const DRAIN_EVERY_MS = 60_000; // how often lazy draining may run, per process
const drainLast = new Map(); // dbName -> ts

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
}

/** Only https (or loopback http for development) may receive shop events. */
function urlAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
  } catch (e) {
    return false;
  }
}

async function listSubscriptions(db) {
  return db.collection(SUBS).find({}).sort({ createdAt: 1 }).toArray();
}

async function addSubscription(db, { url, events, description }) {
  if (!urlAllowed(url)) return { ok: false, reason: 'url must be https' };
  const wanted = Array.isArray(events) ? events.filter((e) => typeof e === 'string') : [];
  if (!wanted.length) return { ok: false, reason: 'at least one event entity required' };
  const secret = crypto.randomBytes(24).toString('hex');
  const row = {
    url: String(url),
    events: wanted,
    description: String(description || ''),
    secret,
    active: true,
    createdAt: new Date(),
  };
  const r = await db.collection(SUBS).insertOne(row);
  /* The secret is returned ONCE, at creation - the list endpoint never
     repeats it, the same discipline as every API key issuer. */
  return { ok: true, id: r.insertedId, secret };
}

async function removeSubscription(db, id) {
  const { ObjectId } = require('mongodb');
  if (!ObjectId.isValid(String(id))) return { ok: false };
  const r = await db.collection(SUBS).deleteOne({ _id: new ObjectId(String(id)) });
  return { ok: r.deletedCount === 1 };
}

async function attempt(db, delivery, sub) {
  const body = JSON.stringify(delivery.payload);
  let outcome;
  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-posnic-signature': sign(sub.secret, body),
        'x-posnic-delivery': String(delivery._id),
        'x-posnic-event': delivery.payload.event,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    outcome = { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    outcome = { ok: false, status: 0, error: err.message };
  }

  const attempts = (delivery.attempts || 0) + 1;
  if (outcome.ok) {
    await db.collection(DELIVERIES).updateOne(
      { _id: delivery._id },
      { $set: { status: 'delivered', attempts, deliveredAt: new Date(), lastStatus: outcome.status } }
    );
  } else if (attempts >= MAX_ATTEMPTS) {
    await db.collection(DELIVERIES).updateOne(
      { _id: delivery._id },
      { $set: { status: 'dead', attempts, lastStatus: outcome.status, lastError: outcome.error || '' } }
    );
  } else {
    await db.collection(DELIVERIES).updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: 'pending',
          attempts,
          nextAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
          lastStatus: outcome.status,
          lastError: outcome.error || '',
        },
      }
    );
  }
  return outcome.ok;
}

/**
 * Fan one change signal out. Called from the change-events seam; must never
 * throw and never block the response that triggered it.
 */
async function publish(db, shopName, event) {
  try {
    const subs = (await listSubscriptions(db)).filter(
      (s) => s.active && s.events.includes(event.entity)
    );
    if (!subs.length) return 0;

    let fired = 0;
    for (const sub of subs) {
      /* Coalesce: one pending delivery per (subscription, entity). */
      const existing = await db.collection(DELIVERIES).findOne({
        subscription_id: sub._id,
        'payload.entity': event.entity,
        status: 'pending',
      });
      if (existing) continue;

      const delivery = {
        subscription_id: sub._id,
        payload: { event: 'change', entity: event.entity, at: event.at, shop: shopName || '' },
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        nextAt: new Date(),
      };
      const r = await db.collection(DELIVERIES).insertOne(delivery);
      delivery._id = r.insertedId;
      fired++;
      attempt(db, delivery, sub).catch(() => {});
    }
    return fired;
  } catch (e) {
    return 0; // a courtesy, never a failure
  }
}

/**
 * Lazy retry drain: piggybacks on the shop's own traffic at most once a
 * minute per process, so a shard needs no per-tenant scheduler and an idle
 * shop costs nothing.
 */
async function drainDue(db, dbName) {
  const last = drainLast.get(dbName) || 0;
  if (Date.now() - last < DRAIN_EVERY_MS) return 0;
  drainLast.set(dbName, Date.now());
  try {
    const due = await db
      .collection(DELIVERIES)
      .find({ status: 'pending', nextAt: { $lte: new Date() }, attempts: { $gt: 0 } })
      .limit(10)
      .toArray();
    if (!due.length) return 0;
    const subs = new Map((await listSubscriptions(db)).map((s) => [String(s._id), s]));
    let n = 0;
    for (const d of due) {
      const sub = subs.get(String(d.subscription_id));
      if (!sub || !sub.active) {
        await db.collection(DELIVERIES).updateOne(
          { _id: d._id }, { $set: { status: 'dead', lastError: 'subscription removed' } });
        continue;
      }
      attempt(db, d, sub).catch(() => {});
      n++;
    }
    return n;
  } catch (e) {
    return 0;
  }
}

async function recentDeliveries(db, limit = 50) {
  return db
    .collection(DELIVERIES)
    .find({}, { projection: { payload: 1, status: 1, attempts: 1, createdAt: 1, deliveredAt: 1, lastStatus: 1, lastError: 1, subscription_id: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

module.exports = {
  publish,
  drainDue,
  listSubscriptions,
  addSubscription,
  removeSubscription,
  recentDeliveries,
  sign,
  urlAllowed,
  SUBS,
  DELIVERIES,
  MAX_ATTEMPTS,
};
