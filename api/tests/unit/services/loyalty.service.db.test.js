'use strict';

/*
 * Integration-style tests for the loyalty engine's DB-touching methods, using a
 * small in-memory Mongo stand-in (the same convention the repository tests use:
 * replace BaseModel.getDb with a fake). The pure maths lives in
 * loyalty.service.test.js; here we prove the ledger and the customer wallet move
 * together and, above all, that earning and redeeming are idempotent per sale so
 * a retry can never double-credit or double-spend a customer's points.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const LoyaltyService = require('../../../src/services/loyalty.service');
const { LEDGER_TYPE } = require('../../../src/constants/loyalty.constants');

// Dotted-path helpers so updateOne can honour { $inc: { 'loyalty.points': n } }.
function setDotted(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function getDotted(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function matches(doc, query) {
  return Object.keys(query).every((k) => {
    const qv = query[k];
    const dv = doc[k];
    if (qv && typeof qv === 'object' && !(qv instanceof ObjectId)) {
      if ('$in' in qv) return qv.$in.map(String).includes(String(dv));
      if ('$gt' in qv) return Number(dv) > Number(qv.$gt);
    }
    return String(dv) === String(qv);
  });
}

function makeCollection(seed = [], aggregateResult = null) {
  const docs = seed.map((d) => ({ ...d }));
  return {
    _docs: docs,
    async findOne(query) {
      return docs.find((d) => matches(d, query)) || null;
    },
    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id || new ObjectId() };
    },
    async updateOne(query, update) {
      let doc = docs.find((d) => matches(d, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.keys(update.$set).forEach((p) => setDotted(doc, p, update.$set[p]));
      if (update.$inc)
        Object.keys(update.$inc).forEach((p) =>
          setDotted(doc, p, (Number(getDotted(doc, p)) || 0) + update.$inc[p])
        );
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find(query) {
      let result = docs.filter((d) => matches(d, query));
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        async toArray() {
          return result;
        },
      };
    },
    aggregate() {
      return {
        async toArray() {
          return aggregateResult || [];
        },
      };
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

const CUST_ID = '64b111111111111111111111';
const SALE_ID = '64b222222222222222222222';

const enabledCfg = {
  enabled: true,
  earn_points: 1,
  earn_amount: 100, // 1 point per 100 spent
  min_spend: 0,
  earn_rounding: 'floor',
  redeem_points: 1,
  redeem_value: 1,
  tiers: [
    { name: 'Bronze', threshold: 0, multiplier: 1 },
    { name: 'Gold', threshold: 5000, multiplier: 2 },
  ],
};

describe('LoyaltyService.earn (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new LoyaltyService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('credits the wallet and writes one EARN ledger row', async () => {
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST_ID),
        license: 'lic-test',
        name: 'Asha',
        loyalty: { points: 0, pointsEarned: 0 },
      },
    ]);
    const ledger = makeCollection([]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger }));

    const r = await svc.earn(CUST_ID, { amount: 1000, saleId: SALE_ID, config: enabledCfg });
    expect(r.status).toBe(true);
    expect(r.data.points).toBe(10); // 1000 / 100
    expect(customers._docs[0].loyalty.points).toBe(10);
    expect(customers._docs[0].loyalty.pointsEarned).toBe(10);
    const earnRows = ledger._docs.filter((e) => e.type === LEDGER_TYPE.EARN);
    expect(earnRows).toHaveLength(1);
    expect(earnRows[0].points).toBe(10);
  });

  test('is idempotent per sale - a retry does not credit twice', async () => {
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST_ID),
        license: 'lic-test',
        name: 'Asha',
        loyalty: { points: 0, pointsEarned: 0 },
      },
    ]);
    const ledger = makeCollection([]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger }));

    await svc.earn(CUST_ID, { amount: 1000, saleId: SALE_ID, config: enabledCfg });
    const second = await svc.earn(CUST_ID, { amount: 1000, saleId: SALE_ID, config: enabledCfg });

    expect(second.data.duplicate).toBe(true);
    expect(customers._docs[0].loyalty.points).toBe(10); // still 10, not 20
    expect(ledger._docs.filter((e) => e.type === LEDGER_TYPE.EARN)).toHaveLength(1);
  });
});

describe('LoyaltyService.applyRedeemPoints (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new LoyaltyService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('debits the wallet by the decided points and ledgers the spend', async () => {
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST_ID),
        license: 'lic-test',
        name: 'Asha',
        loyalty: { points: 50, pointsRedeemed: 0 },
      },
    ]);
    const ledger = makeCollection([]);
    const config = makeCollection([]); // getConfig -> defaults (currency only)
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger, loyalty_config: config }));

    const r = await svc.applyRedeemPoints(CUST_ID, { points: 30, value: 30, saleId: SALE_ID });
    expect(r.status).toBe(true);
    expect(customers._docs[0].loyalty.points).toBe(20);
    expect(customers._docs[0].loyalty.pointsRedeemed).toBe(30);
    const redeemRows = ledger._docs.filter((e) => e.type === LEDGER_TYPE.REDEEM);
    expect(redeemRows).toHaveLength(1);
    expect(redeemRows[0].points).toBe(-30);
  });

  test('is idempotent per sale - a retry does not spend twice', async () => {
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST_ID),
        license: 'lic-test',
        name: 'Asha',
        loyalty: { points: 50, pointsRedeemed: 0 },
      },
    ]);
    const ledger = makeCollection([]);
    const config = makeCollection([]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger, loyalty_config: config }));

    await svc.applyRedeemPoints(CUST_ID, { points: 30, value: 30, saleId: SALE_ID });
    const second = await svc.applyRedeemPoints(CUST_ID, { points: 30, value: 30, saleId: SALE_ID });

    expect(second.data.duplicate).toBe(true);
    expect(customers._docs[0].loyalty.points).toBe(20); // still 20, not -10
  });
});

describe('LoyaltyService.reverse (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new LoyaltyService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('puts earned points back and returns spent points, per sale', async () => {
    // Sale earned 10 and redeemed 30; wallet reflects both.
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST_ID),
        license: 'lic-test',
        name: 'Asha',
        loyalty: { points: 80, pointsEarned: 10, pointsRedeemed: 30 },
      },
    ]);
    const ledger = makeCollection([
      {
        sale_id: new ObjectId(SALE_ID),
        license: 'lic-test',
        type: LEDGER_TYPE.EARN,
        points: 10,
        customer_id: new ObjectId(CUST_ID),
        value: 0,
      },
      {
        sale_id: new ObjectId(SALE_ID),
        license: 'lic-test',
        type: LEDGER_TYPE.REDEEM,
        points: -30,
        customer_id: new ObjectId(CUST_ID),
        value: 30,
      },
    ]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger }));

    const r = await svc.reverse(SALE_ID);
    expect(r.status).toBe(true);
    expect(r.data.reversed).toBe(2);
    // earn reversed: -10 ; redeem reversed: +30 => net +20 on 80 => 100
    expect(customers._docs[0].loyalty.points).toBe(100);
    expect(ledger._docs.filter((e) => e.type === LEDGER_TYPE.REVERSE)).toHaveLength(2);
  });

  test('does nothing when the sale has no loyalty rows', async () => {
    const customers = makeCollection([]);
    const ledger = makeCollection([]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger }));
    const r = await svc.reverse(SALE_ID);
    expect(r.status).toBe(true);
    expect(r.data.reversed).toBe(0);
  });
});

describe('LoyaltyService.liability (DB)', () => {
  let svc;
  beforeEach(() => {
    svc = new LoyaltyService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('values outstanding points at the branch redeem rate', async () => {
    // Config: 1 point = 2 units, so per-point value is 2.
    const config = makeCollection([
      { license: 'lic-test', enabled: true, redeem_points: 1, redeem_value: 2, currency: '$' },
    ]);
    const customers = makeCollection(
      [],
      [
        { _id: 'Gold', members: 2, points: 1000 },
        { _id: 'Bronze', members: 5, points: 200 },
      ]
    );
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_config: config }));

    const r = await svc.liability();
    expect(r.status).toBe(true);
    expect(r.data.members).toBe(7);
    expect(r.data.totalPoints).toBe(1200);
    expect(r.data.valuePerPoint).toBe(2);
    expect(r.data.totalValue).toBe(2400); // 1200 * 2
    expect(r.data.byTier.find((t) => t.tier === 'Gold').value).toBe(2000);
  });
});

describe('LoyaltyService.grantReferralIfEligible (DB)', () => {
  const REFEREE = '64b333333333333333333333';
  const REFERRER = '64b444444444444444444444';
  const referralCfg = {
    referral_enabled: true,
    referral_referrer_points: 50,
    referral_referee_points: 20,
    referral_min_spend: 100,
  };
  let svc;
  beforeEach(() => {
    svc = new LoyaltyService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  function seed() {
    const customers = makeCollection([
      {
        _id: new ObjectId(REFEREE),
        license: 'lic-test',
        name: 'Bob',
        referrer_id: new ObjectId(REFERRER),
        loyalty: { points: 0, pointsEarned: 0 },
      },
      {
        _id: new ObjectId(REFERRER),
        license: 'lic-test',
        name: 'Alice',
        loyalty: { points: 0, pointsEarned: 0 },
      },
    ]);
    const ledger = makeCollection([]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ customers, loyalty_ledger: ledger }));
    return { customers, ledger };
  }

  test('rewards both sides on a qualifying first purchase, once', async () => {
    const { customers } = seed();
    const r = await svc.grantReferralIfEligible(REFEREE, { amount: 500, config: referralCfg });
    expect(r.data.granted).toBe(70);
    const bob = customers._docs.find((c) => String(c._id) === REFEREE);
    const alice = customers._docs.find((c) => String(c._id) === REFERRER);
    expect(bob.loyalty.points).toBe(20);
    expect(bob.loyalty.referral_rewarded).toBe(true);
    expect(alice.loyalty.points).toBe(50);

    // A second sale must not reward again.
    const again = await svc.grantReferralIfEligible(REFEREE, { amount: 500, config: referralCfg });
    expect(again.data.duplicate).toBe(true);
    expect(bob.loyalty.points).toBe(20);
    expect(alice.loyalty.points).toBe(50);
  });

  test('does not reward below the referral minimum spend', async () => {
    const { customers } = seed();
    const r = await svc.grantReferralIfEligible(REFEREE, { amount: 50, config: referralCfg });
    expect(r.data.granted).toBe(0);
    const bob = customers._docs.find((c) => String(c._id) === REFEREE);
    expect(bob.loyalty.points).toBe(0);
    expect(bob.loyalty.referral_rewarded).toBeUndefined(); // still claimable later
  });

  test('does nothing when the customer has no referrer', async () => {
    const customers = makeCollection([
      { _id: new ObjectId(REFEREE), license: 'lic-test', name: 'Bob', loyalty: { points: 0 } },
    ]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(makeDb({ customers, loyalty_ledger: makeCollection([]) }));
    const r = await svc.grantReferralIfEligible(REFEREE, { amount: 500, config: referralCfg });
    expect(r.data.granted).toBe(0);
  });

  test('does nothing when referrals are disabled', async () => {
    seed();
    const r = await svc.grantReferralIfEligible(REFEREE, {
      amount: 500,
      config: { ...referralCfg, referral_enabled: false },
    });
    expect(r.data.granted).toBe(0);
  });
});
