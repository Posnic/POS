'use strict';

/*
 * Create an index once per DATABASE, not once per process.
 *
 * A shop's data lives in its own database (see db/tenant-connections.js) and
 * one process serves many shops. So the obvious latch is wrong in a way that
 * is invisible in testing and total in production:
 *
 *     if (this.constructor._ensured) return;   // <- per PROCESS
 *
 * The first shop to hit the endpoint after a restart sets that flag, and every
 * other shop on the same process never gets the index at all. It looks like it
 * worked, because it did - once, for whoever was first.
 *
 * Keying the latch by database name fixes it: each shop gets exactly one
 * attempt, and a restart re-attempts for everyone. createIndex is itself
 * idempotent, so the latch is only there to avoid the round trip.
 *
 * WHERE THIS SHOULD EVENTUALLY LIVE: db/migrations.js runs versioned, ledgered
 * migrations against each tenant database before it serves traffic, which is
 * the right home for schema shape. It is written but not yet wired - nothing
 * calls runMigrations and the registry is empty - so index creation still
 * happens lazily here. When migrations are wired, these move and this file
 * goes away.
 */

const ensured = new Set();

/* The database a collection belongs to, however the driver exposes it. */
function databaseNameOf(collection) {
  return (
    collection?.dbName || collection?.s?.db?.databaseName || collection?.conn?.name || 'default'
  );
}

/**
 * Ensure `keys` exists on `collection`, at most once per database per process.
 *
 * Best effort by design: an index build that fails - a shop mid-build, a
 * permission quirk, a legacy duplicate blocking a unique index - must never
 * fail the request that happened to trigger it. It simply is not latched, so
 * the next request tries again.
 *
 * @returns {Promise<boolean>} true if the index is now believed to exist
 */
async function ensureIndexOnce(collection, keys, options = {}) {
  if (!collection || !keys) return false;

  const name = options.name || JSON.stringify(keys);
  const key = `${databaseNameOf(collection)}::${name}`;
  if (ensured.has(key)) return true;

  try {
    await collection.createIndex(keys, options);
    ensured.add(key);
    return true;
  } catch (e) {
    return false;
  }
}

/* Tests only: forget what has been ensured. */
function _reset() {
  ensured.clear();
}

module.exports = { ensureIndexOnce, databaseNameOf, _reset };
