'use strict';
/*
 * Rate limit counters that survive more than one process.
 *
 * express-rate-limit keeps its counters in the memory of the process that made
 * them. With one process per shop that is correct. The moment several shops
 * share a pool of workers, it stops being: each worker keeps its own tally, so
 * a limit of 20 sign-in attempts per ten minutes becomes 20 per worker - 80
 * across four - and it loosens further with every worker added.
 *
 * That is a bad way to lose a control. Nothing errors, the configuration still
 * reads "limit: 20", and the only symptom is that brute force takes four times
 * fewer rounds than intended.
 *
 * MongoDB rather than Redis, because the database is already here. Rate limit
 * writes are small and infrequent - one upsert per limited request - and adding
 * a second datastore to hold a handful of counters would be a service to run,
 * patch and monitor for no gain.
 */

const mongoose = require('mongoose');

const COLLECTION = 'rate_limits';

/**
 * A store for express-rate-limit v7/v8 backed by the application's database.
 */
class MongoRateLimitStore {
  /**
   * @param {object}   [opts]
   * @param {Function} [opts.getDb] returns a Db, for tests and for callers that
   *                                do not use the default mongoose connection
   * @param {string}   [opts.prefix] separates one limiter's keys from another's
   */
  constructor({ getDb, prefix = 'rl' } = {}) {
    this.getDb = getDb || (() => mongoose.connection && mongoose.connection.db);
    this.prefix = prefix;
    this.windowMs = 60000;
    this.indexReady = false;
    /* Counters live in the database, so they are not local to this process.
       express-rate-limit uses this to decide whether it may skip a call. */
    this.localKeys = false;
  }

  /** express-rate-limit hands over the resolved options on mount. */
  init(options) {
    if (options && options.windowMs) this.windowMs = options.windowMs;
  }

  key(k) {
    return `${this.prefix}:${k}`;
  }

  /*
   * Expired counters are removed by MongoDB rather than by this process: a
   * limiter that had to sweep its own keys would need a timer, and a timer that
   * runs in every worker is four sweeps doing one job.
   */
  async ensureIndex(db) {
    if (this.indexReady) return;
    try {
      await db.collection(COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      this.indexReady = true;
    } catch (e) {
      /* An index that cannot be created is not a reason to refuse traffic. The
         counters still work; they are just cleaned up late. */
      this.indexReady = true;
    }
  }

  /**
   * @param {string} k
   * @returns {Promise<{totalHits: number, resetTime: Date}>}
   */
  async increment(k) {
    const db = this.getDb();
    /*
     * Fail open, deliberately, and this is a real trade-off.
     *
     * If the database is unreachable the choice is to refuse every limited
     * request or to allow them uncounted. Refusing turns a database blip into
     * a total outage of sign-in, which is a bigger and more certain harm than
     * a window of unthrottled attempts during an incident somebody is already
     * responding to. The alternative - fail closed - is defensible for a bank;
     * it is not right for a shop trying to take payment.
     */
    if (!db) return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };

    await this.ensureIndex(db);
    const now = new Date();
    const next = new Date(now.getTime() + this.windowMs);

    try {
      /*
       * One atomic step. A read-then-write would let two workers both see 19
       * and both write 20, which is precisely the miscount this store exists
       * to prevent. The pipeline form starts a fresh window when the stored
       * one has passed, so an expired document is reused rather than raced
       * over by a delete.
       */
      const res = await db.collection(COLLECTION).findOneAndUpdate(
        { _id: this.key(k) },
        [
          {
            $set: {
              hits: {
                $cond: [{ $gt: ['$expiresAt', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1],
              },
              expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', next] },
            },
          },
        ],
        { upsert: true, returnDocument: 'after' }
      );
      const doc = res && res.value ? res.value : res;
      return {
        totalHits: (doc && doc.hits) || 1,
        resetTime: (doc && doc.expiresAt) || next,
      };
    } catch (e) {
      return { totalHits: 1, resetTime: next };
    }
  }

  async decrement(k) {
    const db = this.getDb();
    if (!db) return;
    try {
      await db
        .collection(COLLECTION)
        .updateOne({ _id: this.key(k), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    } catch (e) {
      /* Only ever an over-count, which errs towards limiting. */
    }
  }

  async resetKey(k) {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.collection(COLLECTION).deleteOne({ _id: this.key(k) });
    } catch (e) {
      /* ignored */
    }
  }

  async resetAll() {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.collection(COLLECTION).deleteMany({ _id: { $regex: `^${this.prefix}:` } });
    } catch (e) {
      /* ignored */
    }
  }
}

module.exports = { MongoRateLimitStore, COLLECTION };
