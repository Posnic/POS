'use strict';

/*
 * Two tills in one shop, and one ticket each.
 *
 * WHAT WAS THERE
 *
 * multiKitchenPrintModel took a branch and nothing else - no till, no claim,
 * no lease - so two machines polling the same shop were handed the SAME sales
 * and both printed them. Nobody has ever seen that, for a reason that is worse
 * than the bug: only one till in a shop is configured with kitchen printers.
 * Which is also exactly why a shop with two tills has no standby. The second
 * one cannot be given the printers without doubling every ticket.
 *
 * Owner: "printing dont bring me new issues. keep changes safely." So the rule
 * this is built to is narrow: a claim may only ever REDUCE what a till is
 * offered. It can turn two tickets into one; it must never turn one into none.
 *
 * Against a real mongod, because this is the query that feeds every kitchen
 * and a mock of it would only prove I can write down what I already believe.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();

/** An order sitting in the kitchen queue, never printed. */
async function order(over = {}) {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: new Date(),
    items: [{ item_name: 'Idli', item_quantity: 2 }],
    /* `process` is what the loop reads: a change line with neither 'add' nor
       'cancel' produces no print job at all, so a fixture without it tests a
       sale nobody would ever print. */
    changes: [
      { timestamp: new Date(), items: [{ item_name: 'Idli', item_quantity: 2, process: 'add' }] },
    ],
    ...over,
  });
  return String(_id);
}

const handedTo = async (tillId) => {
  const out = await repo.multiKitchenPrintModel(String(BRANCH), { tillId });
  return (out.data || []).map((sale) => String(sale._id));
};

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
  await db.collection('sales').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('print_jobs').deleteMany({});
  await db.collection('branches').insertOne({ _id: BRANCH, license: LICENSE });
});

afterEach(() => jest.restoreAllMocks());

/* ---------------------------------------------- the bug, and the fix */

describe('two tills are never handed the same ticket', () => {
  test('ONE TICKET GOES TO ONE TILL, and the other is offered nothing', async () => {
    const saleId = await order();

    expect(await handedTo('till-a')).toEqual([saleId]);
    expect(await handedTo('till-b')).toEqual([]);
  });

  test('and before this, both were handed it', async () => {
    /*
     * The same call with no till id is the OLD behaviour, byte for byte, and
     * it is what ninety shops are still running. This asserts the bug rather
     * than describing it, so the day somebody makes the till id compulsory
     * they can see exactly what changes.
     */
    await order();
    const a = await repo.multiKitchenPrintModel(String(BRANCH));
    const b = await repo.multiKitchenPrintModel(String(BRANCH));
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
    expect(String(a.data[0]._id)).toBe(String(b.data[0]._id));
  });

  test('A TILL THAT SENDS NO ID IS UNAFFECTED, which is most of the estate', async () => {
    /* The claim must be invisible to a build that has never heard of it, or
       the day this ships every shop's kitchen changes behaviour at once. */
    const saleId = await order();
    const out = await repo.multiKitchenPrintModel(String(BRANCH));
    expect(out.data.map((s) => String(s._id))).toEqual([saleId]);

    const sale = await db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(saleId) });
    expect(sale.kot_claimed_by).toBeUndefined();
    expect(sale.kot_claimed_at).toBeUndefined();
  });
});

/* --------------------------------------------------- it only ever narrows */

describe('a claim can turn two tickets into one, never one into none', () => {
  test('MY OWN CLAIM NEVER BLOCKS ME', async () => {
    /*
     * A till that crashed mid-print must be able to try again on its very next
     * poll, not in forty-five seconds. Without this, the single-till case -
     * which is every shop today - would get SLOWER at exactly the moment
     * something has gone wrong.
     */
    const saleId = await order();
    expect(await handedTo('till-a')).toEqual([saleId]);
    expect(await handedTo('till-a')).toEqual([saleId]);
    expect(await handedTo('till-a')).toEqual([saleId]);
  });

  test('and a claim that has gone stale is picked up by the other till', async () => {
    /* The standby. A till that stops reporting hands its work back without
       anybody walking over to a machine. */
    const saleId = await order();
    expect(await handedTo('till-a')).toEqual([saleId]);
    expect(await handedTo('till-b')).toEqual([]);

    await db
      .collection('sales')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(saleId) },
        { $set: { kot_claimed_at: new Date(Date.now() - 60 * 1000) } }
      );

    expect(await handedTo('till-b')).toEqual([saleId]);
  });

  test('ONLY WHAT IS HANDED OVER IS CLAIMED', async () => {
    /*
     * A sale with nothing new to print is not being printed by anybody, and
     * claiming it would hide it from the other till for no reason at all.
     */
    const printed = await order({ last_printed_change_index: 0 });
    const fresh = await order();

    expect(await handedTo('till-a')).toEqual([fresh]);
    const quiet = await db
      .collection('sales')
      .findOne({ _id: new mongoose.Types.ObjectId(printed) });
    expect(quiet.kot_claimed_by).toBeFalsy();
  });
});

/* ------------------------------------------------------- and it is released */

describe('reporting gives the ticket back', () => {
  test('A REPORTED TICKET RELEASES ITS CLAIM', async () => {
    /*
     * Leaving it would keep the sale hidden from the other till for the rest
     * of the window, which matters the moment an amendment arrives for the
     * same table - the second round would sit there while a claim nobody
     * needs expired.
     */
    const saleId = await order();
    await handedTo('till-a');
    await repo.markKitchenPrintedModel([saleId], { [saleId]: 0 }, []);

    const sale = await db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(saleId) });
    expect(sale.kitchen_printed).toBe(true);
    expect(sale.kot_claimed_by).toBe('');
    expect(sale.kot_claimed_at).toBeNull();
  });

  test('and an amendment on the same table reaches the other till at once', async () => {
    const saleId = await order();
    await handedTo('till-a');
    await repo.markKitchenPrintedModel([saleId], { [saleId]: 0 }, []);

    /* A second round, added after the first printed. */
    await db.collection('sales').updateOne(
      { _id: new mongoose.Types.ObjectId(saleId) },
      {
        $push: {
          changes: {
            timestamp: new Date(),
            items: [{ item_name: 'Naan', item_quantity: 1, process: 'add' }],
          },
        },
      }
    );

    expect(await handedTo('till-b')).toEqual([saleId]);
  });
});

/* --------------------------------------------------------- it is a bystander */

test('A CLAIM THAT CANNOT BE WRITTEN STILL PRINTS THE TICKET', async () => {
  /*
   * The rule this whole change is built to. A kitchen that gets nothing
   * because a bookkeeping write failed is far worse than two tills that both
   * print - which is what happens today anyway.
   */
  const saleId = await order();
  const real = db.collection.bind(db);
  jest.spyOn(db, 'collection').mockImplementation((name) => {
    const col = real(name);
    if (name !== 'sales') return col;
    return new Proxy(col, {
      get(target, prop) {
        if (prop === 'updateMany') {
          return () => Promise.reject(new Error('the disk is full'));
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });

  const out = await repo.multiKitchenPrintModel(String(BRANCH), { tillId: 'till-a' });
  expect(out.status).toBe(true);
  expect(out.data.map((s) => String(s._id))).toEqual([saleId]);
});
