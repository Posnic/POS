'use strict';
/*
 * The counters behind the sign-in limits.
 *
 * The default express-rate-limit store lives in one process's memory. That is
 * correct while every shop has a process to itself and wrong the moment shops
 * share workers: each worker counts separately, so "20 attempts per ten
 * minutes" becomes 20 per worker. Nothing errors and the configuration still
 * says 20, which is why this is asserted rather than assumed.
 */

const { MongoRateLimitStore, COLLECTION } = require('../../../src/middleware/rate-limit-store');

/** A minimal stand-in for the one collection the store touches. */
function fakeDb() {
  const docs = new Map();
  const calls = { findOneAndUpdate: 0, createIndex: 0 };
  return {
    docs,
    calls,
    collection(name) {
      expect(name).toBe(COLLECTION);
      return {
        async createIndex() {
          calls.createIndex += 1;
        },
        async findOneAndUpdate(filter, pipeline, opts) {
          calls.findOneAndUpdate += 1;
          /* Enough of the pipeline's meaning to test the window behaviour:
             extend an unexpired counter, restart an expired one. */
          const now = new Date();
          const set = pipeline[0].$set;
          const windowEnd = set.expiresAt.$cond[2];
          const prev = docs.get(filter._id);
          const live = prev && prev.expiresAt > now;
          const doc = {
            _id: filter._id,
            hits: live ? prev.hits + 1 : 1,
            expiresAt: live ? prev.expiresAt : windowEnd,
          };
          docs.set(filter._id, doc);
          expect(opts.upsert).toBe(true);
          return doc;
        },
        async updateOne(filter, update) {
          const d = docs.get(filter._id);
          if (d && d.hits > 0) d.hits += update.$inc.hits;
        },
        async deleteOne(filter) {
          docs.delete(filter._id);
        },
        async deleteMany() {
          docs.clear();
        },
      };
    },
  };
}

describe('rate limit counters shared across processes', () => {
  test('counts up within a window', async () => {
    const db = fakeDb();
    const store = new MongoRateLimitStore({ getDb: () => db });
    store.init({ windowMs: 60000 });
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
    expect((await store.increment('1.2.3.4')).totalHits).toBe(2);
    expect((await store.increment('1.2.3.4')).totalHits).toBe(3);
  });

  test('two stores sharing a database continue one another\'s count', async () => {
    /* This is the whole point: two workers, one tally. With the default store
       each would have started again at 1. */
    const db = fakeDb();
    const workerA = new MongoRateLimitStore({ getDb: () => db });
    const workerB = new MongoRateLimitStore({ getDb: () => db });
    workerA.init({ windowMs: 60000 });
    workerB.init({ windowMs: 60000 });

    await workerA.increment('1.2.3.4');
    await workerA.increment('1.2.3.4');
    const onB = await workerB.increment('1.2.3.4');
    expect(onB.totalHits).toBe(3);
  });

  test('different keys are counted separately', async () => {
    const db = fakeDb();
    const store = new MongoRateLimitStore({ getDb: () => db });
    store.init({ windowMs: 60000 });
    await store.increment('1.1.1.1');
    await store.increment('1.1.1.1');
    expect((await store.increment('2.2.2.2')).totalHits).toBe(1);
  });

  test('two limiters do not share a tally', async () => {
    const db = fakeDb();
    const login = new MongoRateLimitStore({ getDb: () => db, prefix: 'login' });
    const reset = new MongoRateLimitStore({ getDb: () => db, prefix: 'pwreset' });
    login.init({ windowMs: 60000 });
    reset.init({ windowMs: 60000 });
    await login.increment('1.2.3.4');
    await login.increment('1.2.3.4');
    expect((await reset.increment('1.2.3.4')).totalHits).toBe(1);
  });

  test('a new window restarts the count', async () => {
    const db = fakeDb();
    const store = new MongoRateLimitStore({ getDb: () => db });
    store.init({ windowMs: 1 });
    await store.increment('1.2.3.4');
    await new Promise((r) => setTimeout(r, 15));
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
  });

  test('resetKey clears one caller, not the rest', async () => {
    const db = fakeDb();
    const store = new MongoRateLimitStore({ getDb: () => db });
    store.init({ windowMs: 60000 });
    await store.increment('a');
    await store.increment('b');
    await store.resetKey('a');
    expect((await store.increment('a')).totalHits).toBe(1);
    expect((await store.increment('b')).totalHits).toBe(2);
  });

  test('a request is allowed when the database is unreachable', async () => {
    /* Deliberate: refusing every limited request during a database incident
       turns a blip into a sign-in outage, which is a bigger and more certain
       harm than a window of uncounted attempts while somebody responds. */
    const store = new MongoRateLimitStore({ getDb: () => null });
    store.init({ windowMs: 60000 });
    const info = await store.increment('1.2.3.4');
    expect(info.totalHits).toBe(1);
    expect(info.resetTime.getTime()).toBeGreaterThan(Date.now());
    await expect(store.decrement('1.2.3.4')).resolves.toBeUndefined();
    await expect(store.resetKey('1.2.3.4')).resolves.toBeUndefined();
  });

  test('declares that its counters are not local to this process', () => {
    /* express-rate-limit uses this to decide what it may skip. */
    expect(new MongoRateLimitStore().localKeys).toBe(false);
  });

  test('the expiry index is created once, not per request', async () => {
    const db = fakeDb();
    const store = new MongoRateLimitStore({ getDb: () => db });
    store.init({ windowMs: 60000 });
    await store.increment('a');
    await store.increment('a');
    await store.increment('b');
    expect(db.calls.createIndex).toBe(1);
  });
});
