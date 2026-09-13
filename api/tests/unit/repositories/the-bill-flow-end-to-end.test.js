'use strict';

/*
 * THE WHOLE BILL FLOW, AGAINST A REAL DATABASE.
 *
 * Owner: "when app give print bill it was not working. have you tested its
 * working ? what was the issue before ?"
 *
 * The honest answers were no, and: I had added a `license` clause the query
 * that DRAWS THE FLOOR does not have. getTablesWithActiveOrders matches branch,
 * sale_process and payment_status and nothing else - so the table appeared, the
 * waiter tapped Print bill, and the answer was "Nothing is open on that table"
 * about an order they were looking at.
 *
 * It is not a boundary being dropped. Each shop has its own DATABASE; the
 * connection is the tenancy boundary, which is why the floor query has never
 * needed a licence clause and why the two are safe to agree.
 *
 * WHY THE OLD TESTS PASSED. They used a fake model, so nothing was ever
 * matched against anything - the query object was inspected, not run. These
 * use mongodb-memory-server and walk all three steps in order, because the
 * second half of this bug only appeared once the first was fixed: the request
 * started working and the till still saw nothing.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const Sale = require('../../../src/models/sale.model');
const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await Sale.deleteMany({});
  BaseModel.license = null;
});

const openTicket = (branch, table = 'T1') =>
  Sale.create({
    branch_id: branch,
    sale_process: 'KOT',
    table_number: table,
    payment_status: 'Unpaid',
    sales_total: 440,
  });

describe('a bill asked for from the floor', () => {
  test('is found on a shop that has a licence set', async () => {
    /*
     * THE BUG, PINNED. With BaseModel.license set, the ticket vanished from
     * the bill query while staying on the floor. A sale written by the handset
     * carries no licence field of its own, so the clause matched nothing.
     */
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch);
    BaseModel.license = 'SHOP-LICENCE-123';

    const out = await repo.requestBillPrintModel(String(branch), 'T1', 'ravi');
    expect(out.status).toBe(true);
    expect(out.message).toMatch(/on its way/i);
  });

  test('and the till can then collect it', async () => {
    /*
     * The half that only appeared once the first was fixed. The request
     * started working and pendingBillPrints still answered nothing, because it
     * carried the same clause - so a waiter would have been told the bill was
     * on its way to a counter that was never going to hear about it.
     */
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch);
    BaseModel.license = 'SHOP-LICENCE-123';

    await repo.requestBillPrintModel(String(branch), 'T1', 'ravi');
    const pending = await repo.pendingBillPrintsModel(String(branch));
    expect(pending.data).toHaveLength(1);
  });

  test('and marking it printed takes it off the list', async () => {
    /* A licence clause here would have let a bill print and then refused to
       record that it had - so it would print again on every pass, for ever. */
    const branch = new mongoose.Types.ObjectId();
    const sale = await openTicket(branch);
    BaseModel.license = 'SHOP-LICENCE-123';

    await repo.requestBillPrintModel(String(branch), 'T1', 'ravi');
    const marked = await repo.markBillPrintedModel([String(sale._id)]);
    expect(marked.data.marked).toBe(1);

    const after = await repo.pendingBillPrintsModel(String(branch));
    expect(after.data).toHaveLength(0);
  });

  test('printing a bill never marks it paid', async () => {
    /* The rule the whole feature is built around: a waiter asks, the cashier
       settles. A printed bill is a request for money, not a receipt of it. */
    const branch = new mongoose.Types.ObjectId();
    const sale = await openTicket(branch);

    await repo.requestBillPrintModel(String(branch), 'T1', 'ravi');
    await repo.markBillPrintedModel([String(sale._id)]);

    const after = await Sale.findById(sale._id).lean();
    expect(after.payment_status).toBe('Unpaid');
  });

  test('the bill query asks for no more than the floor query does', async () => {
    /*
     * THE RULE THAT WOULD HAVE CAUGHT THIS. Every ticket the floor counts as
     * active has to be one this can bill. Narrower here means a table somebody
     * can see and cannot bill, which is precisely what was reported.
     */
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch, 'T1');
    await openTicket(branch, 'T2');
    BaseModel.license = 'SHOP-LICENCE-123';

    const onTheFloor = await Sale.countDocuments({
      branch_id: branch,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    });

    let billable = 0;
    for (const table of ['T1', 'T2']) {
      const out = await repo.requestBillPrintModel(String(branch), table, '');
      if (out.status) billable += out.data.waiting;
    }
    expect(billable).toBe(onTheFloor);
  });

  test('a table with nothing open is still told so', async () => {
    /* The fix must not make the query so loose that it says yes to anything. */
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch, 'T1');

    const out = await repo.requestBillPrintModel(String(branch), 'T9', '');
    expect(out.status).toBe(false);
    expect(out.message).toMatch(/nothing is open/i);
  });

  test('a settled table is not billed again', async () => {
    const branch = new mongoose.Types.ObjectId();
    await Sale.create({
      branch_id: branch,
      sale_process: 'KOT',
      table_number: 'T5',
      payment_status: 'Paid',
      sales_total: 100,
    });

    const out = await repo.requestBillPrintModel(String(branch), 'T5', '');
    expect(out.status).toBe(false);
  });

  test('asking announces it, so a local till prints without polling', async () => {
    /*
     * Owner: "i want proper and fastest solution."
     *
     * On the shop's own Wi-Fi this very call is being handled BY THE TILL -
     * the API is require()d into the desktop's main process - so the emit
     * reaches the printer in the same tick. The poll underneath is for cloud
     * shops, which cannot be reached from outside their own router.
     */
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch, 'T4');

    const heard = [];
    const listener = (payload) => heard.push(payload);
    process.on('posnic:bill-requested', listener);
    try {
      await repo.requestBillPrintModel(String(branch), 'T4', 'ravi');
    } finally {
      process.removeListener('posnic:bill-requested', listener);
    }

    expect(heard).toHaveLength(1);
    expect(heard[0].table).toBe('T4');
    expect(String(heard[0].branchId)).toBe(String(branch));
  });

  test('a request that marked nothing announces nothing', async () => {
    /* Waking the printer to find an empty list is a wasted spin-up and a log
       line that means nothing. */
    const branch = new mongoose.Types.ObjectId();

    const heard = [];
    const listener = () => heard.push(1);
    process.on('posnic:bill-requested', listener);
    try {
      await repo.requestBillPrintModel(String(branch), 'T-nothing-here', '');
    } finally {
      process.removeListener('posnic:bill-requested', listener);
    }

    expect(heard).toHaveLength(0);
  });
});
