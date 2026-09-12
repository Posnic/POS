'use strict';

/*
 * THE BILL, ASKED FOR FROM THE FLOOR.
 *
 * Owner: "can we add option from mobile take bill from mobile. is it
 * international standard or not ? ... also i was think settlement from mobile
 * app but usually cashier / desktop person only responsible and confirm the
 * settlement not waiter i thought."
 *
 * His reading is the standard one, and it is the rule this file exists to
 * hold: A WAITER MAY ASK FOR THE BILL AND MAY NOT SAY IT WAS PAID. The person
 * who takes the order must not be the person who declares the money received,
 * or a cash bill can be closed and pocketed with nothing in the system to
 * disagree. Toast, Square, Lightspeed, MICROS and Petpooja all let the floor
 * fire the bill; none of them let the floor settle it on the waiter's word.
 *
 * So most of what is tested here is what this path REFUSES to do.
 */

const path = require('path');
const repoPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'repositories',
  'sale.repository.js'
);
const salesRepository = require(repoPath);

/** A Sale model that records what it was asked to do, without a database. */
function fakeModel({ waiting = 1 } = {}) {
  const seen = { updates: [], queries: [], counted: null };
  return {
    seen,
    updateMany: async (query, update) => {
      seen.updates.push({ query, update });
      return { modifiedCount: 1 };
    },
    countDocuments: async (query) => {
      seen.counted = query;
      return waiting;
    },
    find: (query) => {
      seen.queries.push(query);
      return {
        sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'a' }] }) }),
      };
    },
  };
}

describe('a waiter asking for the bill', () => {
  test('marks the open tickets for that table', async () => {
    const Model = fakeModel();
    const out = await salesRepository.requestBillPrintModel('', 'T4', 'ravi', { SaleModel: Model });

    expect(out.status).toBe(true);
    const { query, update } = Model.seen.updates[0];
    expect(query.table_number).toBe('T4');
    expect(update.$set.bill_requested_at).toBeInstanceOf(Date);
    expect(update.$set.bill_requested_by).toBe('ravi');
  });

  test('NEVER writes payment_status', async () => {
    /*
     * THE WHOLE RULE, IN ONE ASSERTION. A printed bill is a request for money,
     * not a receipt of it. If this ever starts setting a payment field, a
     * waiter can close a bill and the cashier's drawer will never know.
     */
    const Model = fakeModel();
    await salesRepository.requestBillPrintModel('', 'T4', 'ravi', { SaleModel: Model });

    for (const { update } of Model.seen.updates) {
      const wrote = Object.keys(update.$set || {});
      expect(wrote).not.toContain('payment_status');
      expect(wrote).not.toContain('payment_mode');
      expect(wrote).not.toContain('paid_amount');
    }
  });

  test('only looks at tickets that are still unpaid', async () => {
    /*
     * The literal 'Unpaid', because that is the word createOnlineOrder writes
     * and getTablesWithActiveOrders reads. PAYMENT_STATUS has no UNPAID member
     * - reaching for one would have put `undefined` into the query, and Mongo
     * answers an undefined match with every document where the field is
     * missing, which is the opposite of narrowing.
     */
    const Model = fakeModel();
    await salesRepository.requestBillPrintModel('', 'T4', '', { SaleModel: Model });
    expect(Model.seen.updates[0].query.payment_status).toBe('Unpaid');
  });

  test('a table with nothing open is told so, rather than told yes', async () => {
    /* "The bill is on its way" and "there is nothing to bill" send a waiter to
       two different places. */
    const Model = fakeModel({ waiting: 0 });
    const out = await salesRepository.requestBillPrintModel('', 'T9', '', { SaleModel: Model });

    expect(out.status).toBe(false);
    expect(out.message).toMatch(/nothing is open/i);
  });

  test('asking twice does not produce two bills', async () => {
    /* Asking again is somebody wondering where the bill got to. Only tickets
       that have never been asked for are stamped. */
    const Model = fakeModel();
    await salesRepository.requestBillPrintModel('', 'T4', '', { SaleModel: Model });
    expect(Model.seen.updates[0].query.bill_requested_at).toEqual({ $in: [null, undefined] });
  });

  test('a request with no table is refused rather than billing everything', async () => {
    const Model = fakeModel();
    const out = await salesRepository.requestBillPrintModel('', '  ', '', { SaleModel: Model });

    expect(out.status).toBe(false);
    expect(Model.seen.updates).toHaveLength(0);
  });
});

describe('the till collecting what it owes the counter', () => {
  test('asks only for bills requested and not yet printed', async () => {
    const Model = fakeModel();
    await salesRepository.pendingBillPrintsModel('', { SaleModel: Model });

    const query = Model.seen.queries[0];
    expect(query.bill_requested_at).toEqual({ $ne: null, $exists: true });
    expect(query.bill_printed_at).toEqual({ $in: [null, undefined] });
  });

  test('the paper coming out is stamped separately from the asking', async () => {
    /*
     * Two fields and not one, because "somebody wants this billed" and "the
     * bill came out" are different facts. A till that dies mid-job asks again
     * when it returns, rather than a guest waiting for a bill the system
     * believes it already produced.
     */
    const Model = fakeModel();
    const id = '507f1f77bcf86cd799439011';
    await salesRepository.markBillPrintedModel([id], { SaleModel: Model });

    const { update } = Model.seen.updates[0];
    expect(update.$set.bill_printed_at).toBeInstanceOf(Date);
    expect(Object.keys(update.$set)).not.toContain('payment_status');
  });

  test('a rubbish id marks nothing at all', async () => {
    const Model = fakeModel();
    const out = await salesRepository.markBillPrintedModel(['not-an-id'], { SaleModel: Model });

    expect(out.status).toBe(false);
    expect(Model.seen.updates).toHaveLength(0);
  });
});

describe('the fields survive the schema', () => {
  test('all three are declared', () => {
    /*
     * The schema is STRICT: an undeclared field is stripped without a word.
     * invoice_key and source_invoice_id each shipped broken once for exactly
     * this reason, and both carry a comment saying so.
     */
    const fs = require('fs');
    const model = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'models', 'sale.model.js'),
      'utf8'
    );
    for (const field of ['bill_requested_at', 'bill_requested_by', 'bill_printed_at']) {
      expect(model.includes(`${field}: {`)).toBe(true);
    }
  });
});

describe('who is allowed to ask', () => {
  test('the handset route is not behind the installation key', () => {
    /*
     * ensureKioskKey is per INSTALLATION. A phone holding one would be a till,
     * and the key would be on a device that gets lost and sold. The waiter's
     * route is guarded like the floor screen it sits beside; the two printer
     * routes beside it are the machine talking to itself and keep the key.
     */
    const fs = require('fs');
    const routes = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'routes', 'sales.routes.js'),
      'utf8'
    );

    const at = routes.indexOf("'/requestBillPrint'");
    const block = routes.slice(at, at + 220);
    expect(block).toContain('protectOrKioskKey');
    expect(block).not.toContain('ensureKioskKey');

    for (const till of ["'/pendingBillPrints'", "'/markBillPrinted'"]) {
      const where = routes.indexOf(till);
      expect(routes.slice(where, where + 160)).toContain('ensureKioskKey');
    }
  });
});
