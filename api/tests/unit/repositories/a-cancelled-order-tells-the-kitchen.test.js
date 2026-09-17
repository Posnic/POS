'use strict';

/*
 * A CANCELLED ORDER TELLS THE KITCHEN AT ONCE.
 *
 * Every other thing that needs a kitchen ticket says so the moment it is
 * saved: the API is require()d into the till's own process, so the sale
 * emits on `process` and the printer prints within a few hundred
 * milliseconds. A cancellation wrote its change record and returned one
 * branch too early, so it was the only ticket left to the poller's thirty
 * second safety net.
 *
 * Nothing was lost, which is why it survived so long. Read from the owner's
 * counter on 2026-09-17: two cancellations at 18:38:57 and 18:39:01, both
 * printed by the 18:39:24 poll - 23 and 27 seconds of waiting, then 57 ms
 * and 63 ms to print. "when i very first time it took only few seconds to
 * print. then after than it took almot 30 to 60 seconds."
 *
 * It also made two earlier rounds of work invisible. The cancellation was
 * barred from the fast byte path, and then its struck line cost 1,736 bytes
 * a row whatever the dish; both were fixed, and neither could show while the
 * ticket was found by a timer instead of announced.
 *
 * The test that was supposed to cover this counted notifyKotReady calls in
 * the whole twelve thousand line file. Five other sites kept the count up.
 * This one cancels a real order against a real mongod and listens.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');
const { KOT_EVENT } = require('../../../src/helpers/kot-notify');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();
const BIRYANI = new mongoose.Types.ObjectId();

/** An open table order, optionally with items that could never be cooked. */
async function anOrder({ items } = {}) {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: new Date('2026-09-17T18:30:00.000Z'),
    updated_date: new Date('2026-09-17T18:30:00.000Z'),
    table_number: '4',
    dine_type: 'Dine-in',
    items:
      items === undefined
        ? [{ item_id: BIRYANI, item_name: 'Chicken Biryani', item_quantity: 1, item_price: 220 }]
        : items,
  });
  return String(_id);
}

/** Cancel it the way the KOT screen and the handset both do. */
const cancel = (id) =>
  repo.updateOrderModel(id, [], 0, 'cancelled', null, 0, '', null, null, null, {});

/** Everything the sale announced while this ran. */
async function announcedDuring(fn) {
  const heard = [];
  const listener = (payload) => heard.push(payload);
  process.on(KOT_EVENT, listener);
  try {
    await fn();
  } finally {
    process.off(KOT_EVENT, listener);
  }
  return heard;
}

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
});

afterEach(async () => {
  jest.restoreAllMocks();
  await db.collection('sales').deleteMany({});
});

test('cancelling an order announces it, so the ticket does not wait for the poller', async () => {
  const id = await anOrder();

  const heard = await announcedDuring(() => cancel(id));

  expect(heard).toHaveLength(1);
  expect(heard[0].saleId).toBe(id);
  expect(heard[0].reason).toBe('cancelled');
});

test('it carries the branch, because a till serving one branch ignores another', async () => {
  /*
   * The till takes the branch from the sale when it has none of its own:
   * "[KOT] branch taken from the sale". An announcement without one is an
   * announcement a second branch's printer would answer.
   */
  const id = await anOrder();

  const heard = await announcedDuring(() => cancel(id));

  expect(String(heard[0].branchId)).toBe(String(BRANCH));
});

test('the cancellation is still written, whatever the announcement does', async () => {
  /* The announcement is a nudge, never the record. */
  const id = await anOrder();

  const result = await cancel(id);

  expect(result.status).toBe(true);
  const stored = await db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(id) });
  expect(stored.sale_process).toBe('cancelled');
  expect(stored.changes).toHaveLength(1);
  expect(stored.changes[0].items[0]).toMatchObject({
    item_name: 'Chicken Biryani',
    process: 'cancel',
  });
});

test('a cancellation with nothing printable does not wake the printer', async () => {
  /*
   * `changes[].items` is what the poller builds a cancellation ticket out of.
   * An order whose lines carry no item id, or no quantity, produces no change
   * record - so there is no ticket, and a nudge would send the printer to
   * fetch nothing. Cancelling it must still work.
   */
  const id = await anOrder({ items: [{ item_name: 'a line nobody can cook', item_quantity: 0 }] });

  const heard = await announcedDuring(() => cancel(id));

  expect(heard).toHaveLength(0);
  const stored = await db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(id) });
  expect(stored.sale_process).toBe('cancelled');
  expect(stored.changes).toBeUndefined();
});
