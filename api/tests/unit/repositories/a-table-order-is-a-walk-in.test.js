'use strict';

/*
 * A GUEST WHO GAVE NOTHING IS THE SHOP'S WALK-IN.
 *
 * Owner, holding a bill from Azure with `+910000000000` printed on it: "The
 * captain app sends +910000000000 because something has to fill the field. why
 * sendnig like this?" and then: "until captain enter guest nuber better keep
 * guest as walk in."
 *
 * The handset posts to an endpoint built for a customer ordering from their
 * own phone, where that field is the guest's number. A waiter at a table has
 * none, so the app invented one - and an online order was written with no
 * customer record at all, just loose strings, so the invented number was the
 * only thing in that space.
 *
 * Every branch already has a Walk-in Customer: the till attaches it to counter
 * sales, and the installer and the settings screen both keep it healed. An
 * order taken at a table belongs to exactly that person.
 *
 * Against a real MongoDB, because the whole question is which record the sale
 * ends up pointing at.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');
const { isDialable } = require('../../../src/helpers/bill-payload');

let mem;
let db;
let customers;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  db = mongoose.connection.db;
  customers = db.collection('customers');
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await customers.deleteMany({});
});

const BRANCH = () => ({
  _id: new mongoose.Types.ObjectId(),
  license: 'SHOP-1',
  branch_name: 'Azure Sea Foods',
});

describe('finding the shop its own walk-in', () => {
  test('the branch points at one, and that is who it is', async () => {
    const branch = BRANCH();
    const { insertedId } = await customers.insertOne({
      branch_id: branch._id,
      license: branch.license,
      name: 'Walk-in Customer',
      phone: '',
    });
    branch.default_customer = insertedId;

    const walkIn = await repo._walkInCustomer(db, branch);

    expect(String(walkIn.id)).toBe(String(insertedId));
    expect(walkIn.name).toBe('Walk-in Customer');
  });

  test('no pointer, so it is found by what it is called', async () => {
    /* Older branches and restored data do not always carry the pointer; the
       settings screen heals it by the same name search. */
    const branch = BRANCH();
    const { insertedId } = await customers.insertOne({
      branch_id: branch._id,
      license: branch.license,
      name: 'Walk in customer',
    });

    const walkIn = await repo._walkInCustomer(db, branch);

    expect(String(walkIn.id)).toBe(String(insertedId));
  });

  test("another shop's walk-in is never borrowed", async () => {
    /* Two branches in one database is the shape that makes this matter. */
    const mine = BRANCH();
    const theirs = BRANCH();
    await customers.insertOne({
      branch_id: theirs._id,
      license: theirs.license,
      name: 'Walk-in Customer',
    });

    const walkIn = await repo._walkInCustomer(db, mine);

    expect(walkIn.id).toBeNull();
    expect(walkIn.name).toBe('Walk-in Customer');
  });

  test('a pointer at a record that is gone falls back to the search', async () => {
    const branch = BRANCH();
    branch.default_customer = new mongoose.Types.ObjectId();
    const { insertedId } = await customers.insertOne({
      branch_id: branch._id,
      license: branch.license,
      name: 'Walk-in Customer',
    });

    const walkIn = await repo._walkInCustomer(db, branch);

    expect(String(walkIn.id)).toBe(String(insertedId));
  });

  test('a shop with no walk-in record still gets the name, and no error', async () => {
    /*
     * A sale must never fail over who the guest is. The name alone is enough
     * for the report and the bill; the missing record is a separate problem,
     * and the settings screen creates one the next time it is opened.
     */
    const walkIn = await repo._walkInCustomer(db, BRANCH());

    expect(walkIn).toEqual({ id: null, name: 'Walk-in Customer' });
  });

  test('a broken connection is survived, not thrown', async () => {
    const broken = {
      collection() {
        throw new Error('no connection');
      },
    };

    await expect(repo._walkInCustomer(broken, BRANCH())).resolves.toEqual({
      id: null,
      name: 'Walk-in Customer',
    });
  });
});

describe('who counts as having said who they are', () => {
  /*
   * The sale and the printed bill ask ONE function, so they cannot disagree
   * about whether a guest is known - a sale filed under a guest whose receipt
   * says there was no guest is the kind of mismatch nobody finds for months.
   */
  test('the number the handset used to invent is not a number', () => {
    expect(isDialable('+910000000000')).toBe(false);
    expect(isDialable('0000000000')).toBe(false);
    expect(isDialable('9999999999')).toBe(false);
  });

  test('a real number is a number, Indian or not', () => {
    expect(isDialable('+919688365318')).toBe(true);
    expect(isDialable('9688365318')).toBe(true);
    expect(isDialable('+442079460958')).toBe(true);
  });

  test('nothing is not a number', () => {
    expect(isDialable('')).toBe(false);
    expect(isDialable(null)).toBe(false);
    expect(isDialable(undefined)).toBe(false);
  });

  test('a number with repeated digits inside it still dials', () => {
    /* 8 in a row is the line, and it is drawn well past anything real. */
    expect(isDialable('9000000123')).toBe(true);
    expect(isDialable('9111111123')).toBe(true);
  });
});
