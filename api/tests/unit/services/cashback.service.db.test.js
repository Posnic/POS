'use strict';

/*
 * DB-level tests for cashback issuing. Uses the in-memory Mongo stand-in and a
 * mocked messaging service (no real message sent). Proves a qualifying sale mints
 * a single-use fixed coupon with an expiry, that it is idempotent per sale, that
 * it is delivered when configured, and that cancelling the sale voids it.
 */

jest.mock('../../../src/services/messaging.service', () =>
  jest.fn().mockImplementation(() => ({
    sendSms: jest.fn().mockResolvedValue({ ok: true }),
    sendWhatsapp: jest.fn().mockResolvedValue({ ok: true }),
  }))
);

const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const CashbackService = require('../../../src/services/cashback.service');

function matches(doc, query) {
  return Object.keys(query).every((k) => {
    const qv = query[k];
    const dv = doc[k];
    if (qv && typeof qv === 'object' && !(qv instanceof ObjectId)) {
      if ('$ne' in qv)
        return String(dv) !== String(qv.$ne) && !(dv === undefined && qv.$ne === true);
      if ('$in' in qv) return qv.$in.map(String).includes(String(dv));
    }
    return String(dv) === String(qv);
  });
}
function makeCollection(seed = []) {
  const docs = seed.map((d) => ({ ...d }));
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
    async updateOne(q, update, opts = {}) {
      let doc = docs.find((d) => matches(d, q));
      if (!doc && opts.upsert) {
        doc = { ...q };
        if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
        docs.push(doc);
      }
      if (doc && update.$set) Object.assign(doc, update.$set);
      if (doc && update.$inc)
        Object.keys(update.$inc).forEach((p) => (doc[p] = (Number(doc[p]) || 0) + update.$inc[p]));
      return { matchedCount: doc ? 1 : 0 };
    },
    find(q) {
      const list = docs.filter((d) => matches(d, q));
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        async toArray() {
          return list;
        },
      };
    },
  };
}
function makeDb(c) {
  return { collection: (n) => c[n] || (c[n] = makeCollection()) };
}

const BRANCH = '6500000000000000000000b1';
const CUST = '6500000000000000000000c1';
const SALE = '650000000000000000000501';

function enabledSettings(over = {}) {
  return makeCollection([
    {
      license: 'lic-test',
      branch_id: new ObjectId(BRANCH),
      enabled: true,
      percent: 10,
      min_spend: 0,
      max_cashback: 0,
      validity_days: 30,
      min_redeem_spend: 0,
      bind_to_customer: false,
      deliver_channel: 'whatsapp',
      currency: '₹',
      ...over,
    },
  ]);
}
function saleDoc(over = {}) {
  return {
    _id: new ObjectId(SALE),
    sales_id: 'SID-1',
    sales_total: 1000,
    customer_id: new ObjectId(CUST),
    customer_name: 'Asha',
    customer_phone: '+919812345678',
    ...over,
  };
}

describe('CashbackService.issueForSale', () => {
  let svc;
  beforeEach(() => {
    svc = new CashbackService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('mints a single-use fixed coupon with an expiry and logs the issue', async () => {
    const coupons = makeCollection([]);
    const issues = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ cashback_settings: enabledSettings(), coupons, cashback_issues: issues })
      );

    const r = await svc.issueForSale(saleDoc(), { ctx: { branchId: BRANCH, branchName: 'Store' } });
    expect(r.data.issued).toBe(1);
    expect(r.data.amount).toBe(100); // 10% of 1000
    expect(coupons._docs).toHaveLength(1);
    const c = coupons._docs[0];
    expect(c.type).toBe('fixed');
    expect(c.value).toBe(100);
    expect(c.usage_limit).toBe(1);
    expect(c.end_date instanceof Date).toBe(true);
    expect(issues._docs).toHaveLength(1);
    expect(issues._docs[0].delivered).toBe(true); // whatsapp mock returned ok
  });

  test('is idempotent per sale - a retry issues nothing new', async () => {
    const coupons = makeCollection([]);
    const issues = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ cashback_settings: enabledSettings(), coupons, cashback_issues: issues })
      );

    await svc.issueForSale(saleDoc(), { ctx: { branchId: BRANCH } });
    const second = await svc.issueForSale(saleDoc(), { ctx: { branchId: BRANCH } });
    expect(second.data.duplicate).toBe(true);
    expect(coupons._docs).toHaveLength(1);
    expect(issues._docs).toHaveLength(1);
  });

  test('issues nothing when disabled or below min spend', async () => {
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        cashback_settings: enabledSettings({ enabled: false }),
        coupons: makeCollection([]),
        cashback_issues: makeCollection([]),
      })
    );
    expect((await svc.issueForSale(saleDoc(), { ctx: { branchId: BRANCH } })).data.issued).toBe(0);

    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        cashback_settings: enabledSettings({ min_spend: 5000 }),
        coupons: makeCollection([]),
        cashback_issues: makeCollection([]),
      })
    );
    expect((await svc.issueForSale(saleDoc(), { ctx: { branchId: BRANCH } })).data.issued).toBe(0);
  });
});

describe('CashbackService.reverseForSale', () => {
  let svc;
  beforeEach(() => {
    svc = new CashbackService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('deactivates the coupon and voids the issue', async () => {
    const couponId = new ObjectId();
    const coupons = makeCollection([
      { _id: couponId, license: 'lic-test', code: 'CBTEST1', active: true },
    ]);
    const issues = makeCollection([
      {
        _id: new ObjectId(),
        sale_id: new ObjectId(SALE),
        license: 'lic-test',
        coupon_id: couponId,
        voided: false,
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ coupons, cashback_issues: issues }));

    const r = await svc.reverseForSale(SALE);
    expect(r.data.reversed).toBe(1);
    expect(coupons._docs[0].active).toBe(false);
    expect(issues._docs[0].voided).toBe(true);
  });

  test('does nothing when the sale minted no cashback', async () => {
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ coupons: makeCollection([]), cashback_issues: makeCollection([]) })
      );
    const r = await svc.reverseForSale(SALE);
    expect(r.data.reversed).toBe(0);
  });
});
