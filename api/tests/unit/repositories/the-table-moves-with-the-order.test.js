'use strict';

/*
 * THE TABLE'S ID MOVES WITH ITS NUMBER.
 *
 * A waiter moving an order from table 4 to table 12 sends both the new number
 * and the new table's id. Only the number was ever written. The order then
 * read "table 12" while still pointing at table 4's id.
 *
 * Nothing complained, and that is the part worth a test: every screen draws
 * the floor by NUMBER, so all of them agreed while the record underneath them
 * did not. A field that is only read by reports and payloads is exactly the
 * kind that stays wrong for a year.
 *
 * Against a real mongod, because the question is what the database ends up
 * holding, and a mock would only prove I can write down what I already
 * believe.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();
const TABLE_FOUR = new mongoose.Types.ObjectId();
const TABLE_TWELVE = new mongoose.Types.ObjectId();

const ITEM = new mongoose.Types.ObjectId();

/** An order sitting on table 4, one dish on it. */
async function orderOnTableFour() {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    sale_process: 'KOT',
    created_date: new Date(),
    table_number: '4',
    table_id: String(TABLE_FOUR),
    dine_type: 'Dine-in',
    items: [{ item_id: ITEM, item_name: 'Chicken Biryani', item_quantity: 1, item_price: 220 }],
  });
  return String(_id);
}

/** The order as the database holds it now. */
const asStored = async (id) =>
  db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId(id) });

/** One line, the shape the handset sends back when it saves. */
const oneDish = [
  { item_id: String(ITEM), item_name: 'Chicken Biryani', item_quantity: 1, item_price: 220 },
];

/** Move it, the way /sales/updateOrder does. */
const move = (id, { number, tableId }) =>
  repo.updateOrderModel(
    id,
    oneDish,
    220,
    null,
    null,
    null,
    null,
    number,
    'Dine-in',
    2,
    tableId === undefined ? {} : { newTableId: tableId }
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
  await db.collection('items').insertOne({
    _id: ITEM,
    license: LICENSE,
    item_name: 'Chicken Biryani',
    item_price: 220,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('moving an order to another table', () => {
  test('THE RECORD MOVES TOO, not just the number on it', async () => {
    const id = await orderOnTableFour();

    await move(id, { number: '12', tableId: String(TABLE_TWELVE) });

    const stored = await asStored(id);
    expect(stored.table_number).toBe('12');
    expect(String(stored.table_id)).toBe(String(TABLE_TWELVE));
  });

  test('a table typed in by hand clears the id rather than keeping the old one', async () => {
    /*
     * A number somebody typed has no table behind it. Keeping table 4's id on
     * an order now sitting at "T1" is the same lie in a quieter voice.
     */
    const id = await orderOnTableFour();

    await move(id, { number: 'T1', tableId: '' });

    const stored = await asStored(id);
    expect(stored.table_number).toBe('T1');
    expect(stored.table_id).toBe('');
  });

  test('a caller that knows no ids still does not leave a pointer to the old table', async () => {
    /*
     * The till's own KOT screen sends the number alone. Wrong and visible is
     * recoverable; wrong and invisible is the thing this fixes.
     */
    const id = await orderOnTableFour();

    await move(id, { number: '12' });

    const stored = await asStored(id);
    expect(stored.table_number).toBe('12');
    expect(stored.table_id).toBe('');
  });

  test('an edit that does not move the order leaves its table alone', async () => {
    /* Every other save goes through here too. Clearing the id on an ordinary
       item change would be a fix that broke more than it mended. */
    const id = await orderOnTableFour();

    await move(id, { number: '4' });

    const stored = await asStored(id);
    expect(stored.table_number).toBe('4');
    expect(String(stored.table_id)).toBe(String(TABLE_FOUR));
  });
});
