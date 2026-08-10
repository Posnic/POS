'use strict';
/*
 * Poke the local sync agent to sync now.
 *
 * The agent polls on a timer as its guarantee, but polling means a change can
 * sit a few seconds before the next tick even when the machine is otherwise
 * idle - which on a till it almost always is. This tells the agent "something
 * changed, drain now", so a saved item or uploaded image crosses to the cloud
 * in well under a second. It is a hint, never a dependency: if the agent is
 * not running, is offline, or the poke is lost, the next poll still delivers.
 * Delivery is the outbox's job; this only affects latency.
 *
 * Fire-and-forget on purpose - nothing the caller does should wait on it, and
 * a failed poke must never fail the save that triggered it. Skipped entirely
 * in the cloud (multi-tenant), where there is no local agent to poke.
 */

const http = require('http');

let lastPoke = 0;

function nudgeSyncAgent() {
  try {
    const { isMultiTenant } = require('../db/tenant-context');
    if (isMultiTenant()) return; // the cloud shard has no local agent
  } catch (e) {
    /* tenant-context not available - treat as a till and poke */
  }

  /* Cheap client-side coalescing: many writes in a row send one poke, and the
     agent debounces again on its side. */
  const now = Date.now();
  if (now - lastPoke < 500) return;
  lastPoke = now;

  const port = Number(process.env.SYNC_AGENT_PORT || process.env.STATUS_PORT || 5055);
  const req = http.request(
    { host: '127.0.0.1', port, path: '/sync-now', method: 'GET', timeout: 1500 },
    (res) => res.resume() // drain and discard
  );
  req.on('error', () => {}); // agent not up / offline - the poll covers it
  req.on('timeout', () => req.destroy());
  req.end();
}

module.exports = { nudgeSyncAgent };
