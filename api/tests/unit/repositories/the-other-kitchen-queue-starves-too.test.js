'use strict';

/*
 * AND THE OTHER QUEUE, which has the same fault and no report against it.
 *
 * the-twentieth-cancellation-of-the-day.test.js covers the query that was
 * reported: twenty-five cancellations in a day against a window of twenty,
 * and everything after the twentieth silently stopped printing.
 *
 * multiKitchenPrintModel has TWO queries and they are copies of each
 * other. The order one was equally starved - fifty instead of twenty - and
 * it went unreported only because its pool usually drains: an order stops
 * saying KOT once the table settles. A table-order sale does not, because
 * sale.service.js forces the process back to KOT on every write, so on a
 * restaurant till those rows pile up exactly as the cancellations did.
 *
 * So: the same day, seeded on the other query, plus a sweep over the
 * function so a third queue cannot be added without the condition. Nothing
 * about a starved queue is visible - the server answers "Get unprinted
 * sales successfully" with an empty list and the kitchen goes quiet.
 */
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const BIRYANI = new mongoose.Types.ObjectId();

/** Earlier today: ordered, printed, and still saying KOT. */
async function aFinishedOrder(minutesAgo) {
  const at = new Date(Date.now() - minutesAgo * 60000);
  await db.collection('sales').insertOne({
    _id: new mongoose.Types.ObjectId(),
    branch_id: BRANCH,
    sale_process: 'KOT',
    created_date: at,
    updated_date: at,
    table_number: '3',
    items: [{ item_id: BIRYANI, item_name: 'Chicken Biryani', item_quantity: 1 }],
    changes: [
      {
        timestamp: at,
        items: [
          {
            item_id: String(BIRYANI),
            item_name: 'Chicken Biryani',
            item_quantity: 1,
            process: 'add',
          },
        ],
      },
    ],
    last_printed_change_index: 0,
    kitchen_printed: true,
  });
}

/** The order just taken, which needs paper. */
async function aFreshOrder() {
  const at = new Date();
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    sale_process: 'KOT',
    created_date: at,
    updated_date: at,
    table_number: '7',
    items: [{ item_id: BIRYANI, item_name: 'Chicken Biryani', item_quantity: 2 }],
    changes: [
      {
        timestamp: at,
        items: [
          {
            item_id: String(BIRYANI),
            item_name: 'Chicken Biryani',
            item_quantity: 2,
            process: 'add',
          },
        ],
      },
    ],
  });
  return String(_id);
}

const offered = async () => {
  const res = await repo.multiKitchenPrintModel(BRANCH, { tillId: 'TILL-1' });
  return (res.data || []).map((s) => String(s._id));
};

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  db = mongoose.connection.db;
  await db.collection('branches').insertOne({ _id: BRANCH, branch_name: 'Azure Coastal Kitchen' });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(() => {
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  await db.collection('sales').deleteMany({});
});

test('THE FIFTY-FIFTH ORDER OF THE DAY STILL PRINTS', async () => {
  /*
   * The same fault on the order query, which is the one nobody saw because
   * its pool usually drains: an order stops saying KOT when the table is
   * settled. A table-order sale does not - sale.service.js forces the process
   * back to KOT on every write - so on a restaurant's till these rows
   * accumulate exactly as the cancellations do, and the fiftieth would have
   * ended the day's printing.
   */
  for (let i = 0; i < 55; i += 1) {
    await aFinishedOrder(600 - i);
  }
  const id = await aFreshOrder();

  expect(await offered()).toContain(id);
});

test('EVERY queue in this function asks it, not just the two that were fixed', () => {
  /*
   * Swept rather than named, because the two queries here are copies of each
   * other and the fault lived in the copy nobody was looking at. A third one
   * added next month has the same fault available to it, and nothing about a
   * starved queue is visible: the server answers "Get unprinted sales
   * successfully" with an empty list and the kitchen simply goes quiet.
   */
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );
  const at = src.indexOf('async multiKitchenPrintModel');
  expect(at).toBeGreaterThan(0);
  const body = src.slice(at, src.indexOf('async markKitchenPrintedModel', at));

  const queries = (body.match(/salesCollection[\s\S]{0,40}\.find\(/g) || []).length;
  expect(queries).toBeGreaterThanOrEqual(2);
  expect((body.match(/\.\.\.hasUnprintedChanges,/g) || []).length).toBe(queries);
});
