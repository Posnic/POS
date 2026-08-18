'use strict';

/**
 * Unit tests for src/services/whatsapp-outbox.js (roadmap I6, the seam that
 * takes Chromium out of the API process).
 *
 * What must hold: a claim hands each row to exactly one connector; a claim
 * abandoned by a crashed connector returns to the pool after its TTL;
 * failures retry up to MAX_ATTEMPTS then park as 'dead' - visible, never
 * silent; shadow rows are parity data and never claimable; and the state
 * mirror is one row per branch, updated in place.
 */

const crypto = require('crypto');
const outbox = require('../../../src/services/whatsapp-outbox');

/* In-memory mongo-ish fake covering exactly what the outbox asks of it:
   $or / $lt / $gte matching, findOneAndUpdate with sort, upsert. */
function fakeDb() {
  const stores = new Map();
  const matches = (row, q) => {
    return Object.entries(q).every(([k, v]) => {
      if (k === '$or') return v.some((sub) => matches(row, sub));
      const val = row[k];
      if (v && typeof v === 'object' && !(v instanceof Date) && v.constructor === Object) {
        if (v.$lt !== undefined) return val !== undefined && val < v.$lt;
        if (v.$gte !== undefined) return val !== undefined && val >= v.$gte;
      }
      return String(val) === String(v);
    });
  };
  const coll = (name) => {
    if (!stores.has(name)) stores.set(name, []);
    const rows = stores.get(name);
    return {
      insertOne: async (doc) => {
        doc._id = doc._id || crypto.randomBytes(12).toString('hex');
        rows.push(doc);
        return { insertedId: doc._id };
      },
      findOne: async (q) => rows.find((r) => matches(r, q)) || null,
      find: (q = {}) => ({ toArray: async () => rows.filter((r) => matches(r, q)) }),
      findOneAndUpdate: async (q, u, opts = {}) => {
        let candidates = rows.filter((r) => matches(r, q));
        if (opts.sort) {
          const [[key, dir]] = Object.entries(opts.sort);
          candidates = candidates.slice().sort((a, b) => (a[key] < b[key] ? -dir : dir));
        }
        const row = candidates[0];
        if (row && u.$set) Object.assign(row, u.$set);
        return { value: row || null };
      },
      updateOne: async (q, u, opts = {}) => {
        const row = rows.find((r) => matches(r, q));
        if (row) {
          if (u.$set) Object.assign(row, u.$set);
          return { matchedCount: 1 };
        }
        if (opts.upsert) {
          const doc = { ...q, ...(u.$setOnInsert || {}), ...(u.$set || {}) };
          doc._id = crypto.randomBytes(12).toString('hex');
          rows.push(doc);
          return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0 };
      },
      rows,
    };
  };
  return { collection: coll, _stores: stores };
}

const BRANCH = '64a000000000000000000001';

describe('enqueue + claim', () => {
  test('a queued message is claimed exactly once', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: '9199', message: 'hi' });
    const first = await outbox.claim(db, 'L1', { limit: 10 });
    expect(first).toHaveLength(1);
    expect(first[0].phone).toBe('9199');
    const second = await outbox.claim(db, 'L1', { limit: 10 });
    expect(second).toHaveLength(0);
  });

  test('claims are oldest first and respect the limit', async () => {
    const db = fakeDb();
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: 'p' + i, message: 'm' + i });
      db.collection(outbox.OUTBOX).rows[i].created_date = new Date(2026, 0, 1 + i);
    }
    const got = await outbox.claim(db, 'L1', { limit: 3 });
    expect(got.map((r) => r.phone)).toEqual(['p0', 'p1', 'p2']);
  });

  test('a claim abandoned past its TTL returns to the pool', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: '9199', message: 'hi' });
    const t0 = new Date('2026-08-18T10:00:00Z');
    await outbox.claim(db, 'L1', { now: t0 });
    // Not yet stale: nothing to hand out.
    expect(await outbox.claim(db, 'L1', { now: new Date(t0.getTime() + 60_000) })).toHaveLength(0);
    // Past the TTL the crashed connector's claim is anyone's again.
    const later = new Date(t0.getTime() + outbox.CLAIM_TTL_MS + 1000);
    expect(await outbox.claim(db, 'L1', { now: later })).toHaveLength(1);
  });

  test('shadow rows are parity data, never claimable', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', {
      branch_id: BRANCH,
      phone: '9199',
      message: 'hi',
      shadow: true,
      inprocess: { ok: false, error: 'no session' },
    });
    expect(await outbox.claim(db, 'L1', {})).toHaveLength(0);
    const row = db.collection(outbox.OUTBOX).rows[0];
    expect(row.status).toBe('shadow');
    expect(row.inprocess_ok).toBe(false);
    expect(row.inprocess_error).toBe('no session');
  });
});

describe('report', () => {
  test('success parks the row as sent', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: '9', message: 'm' });
    const [claimed] = await outbox.claim(db, 'L1', {});
    const r = await outbox.report(db, 'L1', claimed.id, { ok: true });
    expect(r.status).toBe('sent');
    expect(db.collection(outbox.OUTBOX).rows[0].status).toBe('sent');
  });

  test('failures retry until MAX_ATTEMPTS then die visibly', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: '9', message: 'm' });
    let last;
    for (let i = 0; i < outbox.MAX_ATTEMPTS; i++) {
      // eslint-disable-next-line no-await-in-loop
      const [claimed] = await outbox.claim(db, 'L1', {});
      expect(claimed).toBeTruthy();
      // eslint-disable-next-line no-await-in-loop
      last = await outbox.report(db, 'L1', claimed.id, { ok: false, error: 'boom ' + i });
    }
    expect(last.status).toBe('dead');
    const row = db.collection(outbox.OUTBOX).rows[0];
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(outbox.MAX_ATTEMPTS);
    expect(row.error).toBe('boom ' + (outbox.MAX_ATTEMPTS - 1));
    // Dead rows are parked, not handed out again.
    expect(await outbox.claim(db, 'L1', {})).toHaveLength(0);
  });

  test('reporting garbage ids fails softly', async () => {
    const db = fakeDb();
    expect((await outbox.report(db, 'L1', 'not-an-id', { ok: true })).ok).toBe(false);
    expect((await outbox.report(db, 'L1', BRANCH, { ok: true })).reason).toBe('not-found');
  });
});

describe('connector state mirror', () => {
  test('one row per branch, updated in place', async () => {
    const db = fakeDb();
    await outbox.recordState(db, 'L1', {
      branch_id: BRANCH,
      device_id: 'd1',
      status: 'qr_ready',
      qr: 'QRDATA',
    });
    await outbox.recordState(db, 'L1', {
      branch_id: BRANCH,
      device_id: 'd1',
      status: 'connected',
      qr: null,
    });
    const rows = db.collection(outbox.STATE).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('connected');
    expect(rows[0].qr).toBe(null);
    const state = await outbox.getState(db, BRANCH);
    expect(state.status).toBe('connected');
  });
});

describe('stats', () => {
  test('counts by status and surfaces shadow parity failures', async () => {
    const db = fakeDb();
    await outbox.enqueue(db, 'L1', { branch_id: BRANCH, phone: '1', message: 'a' });
    await outbox.enqueue(db, 'L1', {
      branch_id: BRANCH,
      phone: '2',
      message: 'b',
      shadow: true,
      inprocess: { ok: false, error: 'x' },
    });
    await outbox.enqueue(db, 'L1', {
      branch_id: BRANCH,
      phone: '3',
      message: 'c',
      shadow: true,
      inprocess: { ok: true },
    });
    const s = await outbox.stats(db, {});
    expect(s.pending).toBe(1);
    expect(s.shadow).toBe(2);
    expect(s.shadow_inprocess_failed).toBe(1);
  });
});
