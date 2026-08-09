'use strict';
/*
 * Which local changes the sync agent should carry first, recorded durably.
 *
 * A till that has just taken money holds the only copy of that sale. Today the
 * agent finds it by scanning each collection for `updated_date > checkpoint` on
 * a timer - 15 seconds for sales, 60 for the item row whose stock the sale just
 * changed. Nothing is lost, but the shop's other tills see the new stock a
 * minute later than they could.
 *
 * This records the intent at the moment the business event happens, so the
 * agent has something to act on immediately instead of waiting to rediscover it.
 *
 * Three properties matter more than speed.
 *
 * DURABLE. The till loses power, the app crashes, Windows reboots mid-sale. An
 * in-memory list of urgent work is exactly the thing that does not survive
 * that, so this is a local MongoDB collection.
 *
 * IT MUST NEVER BREAK A SALE. Every function here swallows its own errors. A
 * shop must be able to trade when the outbox is unwritable for any reason -
 * the timer-based scan still exists underneath and will find the change anyway.
 * This is an accelerator, not a mechanism of record.
 *
 * IT MUST NOT RUN IN THE CLOUD. The same codebase serves 21 shops from one
 * shard process, and the cloud does not sync to itself - writing outbox rows
 * into every tenant database would be pure noise. `isMultiTenant()` is the
 * discriminator: the shard turns it on at boot, a till never does.
 */

const COLLECTION = 'sync_outbox';

/*
 * State rows versus event rows, which is the whole reason this file needs a
 * list rather than a flag.
 *
 * An item row is STATE. Coke sold three times in a minute is still one row with
 * one current quantity, so three markers would make the agent push the same
 * document three times. Those are deduplicated to one pending marker.
 *
 * A sale is an EVENT. Three sales are three business records, and collapsing
 * them would lose two of them. Those are never deduplicated.
 */
const STATE_COLLECTIONS = Object.freeze(['items', 'variants', 'inventoryitems']);

/** Reasons the gateway will accept as justification for a critical item push. */
const REASONS = Object.freeze({
  SALE: 'sale_inventory',
  RETURN: 'sale_return',
  CANCEL: 'sale_cancel',
  RECEIVING: 'receiving',
  ADJUSTMENT: 'adjustment',
});

/**
 * Is this process a till?
 *
 * Off in the cloud, and off unless a desktop explicitly enables it - so an
 * older installation that has not been configured for priority sync behaves
 * exactly as it does today.
 */
function isEnabled() {
  try {
    const { isMultiTenant } = require('../db/tenant-context');
    if (isMultiTenant()) return false;
  } catch (e) {
    /* No tenant context at all means standalone, which is a till. */
  }
  return String(process.env.SYNC_OUTBOX_ENABLED || '').toLowerCase() === 'true';
}

/** The local database, through the same seam every other read uses. */
function db() {
  const mongoose = require('mongoose');
  const { currentConnection } = require('../db/tenant-context');
  const connection = currentConnection(mongoose.connection);
  return connection && connection.db ? connection.db : null;
}

let indexesPromise = null;

/**
 * Indexes, created once per process.
 *
 * Set before awaiting so a slow or failing creation cannot start a second
 * attempt on every call. Failure is tolerated: without the unique index the
 * only consequence is duplicate markers for one item, which the agent handles
 * by pushing the same current row twice.
 */
function ensureIndexes(database) {
  if (indexesPromise) return indexesPromise;
  indexesPromise = (async () => {
    try {
      await database.collection(COLLECTION).createIndex(
        { collection: 1, documentId: 1 },
        {
          name: 'outbox_state_unique',
          unique: true,
          partialFilterExpression: { dedupe: true },
        }
      );
      await database.collection(COLLECTION).createIndex({ createdAt: 1 }, { name: 'outbox_age' });
      await database
        .collection(COLLECTION)
        .createIndex({ priority: 1, createdAt: 1 }, { name: 'outbox_drain' });
    } catch (e) {
      /* Indexes are an optimisation here, not a correctness requirement. */
    }
  })();
  return indexesPromise;
}

/**
 * Record that a document needs syncing sooner than its timer would manage.
 *
 * Never throws, never rejects. Callers are business paths that have already
 * committed; the sale is done whatever happens here.
 *
 * @param {object} entry
 * @param {string} entry.collection  the collection the document lives in
 * @param {string|object} entry.documentId
 * @param {string} entry.reason      one of REASONS
 * @param {string} [entry.priority]  defaults to 'critical'
 * @returns {Promise<boolean>} whether a marker was recorded
 */
async function enqueue({ collection, documentId, reason, priority = 'critical' } = {}) {
  if (!isEnabled()) return false;
  if (!collection || documentId === undefined || documentId === null) return false;

  try {
    const database = db();
    if (!database) return false;
    await ensureIndexes(database);

    const dedupe = STATE_COLLECTIONS.includes(collection);
    const now = new Date();

    if (dedupe) {
      /*
       * One pending marker per document. `$setOnInsert` for createdAt so the
       * age of the oldest pending work stays honest - re-marking a row that has
       * been waiting five minutes must not reset it to zero and hide a backlog.
       */
      await database.collection(COLLECTION).updateOne(
        { collection, documentId, dedupe: true },
        {
          $setOnInsert: { collection, documentId, dedupe: true, createdAt: now, attempts: 0 },
          $set: { priority, reason, updatedAt: now },
        },
        { upsert: true }
      );
      return true;
    }

    /* An event. Every one is its own business record. */
    await database.collection(COLLECTION).insertOne({
      collection,
      documentId,
      priority,
      reason,
      createdAt: now,
      attempts: 0,
    });
    return true;
  } catch (e) {
    /*
     * Deliberately silent beyond a warning. The periodic scan remains the
     * safety net, so the worst case is that this change syncs on its ordinary
     * timer - which is exactly what happens today.
     */
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[outbox] could not record sync priority:', e.message);
    }
    return false;
  }
}

/** Convenience for the stock paths, which are the reason this exists. */
async function enqueueInventory(itemId, reason = REASONS.SALE) {
  return enqueue({ collection: 'items', documentId: itemId, reason, priority: 'critical' });
}

/**
 * How much urgent work is waiting, and how old the oldest is.
 *
 * Both are needed: a count on its own cannot distinguish "busy" from "stuck",
 * and a till whose oldest critical marker is an hour old is a shop whose sales
 * are not reaching the cloud.
 */
async function pending() {
  if (!isEnabled()) return { count: 0, oldestAgeMs: 0 };
  try {
    const database = db();
    if (!database) return { count: 0, oldestAgeMs: 0 };
    const coll = database.collection(COLLECTION);
    const count = await coll.countDocuments({ priority: 'critical' });
    if (!count) return { count: 0, oldestAgeMs: 0 };
    const [oldest] = await coll
      .find({ priority: 'critical' })
      .sort({ createdAt: 1 })
      .limit(1)
      .toArray();
    return {
      count,
      oldestAgeMs: oldest ? Date.now() - new Date(oldest.createdAt).getTime() : 0,
    };
  } catch (e) {
    return { count: 0, oldestAgeMs: 0 };
  }
}

/** Remove markers the agent has successfully pushed. */
async function resolve(ids = []) {
  if (!isEnabled() || !ids.length) return 0;
  try {
    const database = db();
    if (!database) return 0;
    const r = await database.collection(COLLECTION).deleteMany({ _id: { $in: ids } });
    return r.deletedCount || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  COLLECTION,
  STATE_COLLECTIONS,
  REASONS,
  isEnabled,
  enqueue,
  enqueueInventory,
  pending,
  resolve,
  /* Exported for tests, which need a clean slate per case. */
  _resetIndexCache: () => {
    indexesPromise = null;
  },
};
