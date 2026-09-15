'use strict';

/*
 * The year on a bill number, and the moment it turns over.
 *
 * Owner: "we need year pattern required in the sales bill number example
 * attached have 26 in the year. and then number increasing would be okay. you
 * suggest per day increase or year wise reset better tell me international
 * standards." And on the answer: "i accept recommandation and may configurable
 * if people from EU and international."
 *
 * The rule everything here obeys is CGST Rule 46(b): a consecutive serial
 * number, NOT EXCEEDING SIXTEEN CHARACTERS, of letters, digits, "-" and "/",
 * UNIQUE FOR A FINANCIAL YEAR. utils/bill-number.js holds the shape of a legal
 * number and is tested on its own. This is about the two things only the
 * repository can get wrong:
 *
 *   1. WHEN the counter starts again, which is one atomic step against a real
 *      database rather than a read, a compare and a write. A year turns over
 *      at midnight in a restaurant that is still serving, and two tills billing
 *      in that second must not both be given number one.
 *
 *   2. WHOSE MIDNIGHT it is. A bill rung up at half past midnight on the first
 *      of April in Chennai belongs to the new financial year; a cloud instance
 *      running in UTC would still call it March.
 *
 * Run against a real mongod, because the roll-over is an aggregation pipeline
 * update and a mock of one would only prove that I can write down what I
 * already believe.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();

const shop = (over = {}) => ({
  _id: BRANCH,
  license: LICENSE,
  sales_prefix: 'S',
  time_zone: 'Asia/Kolkata',
  ...over,
});

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  db = mongoose.connection.db;
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await db.collection('counters').deleteMany({});
  await db.collection('sales').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('device_meta').deleteMany({});
  await db.collection('branches').insertOne(shop());
  /* The gateway-assigned till code, which is what makes SB1D14. */
  await db.collection('device_meta').insertOne({ _id: 'device_code', code: 'D14' });
  repo.constructor._branchCodes = undefined;
  repo.constructor._deviceCode = undefined;
  repo.constructor._deviceTag = undefined;
  repo.constructor._countersIndexEnsured = false;
});

afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------ whose midnight */

describe('which year a bill belongs to', () => {
  const on = (iso, over = {}) => repo._billPeriod(shop(over), new Date(iso));

  test('A SHOP THAT HAS NOT ASKED HAS NO PERIOD AT ALL', () => {
    /* Every shop in the estate, until somebody turns it on. An empty period
       produces exactly the number this produced before any of it existed. */
    expect(on('2026-09-16T10:00:00Z')).toEqual({ key: '', label: '', mode: 'off' });
    expect(on('2026-09-16T10:00:00Z', { bill_number_reset: '' }).mode).toBe('off');
    expect(on('2026-09-16T10:00:00Z', { bill_number_reset: 'off' }).mode).toBe('off');
  });

  test('a value nobody recognises is off, not a guess', () => {
    /* A form posts strings. "Financial" with a capital, or a value from a
       newer build, must never restart a shop's invoice series. */
    expect(on('2026-09-16T10:00:00Z', { bill_number_reset: 'yearly' }).mode).toBe('off');
    expect(on('2026-09-16T10:00:00Z', { bill_number_reset: 'Financial' }).mode).toBe('off');
  });

  test("THE INDIAN FINANCIAL YEAR TURNS OVER IN THE SHOP'S OWN MIDNIGHT", () => {
    /*
     * 2026-03-31T18:31:00Z is 2026-04-01T00:01 in Chennai. On the server's
     * clock that bill is still March and belongs to the year that closed an
     * hour ago - a bill numbered into a financial year that has ended, which
     * is the kind of thing an auditor finds rather than a test.
     */
    const india = { bill_number_reset: 'financial' };
    expect(on('2026-03-31T18:29:00Z', india).key).toBe('2025-2026');
    expect(on('2026-03-31T18:31:00Z', india).key).toBe('2026-2027');
  });

  test('and a shop in another zone turns over on its own clock', () => {
    const london = { bill_number_reset: 'financial', time_zone: 'Europe/London' };
    /* 23:00 UTC on 31 March is still 31 March in London (BST, so midnight). */
    expect(on('2026-03-31T22:00:00Z', london).key).toBe('2025-2026');
    expect(on('2026-04-01T09:00:00Z', london).key).toBe('2026-2027');
  });

  test('the label is the year the financial year ENDS in, which is how India says it', () => {
    /* "FY27" in India means April 2026 to March 2027. Two characters, because
       two characters buys four more digits of running number on a sixteen
       character budget. */
    expect(on('2026-09-16T10:00:00Z', { bill_number_reset: 'financial' }).label).toBe('27');
    expect(on('2027-02-16T10:00:00Z', { bill_number_reset: 'financial' }).label).toBe('27');
    expect(on('2027-04-16T10:00:00Z', { bill_number_reset: 'financial' }).label).toBe('28');
  });

  test('a shop on the calendar year gets the calendar year', () => {
    const eu = { bill_number_reset: 'calendar', time_zone: 'Europe/Berlin' };
    expect(on('2026-09-16T10:00:00Z', eu)).toMatchObject({ key: '2026', label: '26' });
    expect(on('2026-12-31T23:30:00Z', eu).key).toBe('2027');
  });

  test('a shop can start its financial year in any month', () => {
    const uk = { bill_number_reset: 'financial', bill_number_fy_start_month: 1 };
    expect(on('2026-03-16T10:00:00Z', uk).key).toBe('2026-2027');
  });

  test('A TIME ZONE NOBODY CAN READ DOES NOT STOP A SHOP BILLING', () => {
    /* Off is what every shop had before this existed, and a shop that cannot
       bill is a shop that cannot trade. */
    const broken = { bill_number_reset: 'financial', time_zone: 'Mars/Olympus_Mons' };
    expect(() => on('2026-09-16T10:00:00Z', broken)).not.toThrow();
    /* And whatever it decides, it is a period a legal number can be built
       from: two digits or nothing, never an Invalid Date turned into text. */
    const said = on('2026-09-16T10:00:00Z', broken);
    expect(said.label).toMatch(/^(\d\d)?$/);
    expect(said.key === '' || /^\d{4}(-\d{4})?$/.test(said.key)).toBe(true);
  });
});

/* -------------------------------------------------- the counter itself */

describe('when the counter starts again', () => {
  const next = (period) => repo.nextSalesNumberForBranch(BRANCH, LICENSE, { period });

  test('A COUNTER WRITTEN BEFORE ANY OF THIS KEEPS COUNTING', () => {
    /*
     * The one that matters on merge day. Every counter in the estate was
     * written without a period_key; if an absent field read as a mismatch,
     * the first bill on every shop would restart at one and collide with a
     * number the shop had already issued.
     */
    return db
      .collection('counters')
      .insertOne({
        kind: 'sales_id',
        branch_key: String(BRANCH),
        license_key: String(LICENSE),
        seq: 41,
      })
      .then(async () => {
        expect(await next({ key: '', label: '' })).toBe(42);
        expect(await next({ key: '', label: '' })).toBe(43);
      });
  });

  test('turning the year on starts a new series at one', async () => {
    await db.collection('counters').insertOne({
      kind: 'sales_id',
      branch_key: String(BRANCH),
      license_key: String(LICENSE),
      seq: 900,
    });
    expect(await next({ key: '2026-2027', label: '27' })).toBe(1);
    expect(await next({ key: '2026-2027', label: '27' })).toBe(2);
  });

  test('AND THE YEAR TURNING OVER DOES THE SAME, without a second counter', async () => {
    expect(await next({ key: '2026-2027', label: '27' })).toBe(1);
    expect(await next({ key: '2026-2027', label: '27' })).toBe(2);
    expect(await next({ key: '2027-2028', label: '28' })).toBe(1);
    expect(await next({ key: '2027-2028', label: '28' })).toBe(2);
    /* One row, because the unique index on this collection allows exactly
       one per branch and licence. */
    const rows = await db.collection('counters').find({ kind: 'sales_id' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].period_key).toBe('2027-2028');
  });

  test('TWO TILLS BILLING IN THE SAME SECOND GET DIFFERENT NUMBERS', async () => {
    /*
     * The reason the roll-over is one pipeline update rather than a read, a
     * compare and a write. Midnight on the first of April is a restaurant
     * still serving, and two numbers that are both 1 is two bills that are
     * both SB1D14-28-000001.
     */
    const got = await Promise.all(
      Array.from({ length: 12 }, () => next({ key: '2027-2028', label: '28' }))
    );
    expect(new Set(got).size).toBe(12);
    expect(Math.min(...got)).toBe(1);
    expect(Math.max(...got)).toBe(12);
  });

  test('a counter that has fallen behind catches up WITHIN its own year', async () => {
    /*
     * The recovery path, after a number came back taken. Last year's numbers
     * are higher than this year's and are not this year's problem: catching
     * up to them would jump the series from 4 to 901, which is a gap somebody
     * asks about.
     */
    await db.collection('sales').insertMany([
      { branch_id: BRANCH, license: LICENSE, sales_id: 'SB1D14-27-000900' },
      { branch_id: BRANCH, license: LICENSE, sales_id: 'SB1D14-28-000004' },
    ]);
    await db.collection('counters').insertOne({
      kind: 'sales_id',
      branch_key: String(BRANCH),
      license_key: String(LICENSE),
      seq: 2,
      period_key: '2027-2028',
    });

    expect(
      await repo.nextSalesNumberForBranch(BRANCH, LICENSE, {
        reseed: true,
        period: { key: '2027-2028', label: '28' },
      })
    ).toBe(5);
  });

  test('and with no year set it still catches up to everything', async () => {
    await db.collection('sales').insertMany([
      { branch_id: BRANCH, license: LICENSE, sales_id: 'SB1D14-000027' },
      { branch_id: BRANCH, license: LICENSE, sales_id: 'SB1D14-000009' },
    ]);
    await db.collection('counters').insertOne({
      kind: 'sales_id',
      branch_key: String(BRANCH),
      license_key: String(LICENSE),
      seq: 5,
    });
    expect(
      await repo.nextSalesNumberForBranch(BRANCH, LICENSE, {
        reseed: true,
        period: { key: '', label: '' },
      })
    ).toBe(28);
  });
});

/* ------------------------------------------------- the number it makes */

describe('the number a shop hands over', () => {
  test('A SHOP THAT HAS NOT ASKED GETS EXACTLY WHAT IT GOT BEFORE', async () => {
    expect(await repo.generateSalesIdForBranch(BRANCH)).toBe('SB1D14-000001');
    expect(await repo.generateSalesIdForBranch(BRANCH)).toBe('SB1D14-000002');
  });

  test('and a shop that asked for the year gets it, inside sixteen characters', async () => {
    await db
      .collection('branches')
      .updateOne({ _id: BRANCH }, { $set: { bill_number_reset: 'financial' } });
    const number = await repo.generateSalesIdForBranch(BRANCH);
    expect(number).toMatch(/^SB1D14-\d\d-000001$/);
    expect(number.length).toBe(16);
    /* Rule 46(b) again: letters, digits, hyphen and slash, and nothing else. */
    expect(number).toMatch(/^[A-Za-z0-9/-]+$/);
  });

  test('THE SIXTEEN CHARACTERS HOLD EVEN WHEN THE SHOP HAS LONG CODES', async () => {
    /*
     * A sixteen-character ceiling is not a guideline: a longer number is an
     * invoice that does not comply. Something has to give, and it is the
     * padding on the running number - never the year, which uniqueness
     * depends on, and never the till code, without which two tills mint the
     * same number.
     */
    await db
      .collection('device_meta')
      .updateOne({ _id: 'device_code' }, { $set: { code: 'DEVICE99' } });
    repo.constructor._deviceCode = undefined;
    await db
      .collection('branches')
      .updateOne({ _id: BRANCH }, { $set: { bill_number_reset: 'calendar' } });

    const number = await repo.generateSalesIdForBranch(BRANCH);
    expect(number.length).toBeLessThanOrEqual(16);
    expect(number).toContain('DEVICE99');
    expect(number).toMatch(/\d\d-\d+$/);
  });
});
