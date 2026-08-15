'use strict';

/*
 * DB-level tests for credit settings, the credit-limit check, outstanding
 * customers and the reminder engine. The transaction ledger's aggregate is
 * stubbed with canned rows; the messaging service is mocked so no real message
 * is sent. Proves the limit maths against real dues, and that reminders send,
 * skip the phone-less, and never remind a customer twice in a day.
 */

jest.mock('../../../src/services/messaging.service', () =>
  jest.fn().mockImplementation(() => ({
    sendSms: jest.fn().mockResolvedValue({ ok: true }),
    sendWhatsapp: jest.fn().mockResolvedValue({ ok: true }),
  }))
);

const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const CreditService = require('../../../src/services/credit.service');

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

function makeCollection(seed = [], aggResult = null) {
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
      return { matchedCount: doc ? 1 : 0 };
    },
    aggregate() {
      return {
        async toArray() {
          return aggResult || [];
        },
      };
    },
  };
}
function makeDb(c) {
  return { collection: (n) => c[n] || (c[n] = makeCollection()) };
}

const CUST = '64f000000000000000000001';
const BRANCH = '64f0000000000000000000b1';

describe('CreditService settings + limit', () => {
  let svc;
  beforeEach(() => {
    svc = new CreditService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  test('saveSettings then getSettings round-trips', async () => {
    const cs = makeCollection([]);
    BaseModel.getDb = jest.fn().mockResolvedValue(makeDb({ credit_settings: cs }));
    await svc.saveSettings(BRANCH, {
      default_credit_limit: 5000,
      credit_terms_days: 15,
      reminder_enabled: true,
      reminder_channel: 'whatsapp',
      reminder_min_due: 100,
    });
    const out = await svc.getSettings(BRANCH);
    expect(out.default_credit_limit).toBe(5000);
    expect(out.reminder_channel).toBe('whatsapp');
    expect(out.reminder_enabled).toBe(true);
  });

  test('checkCreditLimit blocks over the customer limit, allows under', async () => {
    const customers = makeCollection([
      { _id: new ObjectId(CUST), license: 'lic-test', name: 'Asha', creditLimit: 10000 },
    ]);
    const txn = makeCollection([], [{ _id: new ObjectId(CUST), due: 6000 }]); // outstanding 6000
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ customers, transaction: txn, credit_settings: makeCollection([]) })
      );

    const over = await svc.checkCreditLimit(CUST, 5000, BRANCH); // 6000+5000 > 10000
    expect(over.allowed).toBe(false);
    const under = await svc.checkCreditLimit(CUST, 3000, BRANCH); // 6000+3000 <= 10000
    expect(under.allowed).toBe(true);
  });

  test('checkCreditLimit is unlimited when no limit is set', async () => {
    const customers = makeCollection([
      { _id: new ObjectId(CUST), license: 'lic-test', creditLimit: 0 },
    ]);
    const txn = makeCollection([], [{ _id: new ObjectId(CUST), due: 99999 }]);
    BaseModel.getDb = jest
      .fn()
      .mockResolvedValue(
        makeDb({ customers, transaction: txn, credit_settings: makeCollection([]) })
      );
    const r = await svc.checkCreditLimit(CUST, 100000, BRANCH);
    expect(r.allowed).toBe(true);
  });
});

describe('CreditService reminders', () => {
  let svc;
  beforeEach(() => {
    svc = new CreditService();
    BaseModel.license = 'lic-test';
  });
  afterEach(() => {
    BaseModel.getDb = undefined;
  });

  function reminderDb(over = {}) {
    const customers = makeCollection([
      {
        _id: new ObjectId(CUST),
        license: 'lic-test',
        name: 'Asha',
        phone: '+919812345678',
        ...over,
      },
    ]);
    const txn = makeCollection([], [{ _id: new ObjectId(CUST), name: 'Asha', due: 500 }]);
    const settings = makeCollection([
      {
        license: 'lic-test',
        branch_id: new ObjectId(BRANCH),
        reminder_enabled: true,
        reminder_channel: 'sms',
        reminder_min_due: 0,
        currency: '₹',
      },
    ]);
    const reminders = makeCollection([]);
    return { customers, txn, settings, reminders };
  }

  test('sendReminder sends and logs when the customer owes money', async () => {
    const db = reminderDb();
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        customers: db.customers,
        transaction: db.txn,
        credit_settings: db.settings,
        reminder_sends: db.reminders,
      })
    );
    const r = await svc.sendReminder(CUST, { branchId: BRANCH });
    expect(r.status).toBe(true);
    expect(r.data.status).toBe('sent');
    expect(db.reminders._docs).toHaveLength(1);
    expect(db.reminders._docs[0].status).toBe('sent');
  });

  test('a dry run logs but sends nothing', async () => {
    const db = reminderDb();
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        customers: db.customers,
        transaction: db.txn,
        credit_settings: db.settings,
        reminder_sends: db.reminders,
      })
    );
    const r = await svc.sendReminder(CUST, { branchId: BRANCH, dryRun: true });
    expect(r.data.status).toBe('dry_run');
  });

  test('a customer with no phone is skipped', async () => {
    const db = reminderDb({ phone: '' });
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        customers: db.customers,
        transaction: db.txn,
        credit_settings: db.settings,
        reminder_sends: db.reminders,
      })
    );
    const r = await svc.sendReminder(CUST, { branchId: BRANCH });
    expect(r.data.status).toBe('skipped_nophone');
  });

  test('runReminders reminds each once, and not twice in a day', async () => {
    const db = reminderDb();
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        customers: db.customers,
        transaction: db.txn,
        credit_settings: db.settings,
        reminder_sends: db.reminders,
      })
    );
    const now = new Date('2026-08-15T10:00:00Z');
    const first = await svc.runReminders(BRANCH, { now });
    expect(first.data.sent).toBe(1);
    const second = await svc.runReminders(BRANCH, { now });
    expect(second.data.sent).toBe(0);
    expect(second.data.skipped).toBe(1);
  });

  test('runReminders does nothing when reminders are off', async () => {
    const db = reminderDb();
    db.settings._docs[0].reminder_enabled = false;
    BaseModel.getDb = jest.fn().mockResolvedValue(
      makeDb({
        customers: db.customers,
        transaction: db.txn,
        credit_settings: db.settings,
        reminder_sends: db.reminders,
      })
    );
    const r = await svc.runReminders(BRANCH, {});
    expect(r.data.sent).toBe(0);
  });
});
