'use strict';

/*
 * TWO TAPS ARE ONE ORDER, AND THE DATABASE IS WHAT DECIDES IT.
 *
 * Owner, from a live floor: "when order comes from mobile app (captain app),
 * app gave for table number 5. when i click table number 5 i saw two orders.
 * its duplicate. when cancel both gone. werd... basically two orders in single
 * table not possible."
 *
 * createOnlineOrder already looked for an order with the same key before
 * writing one. That check is a read followed by a write, and two copies of the
 * same order arriving together both read "nothing there" and both insert. A
 * lookup cannot close that window; only a unique index can.
 *
 * The index has a second job that matters more than the race. Once it exists,
 * a resend is refused by the database rather than quietly written, so the
 * handset gets the order that already exists instead of a second ticket, even
 * if the lookup above were removed tomorrow.
 *
 * Against a real MongoDB, because this is entirely about what the server
 * enforces. A fake collection would accept both writes and the test would
 * prove nothing at all.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
const { _reset } = require('../../../src/db/ensure-index');

let mem;
let sales;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  sales = mongoose.connection.db.collection('sales');
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await sales.deleteMany({});
  await sales.dropIndexes().catch(() => {
    /* a fresh collection has none */
  });
  _reset();
  BaseModel.license = null;
});

const order = (key, extra = {}) => ({
  ...(key === null ? {} : { idempotency_key: key }),
  license: 'SHOP-1',
  sale_process: 'KOT',
  table_number: '5',
  sales_total: 420,
  ...extra,
});

describe('the index that makes a resend safe', () => {
  test('a second order under the same key is refused', async () => {
    await repo._ensureIdempotencyIndex(mongoose.connection.db);

    await sales.insertOne(order('tap-1'));
    await expect(sales.insertOne(order('tap-1'))).rejects.toMatchObject({ code: 11000 });

    expect(await sales.countDocuments({ idempotency_key: 'tap-1' })).toBe(1);
  });

  test('and the refusal is recognised as a repeat, not as a bill number clash', async () => {
    /*
     * The two are handled in opposite ways. A bill number that clashed is
     * re-taken and the sale is written. A repeated order is NOT written; the
     * order that already exists is handed back. Confusing them would either
     * lose an order or duplicate one.
     */
    await repo._ensureIdempotencyIndex(mongoose.connection.db);
    await sales.insertOne(order('tap-1'));

    let caught = null;
    try {
      await sales.insertOne(order('tap-1'));
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeTruthy();
    expect(repo.isDuplicateIdempotencyError(caught)).toBe(true);
    expect(repo.isDuplicateSalesIdError(caught)).toBe(false);
  });

  test('a bill number clash is not mistaken for a repeated order', async () => {
    await repo._ensureSalesIdIndex(mongoose.connection.db);
    await sales.insertOne(order('tap-1', { sales_id: 'SB1D9-000032' }));

    let caught = null;
    try {
      await sales.insertOne(order('tap-2', { sales_id: 'SB1D9-000032' }));
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeTruthy();
    expect(repo.isDuplicateSalesIdError(caught)).toBe(true);
    expect(repo.isDuplicateIdempotencyError(caught)).toBe(false);
  });

  test('a different order goes through untouched', async () => {
    await repo._ensureIdempotencyIndex(mongoose.connection.db);
    await sales.insertOne(order('tap-1'));
    await sales.insertOne(order('tap-2'));
    expect(await sales.countDocuments({})).toBe(2);
  });

  test('the same key at two different shops is two different orders', async () => {
    /* Each shop has its own database, so this cannot collide in production.
       The licence is in the key anyway, because a shared database is exactly
       the kind of thing that changes underneath an index. */
    await repo._ensureIdempotencyIndex(mongoose.connection.db);
    await sales.insertOne(order('tap-1', { license: 'SHOP-1' }));
    await sales.insertOne(order('tap-1', { license: 'SHOP-2' }));
    expect(await sales.countDocuments({})).toBe(2);
  });

  test('the millions of till sales that carry no key are not all colliding on null', async () => {
    /*
     * THE REASON THIS INDEX IS PARTIAL. A plain unique index treats every
     * document without the field as sharing one null value, so the second
     * counter sale of the day would be refused. That would take the shop down.
     */
    await repo._ensureIdempotencyIndex(mongoose.connection.db);
    await sales.insertOne(order(null, { sale_process: 'Add' }));
    await sales.insertOne(order(null, { sale_process: 'Add' }));
    await sales.insertOne(order(null, { sale_process: 'Add' }));
    expect(await sales.countDocuments({})).toBe(3);
  });

  test('it is built for every shop, not for whichever one made the first order', async () => {
    /*
     * One process serves many shops, each with its own database. A static
     * boolean latch would give this index to the first shop to place a table
     * order after a restart and to nobody else, which for a unique index is
     * the guarantee quietly not applying to almost everyone.
     */
    const second = mongoose.connection.useDb('another-shop', { useCache: true });
    await repo._ensureIdempotencyIndex(mongoose.connection.db);
    await repo._ensureIdempotencyIndex(second.db ? second.db : second);

    const names = async (db) =>
      (await db.collection('sales').indexes()).map((i) => i.name);

    expect(await names(mongoose.connection.db)).toContain('unique_idempotency_key_per_license');
    expect(await names(second.db ? second.db : second)).toContain(
      'unique_idempotency_key_per_license'
    );

    await (second.db ? second.db : second).dropDatabase();
  });
});

describe('what a handset is told when its order already exists', () => {
  test('the same answer as if this request had created it', async () => {
    const existing = {
      _id: new mongoose.Types.ObjectId(),
      token_id: 'A101',
      sales_id: 'SB1D9-000032',
      branch_name: 'Main Branch',
      items: [{ item_name: 'Tea', item_quantity: 2 }],
      sub_total: 400,
      discount: 0,
      tax: 20,
      sales_total: 420,
      payment_status: 'Unpaid',
    };

    const answer = repo._duplicateOrderAnswer(existing);

    expect(answer.status).toBe(true);
    expect(answer.message).toMatch(/placed successfully/i);
    expect(answer.data.sale_id).toBe(existing._id.toString());
    expect(answer.data.sales_id).toBe('SB1D9-000032');
    expect(answer.data.tokenId).toBe('A101');
    expect(answer.data.total).toBe(420);
    expect(answer.data.items).toHaveLength(1);
  });

  test('and it says so, so the app can tell "already in" from "just taken"', () => {
    /* A waiter standing at a table needs to know whether to send again. */
    const answer = repo._duplicateOrderAnswer({
      _id: new mongoose.Types.ObjectId(),
      sales_id: 'X',
    });
    expect(answer.data.duplicate).toBe(true);
  });

  test('an older order with none of the newer field names still answers', () => {
    /* Orders written before the current field names existed are still sitting
       in shops. Handing back undefined totals would be worse than the
       duplicate. */
    const answer = repo._duplicateOrderAnswer({
      _id: new mongoose.Types.ObjectId(),
      sales_id: 'OLD-1',
      tokenId: 'B202',
      subtotal: 100,
      total: 118,
    });
    expect(answer.data.tokenId).toBe('B202');
    expect(answer.data.subtotal).toBe(100);
    expect(answer.data.total).toBe(118);
    expect(answer.data.items).toEqual([]);
  });
});
