'use strict';
/*
 * Per-shop realtime event bus (SEAMLESS_EXPERIENCE S2).
 *
 * One process serves one shop (or, on a shard, several - which is why every
 * operation here is keyed by database name). A write anywhere in the API
 * publishes a small invalidation signal - {type, entity} - and every till
 * the shop has open receives it over SSE within milliseconds. The signal
 * deliberately carries NO data: the till refreshes through the same
 * authenticated endpoints it already uses, so the channel can never leak
 * something the requester could not have fetched, and a lost event costs a
 * poll interval, not correctness.
 *
 * Plain in-process sets, no broker: the process IS the shop, so fan-out is
 * a for-loop. On a shard, tenants are isolated by key and one shop's events
 * never reach another's tills.
 */

/* One till, one connection. A shop floor has a handful of tills; three
   digits of connections on one tenant means something is leaking, and
   refusing the excess keeps the process serving sales. */
const MAX_SUBSCRIBERS_PER_TENANT = 50;
const HEARTBEAT_MS = 25_000;

const tenants = new Map(); // dbName -> Set<res>
let heartbeatTimer = null;

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  /* One timer for the whole process, not one per connection. Comment lines
     are the SSE idiom for "still here" - they keep nginx and any proxy from
     reaping an idle connection, and cost two bytes a tick. */
  heartbeatTimer = setInterval(() => {
    for (const subs of tenants.values()) {
      for (const res of subs) {
        try {
          res.write(':hb\n\n');
        } catch (e) { /* close handler cleans it up */ }
      }
    }
  }, HEARTBEAT_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function subscribe(dbName, res) {
  if (!dbName) return { ok: false, reason: 'no-tenant' };
  let subs = tenants.get(dbName);
  if (!subs) {
    subs = new Set();
    tenants.set(dbName, subs);
  }
  if (subs.size >= MAX_SUBSCRIBERS_PER_TENANT) {
    return { ok: false, reason: 'full' };
  }
  subs.add(res);
  ensureHeartbeat();
  return {
    ok: true,
    unsubscribe() {
      subs.delete(res);
      if (subs.size === 0) tenants.delete(dbName);
    },
  };
}

function publish(dbName, event) {
  const subs = tenants.get(dbName);
  if (!subs || subs.size === 0) return 0;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  for (const res of subs) {
    try {
      res.write(line);
      delivered++;
    } catch (e) { /* the close handler removes it */ }
  }
  return delivered;
}

function subscriberCount(dbName) {
  const subs = tenants.get(dbName);
  return subs ? subs.size : 0;
}

/* test hook */
function resetForTests() {
  tenants.clear();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

module.exports = {
  subscribe,
  publish,
  subscriberCount,
  resetForTests,
  MAX_SUBSCRIBERS_PER_TENANT,
  HEARTBEAT_MS,
};
