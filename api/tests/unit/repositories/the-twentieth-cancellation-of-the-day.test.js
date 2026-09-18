'use strict';

/*
 * THE TWENTIETH CANCELLATION OF THE DAY.
 *
 * Owner: "cancel not pritingin."
 *
 * From his own till's log:
 *
 *   [KOT] sale event -> printing now (cancelled)
 *   [KOT] API ... message="Get unprinted sales successfully" sales=0
 *
 * and from its database: twenty-five cancelled sales that day, against a query
 * that took the OLDEST TWENTY. Everything cancelled after the twentieth fell
 * outside the window, so the server answered "nothing to print" and the
 * kitchen was never told. The last cancellation that printed was at 13:02;
 * every one from 13:17 onwards printed nothing at all.
 *
 * The limits were meant as a safety valve against an enormous day. What they
 * actually did was drop work silently: a shop that cancels twenty orders stops
 * printing cancellations until midnight, and nothing anywhere says so.
 *
 * Against a real mongod, because the fault was in what the QUERY selects and a
 * fake would have agreed with whatever I wrote.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();

/** Earlier today, so every sale lands inside the day window. */
function earlierToday(minutesAgo) {
  const when = new Date();
  when.setHours(9, 0, 0, 0);
  when.setMinutes(when.getMinutes() + minutesAgo);
  return when;
}

/**
 * A cancelled sale.
 *
 * `printed` is the index of the last change that reached paper: 1 means both
 * the order and its cancellation have printed, 0 means the cancellation has
 * not.
 */
async function cancelledSale({ minutesAgo, printed, table }) {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'cancelled',
    payment_status: 'Cancelled',
    table_number: table,
    created_date: earlierToday(minutesAgo),
    updated_date: earlierToday(minutesAgo),
    last_printed_change_index: printed,
    items: [],
    changes: [
      {
        timestamp: earlierToday(minutesAgo),
        items: [{ item_id: 'i-1', item_name: 'Chicken Biryani', item_quantity: 1, process: 'add' }],
      },
      {
        timestamp: earlierToday(minutesAgo),
        items: [
          { item_id: 'i-1', item_name: 'Chicken Biryani', item_quantity: 1, process: 'cancel' },
        ],
      },
    ],
  });
  return String(_id);
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
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await db.collection('sales').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('branches').insertOne({ _id: BRANCH, license: LICENSE });
});

afterEach(() => jest.restoreAllMocks());

/* The call the till's poller makes. Named for the several kitchen printers a
   shop can have, which is not what this test is about. */
const askForUnprinted = () => repo.multiKitchenPrintModel(String(BRANCH), { tillId: '' });

test('THE TWENTY-FIFTH CANCELLATION OF THE DAY STILL PRINTS', async () => {
  /* Twenty-four already printed, and one that has not - which is every shop
     by the evening, and was his afternoon exactly. */
  for (let i = 0; i < 24; i += 1) {
    await cancelledSale({ minutesAgo: i, printed: 1, table: 'T' + i });
  }
  await cancelledSale({ minutesAgo: 240, printed: 0, table: 'LATE' });

  const said = await askForUnprinted();
  const tables = (said.data || []).map((sale) => sale.table_number);

  expect(tables).toContain('LATE');
});

test('and what it hands over is a cancellation, not an order', async () => {
  await cancelledSale({ minutesAgo: 240, printed: 0, table: 'LATE' });

  const said = await askForUnprinted();
  const sale = (said.data || []).find((one) => one.table_number === 'LATE');

  expect(sale).toBeDefined();
  expect(sale.print_jobs.map((job) => job.type)).toEqual(['cancel']);
  expect(sale.print_jobs[0].items.map((i) => i.item_name)).toEqual(['Chicken Biryani']);
});

test('SALES THAT HAVE ALREADY PRINTED ARE NOT HANDED OVER AGAIN', async () => {
  /*
   * The other half. Selecting by "has unprinted changes" must not start
   * reprinting a day's worth of tickets, which is the failure mode a kitchen
   * notices even faster than silence.
   */
  for (let i = 0; i < 24; i += 1) {
    await cancelledSale({ minutesAgo: i, printed: 1, table: 'T' + i });
  }

  const said = await askForUnprinted();
  expect(said.data || []).toEqual([]);
});

test('a sale that has never printed anything is unprinted, not skipped', async () => {
  /* last_printed_change_index is -1 before the first ticket, and older
     documents do not carry the field at all. */
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: earlierToday(10),
    table_number: 'FRESH',
    items: [],
    changes: [
      {
        timestamp: earlierToday(10),
        items: [{ item_id: 'i-1', item_name: 'Butter Naan', item_quantity: 2, process: 'add' }],
      },
    ],
  });

  const said = await askForUnprinted();
  const tables = (said.data || []).map((sale) => sale.table_number);

  expect(tables).toContain('FRESH');
});

test('and a stringified index is read as a number, not as text', async () => {
  /*
   * Some older documents carry last_printed_change_index as a string. The
   * JavaScript below parses it; the query has to as well, or the two disagree
   * about the same sale.
   */
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: earlierToday(10),
    table_number: 'OLD',
    last_printed_change_index: '0',
    items: [],
    changes: [
      {
        timestamp: earlierToday(10),
        items: [{ item_id: 'i-1', item_name: 'Butter Naan', item_quantity: 1, process: 'add' }],
      },
      {
        timestamp: earlierToday(10),
        items: [{ item_id: 'i-1', item_name: 'Butter Naan', item_quantity: 1, process: 'cancel' }],
      },
    ],
  });

  const said = await askForUnprinted();
  const tables = (said.data || []).map((sale) => sale.table_number);

  expect(tables).toContain('OLD');
});
