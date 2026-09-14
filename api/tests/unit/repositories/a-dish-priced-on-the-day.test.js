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
