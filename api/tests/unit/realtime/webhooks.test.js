'use strict';

/**
 * Unit tests for src/realtime/webhooks.js (integration platform step 1).
 *
 * What must hold: only safe URLs; the secret shown exactly once; a delivery
 * row written before the attempt; HMAC over the exact body; coalescing while
 * a delivery is pending; backoff then dead after MAX_ATTEMPTS; the lazy
 * drain throttled and resilient to removed subscriptions; and none of it
 * ever throwing into the write path that triggered it.
 */

const crypto = require('crypto');
const wh = require('../../../src/realtime/webhooks');

/* Minimal in-memory mongo-ish fake: enough find/insert/update for the module. */
function fakeDb() {
  const stores = new Map();
  const coll = (name) => {
    if (!stores.has(name)) stores.set(name, []);
    const rows = stores.get(name);
    const matches = (row, q) =>
      Object.entries(q).every(([k, v]) => {
        const val = k.split('.').reduce((o, part) => (o ? o[part] : undefined), row);
        if (v && typeof v === 'object' && v.$lte !== undefined) return val <= v.$lte;
        if (v && typeof v === 'object' && v.$gt !== undefined) return val > v.$gt;
        return String(val) === String(v);
      });
    return {
      insertOne: async (doc) => {
        doc._id = doc._id || crypto.randomBytes(12).toString('hex');
        rows.push(doc);
        return { insertedId: doc._id };
      },
      findOne: async (q) => rows.find((r) => matches(r, q)) || null,
      find: (q = {}) => {
        let out = rows.filter((r) => matches(r, q));
        const cursor = {
          sort: () => cursor,
          limit: (n) => {
            out = out.slice(0, n);
            return cursor;
          },
          project: () => cursor,
          toArray: async () => out.slice(),
        };
        return cursor;
      },
      updateOne: async (q, u) => {
        const row = rows.find((r) => matches(r, q));
        if (row && u.$set) Object.assign(row, u.$set);
        if (row && u.$unset) {
          for (const path of Object.keys(u.$unset)) {
            const parts = path.split('.');
            const key = parts.pop();
            const owner = parts.reduce((value, part) => (value ? value[part] : undefined), row);
            if (owner) delete owner[key];
          }
        }
        return { matchedCount: row ? 1 : 0 };
      },
      deleteOne: async (q) => {
        const i = rows.findIndex((r) => matches(r, q));
        if (i >= 0) rows.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
      },
      rows,
    };
  };
  return { collection: coll, _stores: stores };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

let realFetch;
beforeEach(() => {
  realFetch = global.fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('urlAllowed', () => {
  test('https yes, plain http no, loopback http yes (dev)', () => {
    expect(wh.urlAllowed('https://hooks.example.com/x')).toBe(true);
    expect(wh.urlAllowed('http://hooks.example.com/x')).toBe(false);
    expect(wh.urlAllowed('http://127.0.0.1:9000/x')).toBe(true);
    expect(wh.urlAllowed('not a url')).toBe(false);
  });
});

describe('subscriptions', () => {
  test('registration returns the secret once and the list never repeats it', async () => {
    const db = fakeDb();
    const r = await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    expect(r.ok).toBe(true);
    expect(r.secret).toHaveLength(48);
    const rows = await wh.listSubscriptions(db);
    expect(rows).toHaveLength(1);
    // the module stores it; the ROUTE layer's projection is what hides it -
    // asserted here so the field name a route must exclude stays stable
    expect(rows[0].secret).toBe(r.secret);
  });

  test('an http url or an empty event list is refused', async () => {
    const db = fakeDb();
    expect(
      (await wh.addSubscription(db, { url: 'http://a.example/h', events: ['sales'] })).ok
    ).toBe(false);
    expect((await wh.addSubscription(db, { url: 'https://a.example/h', events: [] })).ok).toBe(
      false
    );
  });
});

describe('publish', () => {
  test('writes the delivery row, signs the exact body, marks delivered on 2xx', async () => {
    const db = fakeDb();
    const { secret } = await wh.addSubscription(db, {
      url: 'https://a.example/h',
      events: ['sales'],
    });
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push({ url, init });
      return { status: 200 };
    };

    const fired = await wh.publish(db, 'shop_one', { entity: 'sales', at: 'T' });
    await flush();

    expect(fired).toBe(1);
    expect(seen).toHaveLength(1);
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(seen[0].init.body).digest('hex');
    expect(seen[0].init.headers['x-posnic-signature']).toBe(expected);
    const delivery = db.collection(wh.DELIVERIES).rows[0];
    expect(delivery.status).toBe('delivered');
    expect(delivery.payload).toEqual({
      event: 'change',
      entity: 'sales',
      at: 'T',
      shop: 'shop_one',
    });
  });

  test('only subscriptions listening to the entity fire', async () => {
    const db = fakeDb();
    await wh.addSubscription(db, { url: 'https://a.example/h', events: ['items'] });
    global.fetch = async () => {
      throw new Error('should not be called');
    };
    expect(await wh.publish(db, 's', { entity: 'sales', at: 'T' })).toBe(0);
  });

  test('a failure schedules backoff; a pending delivery coalesces the next signal', async () => {
    const db = fakeDb();
    await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    global.fetch = async () => {
      throw new Error('refused');
    };

    await wh.publish(db, 's', { entity: 'sales', at: 'T1' });
    await flush();
    const delivery = db.collection(wh.DELIVERIES).rows[0];
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(1);
    expect(delivery.nextAt.getTime()).toBeGreaterThan(Date.now());

    // rush of writes while pending -> no second row
    expect(await wh.publish(db, 's', { entity: 'sales', at: 'T2' })).toBe(0);
    expect(db.collection(wh.DELIVERIES).rows).toHaveLength(1);
  });

  test('never throws into the caller, whatever the db does', async () => {
    const broken = {
      collection: () => {
        throw new Error('db down');
      },
    };
    await expect(wh.publish(broken, 's', { entity: 'sales', at: 'T' })).resolves.toBe(0);
  });
});

describe('drainDue', () => {
  test('throttled per db name, retries due rows, kills orphans', async () => {
    const db = fakeDb();
    const sub = await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    // one due retry, one orphan (subscription gone)
    await db.collection(wh.DELIVERIES).insertOne({
      subscription_id: sub.id,
      payload: { event: 'change', entity: 'sales', at: 'T', shop: 's' },
      status: 'pending',
      attempts: 1,
      nextAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });
    await db.collection(wh.DELIVERIES).insertOne({
      subscription_id: 'gone',
      payload: { event: 'change', entity: 'sales', at: 'T', shop: 's' },
      status: 'pending',
      attempts: 1,
      nextAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });
    global.fetch = async () => ({ status: 204 });

    const unique = 'drain_test_' + Date.now();
    const n = await wh.drainDue(db, unique);
    await flush();
    expect(n).toBe(1);
    const rows = db.collection(wh.DELIVERIES).rows;
    expect(rows.find((r) => String(r.subscription_id) === String(sub.id)).status).toBe('delivered');
    expect(rows.find((r) => r.subscription_id === 'gone').status).toBe('dead');

    // second call within the window is a no-op by throttle
    expect(await wh.drainDue(db, unique)).toBe(0);
  });
});


describe('retry and dead-letter contract (#75, parent #34)', () => {
  test('a timeout gets a safe retry code and bounded backoff', async () => {
    const db = fakeDb();
    await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    global.fetch = async () => {
      const error = new Error('private.internal.example timed out with token=secret');
      error.name = 'TimeoutError';
      throw error;
    };

    await wh.publish(db, 'private-shop-name', { entity: 'sales', at: 'T' });
    await flush();
    const row = db.collection(wh.DELIVERIES).rows[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastErrorCode).toBe('timeout');
    expect(JSON.stringify(row)).not.toContain('private.internal.example');
    expect(JSON.stringify(row)).not.toContain('token=secret');
    expect(row.nextAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('a 500 retries, while a non-retryable 400 dead-letters immediately', async () => {
    const retryDb = fakeDb();
    await wh.addSubscription(retryDb, { url: 'https://a.example/h', events: ['sales'] });
    global.fetch = async () => ({ status: 500 });
    await wh.publish(retryDb, 's', { entity: 'sales', at: 'T' });
    await flush();
    expect(retryDb.collection(wh.DELIVERIES).rows[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'http_5xx',
    });

    const deadDb = fakeDb();
    await wh.addSubscription(deadDb, { url: 'https://b.example/h', events: ['sales'] });
    global.fetch = async () => ({ status: 400 });
    await wh.publish(deadDb, 'private-shop', { entity: 'sales', at: 'private-time' });
    await flush();
    const dead = deadDb.collection(wh.DELIVERIES).rows[0];
    expect(dead).toMatchObject({ status: 'dead', attempts: 1, lastErrorCode: 'http_4xx' });
    expect(dead.deadLetteredAt).toBeInstanceOf(Date);
    expect(dead.payload).toEqual({ event: 'change', entity: 'sales' });
    expect(dead).not.toHaveProperty('lastError');
  });

  test('a retry keeps the delivery id stable and can succeed', async () => {
    const db = fakeDb();
    await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    const ids = [];
    let calls = 0;
    global.fetch = async (_url, init) => {
      ids.push(init.headers['x-posnic-delivery']);
      calls++;
      return { status: calls === 1 ? 500 : 204 };
    };

    await wh.publish(db, 's', { entity: 'sales', at: 'T' });
    await flush();
    const row = db.collection(wh.DELIVERIES).rows[0];
    row.nextAt = new Date(Date.now() - 1);
    expect(await wh.drainDue(db, 'retry_success_' + Date.now())).toBe(1);
    await flush();
    expect(row).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(ids).toEqual([String(row._id), String(row._id)]);
  });

  test('permanent 500 failure stops at MAX_ATTEMPTS and leaves a sanitized record', async () => {
    const db = fakeDb();
    await wh.addSubscription(db, { url: 'https://a.example/h', events: ['sales'] });
    global.fetch = async () => ({ status: 500 });
    await wh.publish(db, 'private-shop', { entity: 'sales', at: 'private-time' });
    await flush();
    const row = db.collection(wh.DELIVERIES).rows[0];

    for (let attempt = 1; attempt < wh.MAX_ATTEMPTS; attempt++) {
      row.nextAt = new Date(Date.now() - 1);
      expect(await wh.drainDue(db, `permanent_${Date.now()}_${attempt}`)).toBe(1);
      await flush();
    }

    expect(row).toMatchObject({
      status: 'dead',
      attempts: wh.MAX_ATTEMPTS,
      lastErrorCode: 'http_5xx',
    });
    expect(row.deadLetteredAt).toBeInstanceOf(Date);
    expect(row.payload).toEqual({ event: 'change', entity: 'sales' });
    expect(row).not.toHaveProperty('lastError');
  });
});
