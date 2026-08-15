'use strict';

/*
 * Integration-style tests for the coupon engine's DB-touching methods, using the
 * same in-memory Mongo stand-in the loyalty tests use. The pure eligibility and
 * discount maths lives in coupon.service.test.js; here we prove the redemption
 * ledger, the usage counters and the per-sale idempotency behave.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const CouponService = require('../../../src/services/coupon.service');
const { MESSAGES } = require('../../../src/constants/coupon.constants');

function matches(doc, query) {
  return Object.keys(query).every((k) => {
    const qv = query[k];
    const dv = doc[k];
    if (qv && typeof qv === 'object' && !(qv instanceof ObjectId)) {
      if ('$ne' in qv)
        return String(dv) !== String(qv.$ne) && !(dv === undefined && qv.$ne === true);
      if ('$in' in qv) return qv.$in.map(String).includes(String(dv));
      if ('$gt' in qv) return Number(dv) > Number(qv.$gt);
      if ('$exists' in qv) return (dv !== undefined) === qv.$exists;
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
    async countDocuments(q) {
      return docs.filter((d) => matches(d, q)).length;
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

const COUPON_ID = '64c111111111111111111111';
const CUST_ID = '64c222222222222222222222';
const SALE_ID = '64c333333333333333333333';

function baseCoupon(extra = {}) {
  return {
    _id: new ObjectId(COUPON_ID),
    license: 'lic-test',
    code: 'SAVE10',
    type: 'percent',
    value: 10,
    active: true,
    min_spend: 0,
    max_discount: 0,
    usage_limit: 0,
    per_customer_limit: 0,
    customer_id: null,
    start_date: null,
    end_date: null,
    times_used: 0,
    ...extra,
  };
}

describe('CouponService.validate (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new CouponService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('returns the discount for a good code', async () => {
    const coupons = makeCollection([baseCoupon()]);
    const redemptions = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    const r = await svc.validate('save10', { billTotal: 500 });
    expect(r.valid).toBe(true);
    expect(r.data.discount).toBe(50);
    expect(r.data.code).toBe('SAVE10');
  });

  test('rejects an unknown code', async () => {
    const coupons = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: makeCollection([]) }));
    const r = await svc.validate('NOPE', { billTotal: 500 });
    expect(r.valid).toBe(false);
    expect(r.message).toBe(MESSAGES.INVALID_CODE);
  });

  test('counts prior redemptions against the usage limit', async () => {
    const coupons = makeCollection([baseCoupon({ usage_limit: 2 })]);
    const redemptions = makeCollection([
      { coupon_id: new ObjectId(COUPON_ID), license: 'lic-test', voided: false },
      { coupon_id: new ObjectId(COUPON_ID), license: 'lic-test', voided: false },
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    const r = await svc.validate('SAVE10', { billTotal: 500 });
    expect(r.valid).toBe(false);
    expect(r.message).toBe(MESSAGES.USAGE_LIMIT);
  });

  test('a voided redemption frees the use back up', async () => {
    const coupons = makeCollection([baseCoupon({ usage_limit: 1 })]);
    const redemptions = makeCollection([
      { coupon_id: new ObjectId(COUPON_ID), license: 'lic-test', voided: true },
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    const r = await svc.validate('SAVE10', { billTotal: 500 });
    expect(r.valid).toBe(true);
  });
});

describe('CouponService.apply (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new CouponService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('records the redemption and bumps the counter', async () => {
    const coupons = makeCollection([baseCoupon()]);
    const redemptions = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    const r = await svc.apply('SAVE10', {
      saleId: SALE_ID,
      customerId: CUST_ID,
      billTotal: 500,
      discount: 50,
    });
    expect(r.status).toBe(true);
    expect(redemptions._docs).toHaveLength(1);
    expect(redemptions._docs[0].discount).toBe(50);
    expect(coupons._docs[0].times_used).toBe(1);
  });

  test('is idempotent per sale - a retry does not double-count', async () => {
    const coupons = makeCollection([baseCoupon()]);
    const redemptions = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    await svc.apply('SAVE10', {
      saleId: SALE_ID,
      customerId: CUST_ID,
      billTotal: 500,
      discount: 50,
    });
    const second = await svc.apply('SAVE10', {
      saleId: SALE_ID,
      customerId: CUST_ID,
      billTotal: 500,
      discount: 50,
    });

    expect(second.data.duplicate).toBe(true);
    expect(redemptions._docs).toHaveLength(1);
    expect(coupons._docs[0].times_used).toBe(1);
  });
});

describe('CouponService.reverse (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new CouponService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('voids the sale’s redemption and frees the use', async () => {
    const coupons = makeCollection([baseCoupon({ times_used: 1 })]);
    const redemptions = makeCollection([
      {
        _id: new ObjectId(),
        coupon_id: new ObjectId(COUPON_ID),
        sale_id: new ObjectId(SALE_ID),
        license: 'lic-test',
        voided: false,
      },
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));

    const r = await svc.reverse(SALE_ID);
    expect(r.data.reversed).toBe(1);
    expect(redemptions._docs[0].voided).toBe(true);
    expect(coupons._docs[0].times_used).toBe(0);
  });

  test('does nothing when the sale used no coupon', async () => {
    const coupons = makeCollection([baseCoupon()]);
    const redemptions = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ coupons, coupon_redemptions: redemptions }));
    const r = await svc.reverse(SALE_ID);
    expect(r.data.reversed).toBe(0);
  });
});
