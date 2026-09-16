'use strict';

/*
 * A DISH SOLD AT TODAY'S PRICE.
 *
 * Owner, from a live table at a client: two fish went out worth nothing.
 * "zero price items are actually dyanmic pricing. its based current price. so
 * if you find that kind of item we need to allow captain to update the price
 * and give order."
 *
 * Whole fish, crab, lobster. The shop cannot print a number on the card
 * because it does not know one until the morning's market, so the catalogue
 * carries no selling price - and every layer below took that literally. The
 * handset showed 0.00, the order was accepted, the kitchen cooked it, and the
 * bill came to nothing.
 *
 * The fix cannot live in the app: `_priceOnlineLine` prices from the ITEM
 * DOCUMENT and ignores whatever the client sent, which is right - a caller
 * that can name its own price can buy a biryani for one rupee. So the door
 * opens exactly as far as it must: only for a dish the shop has deliberately
 * left unpriced.
 *
 * These are the rules that keep that door from being a hole.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  /*
   * Mongoose's own connection, not BaseModel.getDb().
   *
   * `_priceOnlineLine` is given the items collection as an argument and never
   * opens one, which is what makes it testable at all - reaching for BaseModel
   * here would drag in the whole per-shop connection machinery to look up one
   * document.
   */
  db = mongoose.connection.db;
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await db.collection('items').deleteMany({});
});

/** An item as the catalogue holds it. */
async function anItem(over = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Tandoori Pomfret',
    selling_price: 0,
    tax: 0,
    tax_type: 'exclusive',
    branch_id: BRANCH,
    ...over,
  };
  await db.collection('items').insertOne(doc);
  return doc;
}

/** What the pricer needs around it, with nothing clever in the way. */
const around = () => ({
  itemCollection: db.collection('items'),
  branchDoc: { _id: BRANCH, license: null },
  branchObjectId: BRANCH,
  servingPeriods: [],
  orderDay: 1,
  orderMinutes: 12 * 60,
  servicePoint: { venue: null },
});

const price = (item, line) => repo._priceOnlineLine(line, around(item));

describe('a dish the shop prices on the day', () => {
  test("takes the waiter's price when the catalogue has none", async () => {
    const doc = await anItem({ selling_price: 0 });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 850,
    });

    expect(out.status).not.toBe(false);
    expect(out.line.unit_price).toBe(850);
    expect(out.line.total).toBe(850);
  });

  test('takes it when the shop marked the item open_price, even with a price set', async () => {
    /* A shop that prints an indicative number on the card and still charges
       the day's rate. The flag is the shop saying so. */
    const doc = await anItem({ selling_price: 500, open_price: true });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 900,
    });

    expect(out.line.unit_price).toBe(900);
  });

  test('is refused rather than sold for nothing', async () => {
    /*
     * The bug itself. An order with no price used to be accepted, cooked, and
     * billed at zero - which is how this was found, on a real table.
     */
    const doc = await anItem({ selling_price: 0 });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).toBe(false);
    expect(out.data.state).toBe('item_needs_price');
    expect(out.message).toMatch(/priced on the day/i);
  });

  test('a zero or a negative price is refused too', async () => {
    const doc = await anItem({ selling_price: 0 });

    for (const asked of [0, -1, -850]) {
      const out = await price(doc, {
        item_id: String(doc._id),
        item_quantity: 1,
        unit_price: asked,
      });
      expect(out.status).toBe(false);
    }
  });

  test('a fat finger is refused, not charged', async () => {
    /* The likeliest way a wrong number gets here is a phone keyboard, and ten
       lakh for a fish should not be accepted quietly. */
    const doc = await anItem({ selling_price: 0 });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 9999999,
    });

    expect(out.status).toBe(false);
    expect(out.data.state).toBe('item_price_too_high');
  });

  test('nonsense is refused rather than becoming NaN on a bill', async () => {
    const doc = await anItem({ selling_price: 0 });

    for (const asked of ['', 'abc', null, {}]) {
      const out = await price(doc, {
        item_id: String(doc._id),
        item_quantity: 1,
        unit_price: asked,
      });
      expect(out.status).toBe(false);
    }
  });
});

describe('the trading day, which starts at seven', () => {
  /*
   * Owner: "daily price starts in the morning only. means 7am. not midnight
   * coz up to 1am restaurant might open."
   *
   * A calendar day expires a shop's prices in the middle of its service. These
   * are the hours that actually decide it, with the clock held still so the
   * suite does not answer differently depending on when it runs - which it did:
   * a test written as "two hours ago" went red at one in the morning.
   */
  const at = (iso) => new Date(iso);
  let clock;

  const freeze = (iso) => {
    clock = jest
      .spyOn(global, 'Date')
      .mockImplementation((...args) => (args.length ? new RealDate(...args) : new RealDate(iso)));
    global.Date.now = () => new RealDate(iso).getTime();
    global.Date.parse = RealDate.parse;
    global.Date.UTC = RealDate.UTC;
  };

  const RealDate = Date;

  afterEach(() => {
    if (clock) clock.mockRestore();
    clock = null;
  });

  const priceable = async (setOn) => {
    const doc = await anItem({ selling_price: 900, daily_price: true, price_set_on: setOn });
    return price(doc, { item_id: String(doc._id), item_quantity: 1 });
  };

  test('a price set at eleven is still the price at eleven at night', async () => {
    freeze('2026-09-14T17:30:00Z'); /* 23:00 IST */
    const out = await priceable(at('2026-09-14T05:30:00Z')); /* 11:00 IST */
    expect(out.status).not.toBe(false);
    expect(out.line.unit_price).toBe(900);
  });

  test('and still the price at half past midnight, mid service', async () => {
    /*
     * THE CASE THIS EXISTS FOR. On a calendar day the shop's own prices expire
     * here - every fish reads as yesterday's while the kitchen is still
     * cooking, and the till refuses them until somebody retypes the lot.
     */
    freeze('2026-09-14T19:00:00Z'); /* 00:30 IST on the 15th */
    const out = await priceable(at('2026-09-14T05:30:00Z')); /* 11:00 IST on the 14th */
    expect(out.status).not.toBe(false);
    expect(out.line.unit_price).toBe(900);
  });

  test('at half past six in the morning it is still yesterday, just', async () => {
    freeze('2026-09-15T01:00:00Z'); /* 06:30 IST */
    const out = await priceable(at('2026-09-14T05:30:00Z'));
    expect(out.status).not.toBe(false);
  });

  test('at seven it is a new day and the price must be set again', async () => {
    /* The shop is opening. This is the moment the question is useful rather
       than an interruption. */
    freeze('2026-09-15T01:35:00Z'); /* 07:05 IST */
    const out = await priceable(at('2026-09-14T05:30:00Z'));
    expect(out.status).toBe(false);
    expect(out.data.state).toBe('item_needs_price');
  });

  test('a price set after midnight belongs to the day that is still running', async () => {
    /*
     * A shop that re-prices at one in the morning, during service. That is the
     * same trading day it has been serving since the morning, so the price
     * holds until seven - not for five minutes until an arbitrary boundary.
     */
    freeze('2026-09-14T22:00:00Z'); /* 03:30 IST on the 15th */
    const out = await priceable(at('2026-09-14T19:30:00Z')); /* 01:00 IST on the 15th */
    expect(out.status).not.toBe(false);
  });
});

describe('the daily_price flag', () => {
  /*
   * The contract: `daily_price` says this dish is priced from the morning's
   * market, `price_set_on` says when somebody last did it. The fields are
   * added by other work; this consumes them, and must keep working before
   * they exist because a shop is running this today.
   */
  const at = (iso) => new Date(iso);
  const today = () => new Date();
  const yesterday = () => new Date(Date.now() - 26 * 60 * 60 * 1000);

  test('priced today, it is an ordinary dish at the catalogue rate', async () => {
    /* The whole point of the shop updating it when they open: once the number
       is in, nobody is asked anything. */
    const doc = await anItem({
      selling_price: 900,
      daily_price: true,
      price_set_on: today(),
    });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 1,
    });

    expect(out.status).not.toBe(false);
    expect(out.line.unit_price).toBe(900);
  });

  test("priced YESTERDAY, yesterday's rate is not charged as today's", async () => {
    /*
     * The failure this flag exists to catch, and the quiet one: a stale price
     * is worse than the zero this started as, because it looks right on the
     * bill and nobody checks.
     */
    const doc = await anItem({
      selling_price: 900,
      daily_price: true,
      price_set_on: yesterday(),
    });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).toBe(false);
    expect(out.data.state).toBe('item_needs_price');
  });

  test("priced yesterday, today's price from the waiter is taken", async () => {
    const doc = await anItem({
      selling_price: 900,
      daily_price: true,
      price_set_on: yesterday(),
    });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 1100,
    });

    expect(out.line.unit_price).toBe(1100);
  });

  test('never priced at all is the same as priced yesterday', async () => {
    const doc = await anItem({ selling_price: 900, daily_price: true });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).toBe(false);
  });

  test('an unreadable date is treated as not today, not as today', async () => {
    /* The safe way round: a waiter is asked, rather than a stale number being
       charged because a field could not be parsed. */
    const doc = await anItem({
      selling_price: 900,
      daily_price: true,
      price_set_on: 'the day before the fish came in',
    });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).toBe(false);
  });

  test('an item with neither field behaves exactly as it did before', async () => {
    /*
     * Every shop, until the flag ships. This is the line that lets the fix go
     * out ahead of the schema.
     */
    const priced = await anItem({ name: 'Coffee', selling_price: 40 });
    const notPriced = await anItem({ name: 'Pomfret', selling_price: 0 });

    expect(
      (await price(priced, { item_id: String(priced._id), item_quantity: 1 })).line.unit_price
    ).toBe(40);
    expect(
      (await price(notPriced, { item_id: String(notPriced._id), item_quantity: 1 })).status
    ).toBe(false);
  });

  test('open_price still means ask every time, priced today or not', async () => {
    /* A different thing: the shop saying the price is settled at the counter,
       not that it is set once each morning. */
    const doc = await anItem({
      selling_price: 900,
      open_price: true,
      daily_price: true,
      price_set_on: today(),
    });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).toBe(false);
  });
});

describe('an ordinary dish', () => {
  test('IGNORES a price the client sent', async () => {
    /*
     * The hole this must not open. The handset is a phone in somebody's
     * pocket; a caller that can name its own price can buy a biryani for one
     * rupee, and nothing about a dish sold at market rate changes that for
     * every other dish on the card.
     */
    const doc = await anItem({ name: 'Chicken Biryani', selling_price: 220 });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 2,
      unit_price: 1,
    });

    expect(out.line.unit_price).toBe(220);
    expect(out.line.total).toBe(440);
  });

  test('is unaffected when no price is sent at all', async () => {
    /* Every existing caller, including the customer's own order page. */
    const doc = await anItem({ name: 'Coffee', selling_price: 40 });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.status).not.toBe(false);
    expect(out.line.unit_price).toBe(40);
  });

  test('tax and discount still come from the catalogue, not the client', async () => {
    const doc = await anItem({
      name: 'Fish Curry',
      selling_price: 0,
      tax: 5,
      tax_type: 'exclusive',
      discount_amount: 50,
    });

    const out = await price(doc, {
      item_id: String(doc._id),
      item_quantity: 1,
      unit_price: 1000,
    });

    /* 1000 less the shop's 50 discount, plus the shop's 5% on what is left. */
    expect(out.line.unit_price).toBe(1000);
    expect(out.line.tax_amount).toBe(47.5);
    expect(out.line.total).toBe(997.5);
  });
});

/*
 * WHAT THE KITCHEN IS TOLD ABOUT THE MONEY.
 *
 * Owner: "lets customer wants to have fish for rs500 so that kitchen will
 * prepare according to that."
 *
 * Five hundred rupees of fish is a particular fish. For a dish priced at the
 * table the price IS the specification, and the kitchen cannot pick the right
 * one from the name. For an ordinary dish off the card it is noise: a cook
 * does not choose a biryani differently because it costs 220, and a ticket
 * with money on every line is one where the line that matters stops standing
 * out.
 *
 * So the line carries it only where it means something, and the kitchen ticket
 * prints what it is given. See src/escpos-kot.js.
 */
describe('the price the kitchen is told', () => {
  test('A DISH PRICED AT THE TABLE CARRIES ITS PRICE', async () => {
    const doc = await anItem({ selling_price: 0 });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1, item_price: 500 });

    expect(out.line.priced_at_table).toBe(500);
  });

  test('an ordinary dish carries none', async () => {
    const doc = await anItem({ selling_price: 220 });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 2 });

    expect(out.line.priced_at_table).toBeUndefined();
  });

  test('a one-off invented at the table carries it too', async () => {
    /*
     * A quick sale has a catalogue price - it was just created - so the
     * dynamic test alone would miss it. Its price was still agreed with a
     * guest rather than chosen on a card, which is the thing that matters.
     */
    const doc = await anItem({ selling_price: 750, item_status: 'instant' });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.line.priced_at_table).toBe(750);
  });

  test('a dish priced this morning carries none, because the card prices it', async () => {
    /* daily_price set TODAY is an ordinary dish at the catalogue rate - that
       is the whole point of the shop updating it when they open. */
    const doc = await anItem({
      selling_price: 900,
      daily_price: true,
      price_set_on: new Date(),
    });

    const out = await price(doc, { item_id: String(doc._id), item_quantity: 1 });

    expect(out.line.priced_at_table).toBeUndefined();
  });
});
