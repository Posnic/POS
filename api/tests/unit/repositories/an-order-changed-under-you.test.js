'use strict';

/*
 * TWO PHONES, ONE ORDER, AND A DISH THAT VANISHES.
 *
 * A handset sends the WHOLE order when it saves, and the till keeps only what
 * arrives. That is not a mistake: it is how a cancelled dish gets cancelled.
 *
 * It is also why a floor with several handsets loses food. Waiter A adds a
 * biryani at 19:00. Waiter B saves at 19:01 from a screen opened at 18:58, so
 * B's list has no biryani in it, and the till removes one the kitchen has
 * already cooked. The bill goes out short and nobody is told - not A, not B,
 * not the kitchen, not the shop.
 *
 * So a caller may say which version of the order it was looking at, and a save
 * written against an older one is refused. The client reloads and decides
 * again, because only a person knows whether that biryani was meant to go.
 *
 * A caller that says nothing is treated exactly as before. Handsets in the
 * wild are older than this code, and refusing their saves would turn a
 * data-loss bug into an outage.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();
const BIRYANI = new mongoose.Types.ObjectId();
const NAAN = new mongoose.Types.ObjectId();

const WAS_OPENED_AT = new Date('2026-09-16T18:58:00.000Z');
const CHANGED_AT = new Date('2026-09-16T19:00:00.000Z');

/** An order with one dish, last changed at a known moment. */
async function anOrder(updatedAt) {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: WAS_OPENED_AT,
    updated_date: updatedAt,
    table_number: '4',
    dine_type: 'Dine-in',
    items: [
      { item_id: NAAN, item_name: 'Butter Naan', item_quantity: 1, item_price: 40 },
      { item_id: BIRYANI, item_name: 'Chicken Biryani', item_quantity: 1, item_price: 220 },
    ],
  });
  return String(_id);
}

const stored = async (id) =>
  db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(id) });

/** Save an order carrying only the naan: the biryani would be dropped. */
const saveWithoutTheBiryani = (id, options) =>
  repo.updateOrderModel(
    id,
    [{ item_id: String(NAAN), item_name: 'Butter Naan', item_quantity: 1, item_price: 40 }],
    40,
    null,
    null,
    null,
    null,
    '4',
    'Dine-in',
    2,
    options || {}
  );

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
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await db.collection('sales').deleteMany({});
  await db.collection('items').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('branches').insertOne({ _id: BRANCH, license: LICENSE });
  await db.collection('items').insertMany([
    { _id: BIRYANI, license: LICENSE, item_name: 'Chicken Biryani', item_price: 220 },
    { _id: NAAN, license: LICENSE, item_name: 'Butter Naan', item_price: 40 },
  ]);
});

afterEach(() => jest.restoreAllMocks());

test.each([['person_count',5],['table_number','9'],['table_id','other-table'],['dine_type','Take away'],
  ['seating_request_id','new-seating-request'],['seating_primary_id','new-primary'],['seating_table_ids',['new-table']]])(
  'a concurrent %s change cannot be overwritten by a delayed legacy item save',async(field,value)=>{
    const id=await anOrder(CHANGED_AT);
    const before=await stored(id);
    jest.spyOn(require('../../../src/services/captain-payment-guard'),'beginEdit').mockImplementation(async()=>{
      await db.collection('sales').updateOne({_id:before._id},{$set:{[field]:value}});
      return null;
    });
    const result=await saveWithoutTheBiryani(id);
    expect(result.status).toBe(false);expect(result.message).toBe('order_changed');
    const after=await stored(id);
    expect(after[field]).toEqual(value);expect(after.items).toEqual(before.items);
  }
);

describe('a save written against an order that has moved on', () => {
  test('IS REFUSED, and the dish the other waiter added is still there', async () => {
    const id = await anOrder(CHANGED_AT);

    const out = await saveWithoutTheBiryani(id, { seenAt: WAS_OPENED_AT.toISOString() });

    expect(out.status).toBe(false);
    expect(out.message).toBe('order_changed');

    const after = await stored(id);
    expect(after.items.map((i) => i.item_name).sort()).toEqual(['Butter Naan', 'Chicken Biryani']);
  });

  test('says when the order actually changed, so the client can show it', async () => {
    const id = await anOrder(CHANGED_AT);

    const out = await saveWithoutTheBiryani(id, { seenAt: WAS_OPENED_AT.toISOString() });

    expect(new Date(out.data.updated_date).getTime()).toBe(CHANGED_AT.getTime());
  });
});

describe('a save that is not stale', () => {
  test('goes through, and a dish left out is still cancelled', async () => {
    /*
     * The guard must not break the thing it sits in front of. Leaving a dish
     * out IS how a waiter cancels it, and that has to keep working.
     */
    const id = await anOrder(CHANGED_AT);

    const out = await saveWithoutTheBiryani(id, { seenAt: CHANGED_AT.toISOString() });

    expect(out.status).not.toBe(false);
    const after = await stored(id);
    expect(after.items.map((i) => i.item_name)).toEqual(['Butter Naan']);
  });

  test('a caller that says nothing is served exactly as before', async () => {
    /*
     * Handsets already in shops are older than this code. Refusing their
     * saves would turn a bug that loses a dish into one that takes no orders.
     */
    const id = await anOrder(CHANGED_AT);

    const out = await saveWithoutTheBiryani(id, {});

    expect(out.status).not.toBe(false);
    expect((await stored(id)).items.map((i) => i.item_name)).toEqual(['Butter Naan']);
  });

  test('an unreadable timestamp is not treated as a conflict', async () => {
    /* A caller this check cannot help is not a caller to block. */
    const id = await anOrder(CHANGED_AT);

    const out = await saveWithoutTheBiryani(id, { seenAt: 'yesterday afternoon' });

    expect(out.status).not.toBe(false);
  });

  test('an order nobody has ever updated is judged by when it was created', async () => {
    const id = await anOrder(undefined);

    const stale = await saveWithoutTheBiryani(id, {
      seenAt: new Date(WAS_OPENED_AT.getTime() - 60000).toISOString(),
    });
    expect(stale.message).toBe('order_changed');

    const fresh = await saveWithoutTheBiryani(id, { seenAt: WAS_OPENED_AT.toISOString() });
    expect(fresh.status).not.toBe(false);
  });
});

test('same-product preparations survive edits and cancellation with their own notes', async () => {
  const id = await anOrder(CHANGED_AT);
  await db.collection('sales').updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: {
        items: [
          {
            item_id: NAAN,
            line_id: 'dry',
            item_name: 'Naan',
            item_quantity: 1,
            item_price: 40,
            item_description: 'No butter',
          },
          {
            item_id: NAAN,
            line_id: 'butter',
            item_name: 'Naan',
            item_quantity: 2,
            item_price: 40,
            item_description: 'Extra butter',
          },
        ],
      },
    }
  );
  const out = await repo.updateOrderModel(
    id,
    [
      { product_id: String(NAAN), line_id: 'dry', quantity: 1, price: 40, item_description: '' },
      {
        product_id: String(NAAN),
        line_id: 'butter',
        quantity: 1,
        price: 40,
        item_description: 'Extra butter',
      },
    ],
    80,
    null,
    null,
    null,
    null,
    '4',
    'Dine-in',
    2,
    {}
  );
  expect(out.status).not.toBe(false);
  const after = await stored(id);
  expect(after.items).toHaveLength(2);
  expect(after.items.find((line) => line.line_id === 'dry').item_description).toBe('');
  expect(after.items.find((line) => line.line_id === 'butter').item_quantity).toBe(1);
  const cancelled = after.changes
    .flatMap((change) => change.items)
    .filter((line) => line.process === 'cancel');
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]).toMatchObject({
    line_id: 'butter',
    item_quantity: 1,
    item_description: 'Extra butter',
  });
});

test('editing a removed catalogue dish keeps quantity and receipt fields consistent at shop precision', async () => {
  const id = await anOrder(CHANGED_AT);
  await db.collection('branches').updateOne({ _id: BRANCH }, { $set: { currency_code: 'KWD' } });
  await db.collection('sales').updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: {
        items: [
          {
            item_id: NAAN,
            item_name: 'Naan',
            quantity: 2,
            item_quantity: 2,
            item_price: 40.005,
            unit_price: 40.005,
            total: 80.01,
            item_total: 80.01,
            total_amount: 80.01,
          },
        ],
      },
    }
  );
  await db.collection('items').deleteOne({ _id: NAAN });
  const result = await repo.updateOrderModel(
    id,
    [{ item_id: String(NAAN), quantity: 1, item_price: 40.005 }],
    40.005,
    null,
    null,
    null,
    null,
    '4',
    'Dine-in',
    2,
    {}
  );
  expect(result.status).not.toBe(false);
  const saved = await stored(id);
  expect(saved.items[0]).toMatchObject({
    quantity: 1,
    item_quantity: 1,
    total: 40.005,
    item_total: 40.005,
    total_amount: 40.005,
  });
  expect(saved.changes.at(-1).items[0]).toMatchObject({ process: 'cancel', item_quantity: 1 });
});

test('a newly added unknown dish refuses the whole edit instead of silently dropping it', async () => {
  const id = await anOrder(CHANGED_AT);
  const result = await repo.updateOrderModel(
    id,
    [
      { item_id: String(NAAN), quantity: 1, item_price: 40 },
      { item_id: String(new mongoose.Types.ObjectId()), quantity: 1, item_price: 20 },
    ],
    60,
    null,
    null,
    null,
    null,
    '4',
    'Dine-in',
    2,
    {}
  );
  expect(result.status).toBe(false);
  expect((await stored(id)).items).toHaveLength(2);
});

test('adding custom-priced fish to an existing order preserves its kitchen amount', async () => {
  const id = await anOrder(CHANGED_AT),
    fish = new mongoose.Types.ObjectId();
  await db
    .collection('items')
    .insertOne({ _id: fish, license: LICENSE, name: 'Fish', selling_price: 0, tax: 0 });
  const result = await repo.updateOrderModel(
    id,
    [
      { item_id: String(NAAN), quantity: 1, item_price: 40 },
      { item_id: String(BIRYANI), quantity: 1, item_price: 220 },
      { item_id: String(fish), quantity: 2, item_price: 500 },
    ],
    1260,
    null,
    null,
    null,
    null,
    '4',
    'Dine-in',
    2,
    {}
  );
  expect(result.status).not.toBe(false);
  const saved = await stored(id);
  expect(saved.items.find((line) => String(line.item_id) === String(fish)).priced_at_table).toBe(
    500
  );
  const change = saved.changes.at(-1).items.find((line) => String(line.item_id) === String(fish));
  expect(change.priced_at_table).toBe(500);
  const printed = require('../../../../src/escpos-kot').renderKitchenTicket({ items: [change] });
  expect(Buffer.from(printed).toString('latin1')).toContain('Rs 500');
});
