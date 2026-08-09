'use strict';
/*
 * The record of what needs syncing urgently, and what does not.
 *
 * Two failures matter here and they pull in opposite directions.
 *
 * Marking too little loses the point: a sale's stock change waits for the 60
 * second catalogue timer while the shop's other tills show the old quantity.
 *
 * Marking too much destroys it: if an ordinary description edit is critical
 * then everything is critical, the fast lane is the only lane, and the
 * scheduling on the gateway has nothing left to prioritise.
 *
 * The third thing tested here is the one that would be worst in production and
 * is invisible in development: this code also runs in the cloud shard, serving
 * twenty-one shops from one process. A till records what it must upload; the
 * cloud has nobody to upload to, and must write nothing at all.
 */

const outbox = require('../../../src/sync/outbox');
const ctx = require('../../../src/db/tenant-context');

/* A minimal in-memory stand-in for the local database. Nothing here needs a
   real MongoDB, and a test that needs one would not run in CI. */
function fakeDb() {
  const rows = [];
  const coll = {
    rows,
    createIndex: async () => {},
    insertOne: async (doc) => {
      rows.push({ ...doc, _id: `id${rows.length}` });
      return { insertedId: `id${rows.length - 1}` };
    },
    updateOne: async (filter, update, opts = {}) => {
      const found = rows.find(
        (r) =>
          r.collection === filter.collection && String(r.documentId) === String(filter.documentId)
      );
      if (found) {
        Object.assign(found, update.$set || {});
        return { matchedCount: 1, upsertedCount: 0 };
      }
      if (opts.upsert) {
        rows.push({
          ...(update.$setOnInsert || {}),
          ...(update.$set || {}),
          _id: `id${rows.length}`,
        });
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, upsertedCount: 0 };
    },
    countDocuments: async (q = {}) =>
      rows.filter((r) => (q.priority ? r.priority === q.priority : true)).length,
    find: (q = {}) => ({
      sort: () => ({
        limit: () => ({
          toArray: async () =>
            rows
              .filter((r) => (q.priority ? r.priority === q.priority : true))
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
              .slice(0, 1),
        }),
      }),
    }),
    deleteMany: async (q) => {
      const ids = (q._id && q._id.$in) || [];
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (ids.includes(rows[i]._id)) {
          rows.splice(i, 1);
          n++;
        }
      }
      return { deletedCount: n };
    },
  };
  return { collection: () => coll, _coll: coll };
}

describe('the durable sync outbox', () => {
  let db;

  beforeEach(() => {
    db = fakeDb();
    outbox._resetIndexCache();
    process.env.SYNC_OUTBOX_ENABLED = 'true';
    ctx.enableMultiTenant(false);
    /* The outbox reads the local database through the tenant seam, exactly as
       every other read does. */
    jest.spyOn(require('mongoose'), 'connection', 'get').mockReturnValue({ db });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SYNC_OUTBOX_ENABLED;
    ctx.enableMultiTenant(false);
  });

  test('a sale marks the affected item row critical', () => {
    return outbox.enqueueInventory('item-1', outbox.REASONS.SALE).then((ok) => {
      expect(ok).toBe(true);
      expect(db._coll.rows).toHaveLength(1);
      expect(db._coll.rows[0]).toMatchObject({
        collection: 'items',
        documentId: 'item-1',
        priority: 'critical',
        reason: 'sale_inventory',
      });
    });
  });

  test('the same item sold repeatedly needs only one pending marker', async () => {
    /* Coke sold three times in a minute is still one row with one current
       quantity. Three markers would push the same document three times. */
    await outbox.enqueueInventory('coke', outbox.REASONS.SALE);
    await outbox.enqueueInventory('coke', outbox.REASONS.SALE);
    await outbox.enqueueInventory('coke', outbox.REASONS.SALE);
    expect(db._coll.rows).toHaveLength(1);
  });

  test('re-marking does not reset how long work has been waiting', async () => {
    /* Otherwise a busy item hides a backlog: every new sale resets its age and
       "oldest pending" reads as zero while nothing is reaching the cloud. */
    await outbox.enqueueInventory('coke', outbox.REASONS.SALE);
    const first = db._coll.rows[0].createdAt;
    await new Promise((r) => setTimeout(r, 5));
    await outbox.enqueueInventory('coke', outbox.REASONS.SALE);
    expect(db._coll.rows[0].createdAt).toEqual(first);
  });

  test('sales are never deduplicated - each one is its own record', async () => {
    /* The opposite rule to items, and getting it wrong loses money: three sales
       collapsed into one marker is two sales that never reach the cloud. */
    await outbox.enqueue({ collection: 'sales', documentId: 's1', reason: 'sale' });
    await outbox.enqueue({ collection: 'sales', documentId: 's2', reason: 'sale' });
    await outbox.enqueue({ collection: 'sales', documentId: 's3', reason: 'sale' });
    expect(db._coll.rows).toHaveLength(3);
  });

  test('stocklogs are events too, and are not deduplicated', async () => {
    await outbox.enqueue({ collection: 'stocklogs', documentId: 'l1', reason: 'sale_inventory' });
    await outbox.enqueue({ collection: 'stocklogs', documentId: 'l2', reason: 'sale_inventory' });
    expect(db._coll.rows).toHaveLength(2);
  });

  test('every stock-changing reason is carried through', async () => {
    for (const reason of Object.values(outbox.REASONS)) {
      db._coll.rows.length = 0;
      await outbox.enqueueInventory('item-x', reason);
      expect(db._coll.rows[0].reason).toBe(reason);
    }
  });

  test('it writes nothing in the cloud shard', async () => {
    /*
     * The failure that would be worst and least visible. The shard runs this
     * same code for twenty-one shops and has nobody to upload to; writing
     * markers into every tenant database would be pure noise.
     */
    ctx.enableMultiTenant(true);
    const ok = await outbox.enqueueInventory('item-1', outbox.REASONS.SALE);
    expect(ok).toBe(false);
    expect(db._coll.rows).toHaveLength(0);
  });

  test('it writes nothing unless a desktop has enabled it', async () => {
    /* An installation that has not been configured for priority sync must
       behave exactly as it does today. */
    delete process.env.SYNC_OUTBOX_ENABLED;
    const ok = await outbox.enqueueInventory('item-1', outbox.REASONS.SALE);
    expect(ok).toBe(false);
    expect(db._coll.rows).toHaveLength(0);
  });

  test('a broken outbox never throws', async () => {
    /*
     * The property a shop's trading depends on. The caller has already
     * committed the sale; nothing here may turn that into an error the cashier
     * sees. The periodic scan still finds the change.
     */
    jest.spyOn(require('mongoose'), 'connection', 'get').mockReturnValue({
      db: {
        collection: () => ({
          createIndex: async () => {},
          updateOne: async () => {
            throw new Error('disk full');
          },
        }),
      },
    });
    await expect(outbox.enqueueInventory('item-1', outbox.REASONS.SALE)).resolves.toBe(false);
  });

  test('missing arguments are ignored rather than written as junk', async () => {
    expect(await outbox.enqueue({})).toBe(false);
    expect(await outbox.enqueue({ collection: 'items' })).toBe(false);
    expect(await outbox.enqueue({ documentId: 'x' })).toBe(false);
    expect(db._coll.rows).toHaveLength(0);
  });

  test('pending reports both a count and the age of the oldest', async () => {
    /* A count alone cannot tell "busy" from "stuck", and a till whose oldest
       marker is an hour old is a shop whose sales are not reaching the cloud. */
    expect(await outbox.pending()).toEqual({ count: 0, oldestAgeMs: 0 });
    await outbox.enqueueInventory('a', outbox.REASONS.SALE);
    await new Promise((r) => setTimeout(r, 5));
    const p = await outbox.pending();
    expect(p.count).toBe(1);
    expect(p.oldestAgeMs).toBeGreaterThan(0);
  });

  test('resolved markers are removed', async () => {
    await outbox.enqueue({ collection: 'sales', documentId: 's1', reason: 'sale' });
    const id = db._coll.rows[0]._id;
    expect(await outbox.resolve([id])).toBe(1);
    expect(db._coll.rows).toHaveLength(0);
  });
});
