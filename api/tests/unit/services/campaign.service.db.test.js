'use strict';

/*
 * Integration-style tests for the campaign engine's DB-touching methods, using
 * the in-memory Mongo stand-in and INJECTED channel adapters so no real message
 * is ever sent. These prove the guards that make sending safe: opt-outs and
 * missing phones are skipped, a dry run dispatches nothing, and a re-run only
 * reaches recipients that have not already been messaged.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const CampaignService = require('../../../src/services/campaign.service');
const {
  STATUS,
  SEND_STATUS,
  SEGMENT_TYPE,
  CHANNEL,
} = require('../../../src/constants/campaign.constants');

const getDotted = (obj, path) =>
  String(path)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);

const cmp = (a, b) =>
  b instanceof Date || a instanceof Date
    ? new Date(a || 0).getTime() - new Date(b || 0).getTime()
    : Number(a) - Number(b);

function opMatch(dv, qv) {
  if ('$ne' in qv) return String(dv) !== String(qv.$ne);
  if ('$in' in qv) return qv.$in.map(String).includes(String(dv));
  if ('$nin' in qv) return !qv.$nin.map(String).includes(String(dv));
  if ('$gt' in qv) return cmp(dv, qv.$gt) > 0;
  if ('$gte' in qv) return cmp(dv, qv.$gte) >= 0;
  if ('$lt' in qv) return cmp(dv, qv.$lt) < 0;
  if ('$lte' in qv) return cmp(dv, qv.$lte) <= 0;
  if ('$exists' in qv) return (dv !== undefined) === qv.$exists;
  return false;
}

function matches(doc, query) {
  return Object.keys(query).every((k) => {
    if (k === '$or') return query.$or.some((sub) => matches(doc, sub));
    const dv = getDotted(doc, k);
    const qv = query[k];
    if (qv && typeof qv === 'object' && !(qv instanceof ObjectId) && !(qv instanceof Date)) {
      return opMatch(dv, qv);
    }
    return String(dv) === String(qv);
  });
}

function makeCollection(seed = []) {
  const docs = seed.map((d) => ({ ...d }));
  const cur = (list) => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    async toArray() {
      return list;
    },
  });
  return {
    _docs: docs,
    async findOne(q) {
      return docs.find((d) => matches(d, q)) || null;
    },
    async insertOne(doc) {
      const _id = doc._id || new ObjectId();
      docs.push({ ...doc, _id });
      return { insertedId: _id };
    },
    async updateOne(q, update) {
      const doc = docs.find((d) => matches(d, q));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc)
        Object.keys(update.$inc).forEach((p) => (doc[p] = (Number(doc[p]) || 0) + update.$inc[p]));
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(q) {
      const i = docs.findIndex((d) => matches(d, q));
      if (i === -1) return { deletedCount: 0 };
      docs.splice(i, 1);
      return { deletedCount: 1 };
    },
    find(q) {
      return cur(docs.filter((d) => matches(d, q)));
    },
  };
}

function makeDb(collections) {
  return {
    collection(name) {
      return collections[name] || (collections[name] = makeCollection());
    },
  };
}

const CID = '64d000000000000000000001';
function cust(id, over = {}) {
  return {
    _id: new ObjectId(id),
    license: 'lic-test',
    name: 'C' + id.slice(-2),
    phone: '+9199' + id.slice(-4),
    preferences: { smsNotifications: true, whatsappNotifications: true },
    loyalty: { points: 100, pointsEarned: 100, tier: 'gold' },
    ...over,
  };
}

function makeCampaign(over = {}) {
  return {
    _id: new ObjectId(CID),
    license: 'lic-test',
    name: 'Promo',
    channel: CHANNEL.WHATSAPP,
    message: 'Hi {name}',
    segment: { type: SEGMENT_TYPE.ALL },
    status: STATUS.DRAFT,
    branch_id: new ObjectId('64d000000000000000000099'),
    sent_count: 0,
    failed_count: 0,
    skipped_count: 0,
    ...over,
  };
}

// An adapter set that records who it was asked to message.
function recordingAdapters(resultFor) {
  const called = [];
  const fn = async (phone, message) => {
    called.push({ phone, message });
    return resultFor(phone);
  };
  return { called, adapters: { [CHANNEL.WHATSAPP]: fn, [CHANNEL.SMS]: fn } };
}

describe('CampaignService.preview (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new CampaignService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('counts total vs reachable (phone + opted-in)', async () => {
    const customers = makeCollection([
      cust('64d000000000000000000011'),
      cust('64d000000000000000000012', { phone: '' }), // no phone
      cust('64d000000000000000000013', { preferences: { whatsappNotifications: false } }), // opted out
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers }));

    const r = await svc.preview({ type: SEGMENT_TYPE.ALL }, CHANNEL.WHATSAPP);
    expect(r.data.total).toBe(3);
    expect(r.data.reachable).toBe(1);
  });
});

describe('CampaignService.send (DB, injected adapters)', () => {
  let svc;
  beforeEach(() => {
    svc = new CampaignService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('dry run renders and logs but dispatches nothing', async () => {
    const campaigns = makeCollection([makeCampaign()]);
    const sends = makeCollection([]);
    const customers = makeCollection([cust('64d000000000000000000011')]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ campaigns, campaign_sends: sends, customers }));
    const rec = recordingAdapters(() => ({ ok: true }));

    const r = await svc.send(CID, { dryRun: true, adapters: rec.adapters });
    expect(r.data.dryRun).toBe(true);
    expect(rec.called).toHaveLength(0); // nothing dispatched
    expect(sends._docs[0].status).toBe(SEND_STATUS.DRY_RUN);
    expect(campaigns._docs[0].status).toBe(STATUS.DRAFT); // unchanged
  });

  test('skips opt-outs and missing phones; sends the rest', async () => {
    const campaigns = makeCollection([makeCampaign()]);
    const sends = makeCollection([]);
    const customers = makeCollection([
      cust('64d000000000000000000011'), // ok
      cust('64d000000000000000000012', { phone: '' }), // no phone
      cust('64d000000000000000000013', { preferences: { whatsappNotifications: false } }), // opted out
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ campaigns, campaign_sends: sends, customers }));
    const rec = recordingAdapters(() => ({ ok: true }));

    const r = await svc.send(CID, { adapters: rec.adapters });
    expect(r.data.sent).toBe(1);
    expect(r.data.skipped).toBe(2);
    expect(rec.called).toHaveLength(1); // only the reachable one
    const statuses = sends._docs.map((s) => s.status).sort();
    expect(statuses).toEqual(
      [SEND_STATUS.SENT, SEND_STATUS.SKIPPED_NOPHONE, SEND_STATUS.SKIPPED_OPTOUT].sort()
    );
    expect(campaigns._docs[0].status).toBe(STATUS.SENT);
  });

  test('refuses to re-send a completed campaign', async () => {
    const campaigns = makeCollection([makeCampaign({ status: STATUS.SENT })]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ campaigns, campaign_sends: makeCollection([]), customers: makeCollection([]) })
      );
    const r = await svc.send(CID, { adapters: recordingAdapters(() => ({ ok: true })).adapters });
    expect(r.status).toBe(false);
  });

  test('a re-run retries only the failed recipients (idempotent per recipient)', async () => {
    const campaigns = makeCollection([makeCampaign()]);
    const sends = makeCollection([]);
    const A = cust('64d0000000000000000000a1');
    const B = cust('64d0000000000000000000b2');
    const customers = makeCollection([A, B]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ campaigns, campaign_sends: sends, customers }));

    // Run 1: A succeeds, B fails -> campaign PARTIAL.
    const run1 = recordingAdapters((phone) => ({ ok: phone === A.phone }));
    const r1 = await svc.send(CID, { adapters: run1.adapters });
    expect(r1.data.sent).toBe(1);
    expect(r1.data.failed).toBe(1);
    expect(campaigns._docs[0].status).toBe(STATUS.PARTIAL);

    // Run 2: everyone would succeed, but only the failed B should be retried.
    const run2 = recordingAdapters(() => ({ ok: true }));
    const r2 = await svc.send(CID, { adapters: run2.adapters });
    expect(run2.called).toHaveLength(1);
    expect(run2.called[0].phone).toBe(B.phone);
    expect(r2.data.sent).toBe(1);
  });
});

describe('CampaignService.schedule + runDue (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new CampaignService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('a due scheduled campaign is sent by runDue', async () => {
    const campaigns = makeCollection([
      makeCampaign({ status: STATUS.SCHEDULED, schedule_at: new Date('2026-08-15T09:00:00Z') }),
    ]);
    const sends = makeCollection([]);
    const customers = makeCollection([cust('64d000000000000000000011')]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ campaigns, campaign_sends: sends, customers }));
    const rec = recordingAdapters(() => ({ ok: true }));

    const r = await svc.runDue({ adapters: rec.adapters, now: new Date('2026-08-15T10:00:00Z') });
    expect(r.data.ran).toBe(1);
    expect(rec.called).toHaveLength(1);
    expect(campaigns._docs[0].status).toBe(STATUS.SENT);
  });

  test('a future scheduled campaign is left alone', async () => {
    const campaigns = makeCollection([
      makeCampaign({ status: STATUS.SCHEDULED, schedule_at: new Date('2026-08-20T09:00:00Z') }),
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ campaigns, campaign_sends: makeCollection([]), customers: makeCollection([]) })
      );
    const r = await svc.runDue({
      adapters: recordingAdapters(() => ({ ok: true })).adapters,
      now: new Date('2026-08-15T10:00:00Z'),
    });
    expect(r.data.ran).toBe(0);
    expect(campaigns._docs[0].status).toBe(STATUS.SCHEDULED);
  });
});
