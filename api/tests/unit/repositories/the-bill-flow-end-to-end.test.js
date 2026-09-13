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
const PrintJob = require('../../../src/models/print-job.model');
const queue = require('../../../src/repositories/print-job.repository');

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
  await PrintJob.deleteMany({});
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

/*
 * THE QUEUE, AGAINST THE SAME REAL DATABASE.
 *
 * Owner: "there should be way to communicate the till via localhos or via
 * cloude. thats the whole point. make it happen. may be seperate collection for
 * print ? need solution that which till need to send for bill also there."
 *
 * The same discipline as the tests above, for the same reason: the last bug
 * here only appeared when the three steps were walked IN ORDER, and a fake
 * model would have inspected the queries rather than running them.
 *
 * What is being proved is the whole reason the queue exists - a till can take
 * a bill off it and print it WITHOUT owning the sale, which is the only way a
 * shop whose handsets are not on its own Wi-Fi can work at all.
 */
describe('the queue between the floor and the counter', () => {
  const askForABill = async (branch, table = 'T1') => {
    await openTicket(branch, table);
    return repo.requestBillPrintModel(String(branch), table, 'ravi');
  };

  test('asking for a bill puts a job on the queue', async () => {
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    const jobs = await PrintJob.find({ branch_id: branch }).lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('bill');
    expect(jobs[0].status).toBe('queued');
  });

  test('the job carries a bill a printer can print, not a sale to look up', async () => {
    /*
     * THE BLANK-BILL BUG, PINNED AT THE FAR END.
     *
     * The job used to carry the sale document. src/escpos-receipt.js reads a
     * view model - `items[].name`, `total` - and the document has
     * `items[].item_name` and `sales_total`, so every lookup missed and the
     * paper came out with an empty item table and a total of 0.00.
     *
     * It has to be built HERE, not on the till: a till paired to a cloud
     * tenant has no copy of this database, so anything it would look up is
     * something it cannot look up.
     */
    const branch = new mongoose.Types.ObjectId();
    await Sale.create({
      branch_id: branch,
      sale_process: 'KOT',
      table_number: 'T7',
      payment_status: 'Unpaid',
      sales_id: 'INV-900',
      items: [
        {
          item: new mongoose.Types.ObjectId(),
          name: 'Idli',
          quantity: 2,
          unit_price: 30,
          total: 60,
        },
      ],
      sales_sub_total: 60,
      sales_total: 60,
    });
    await repo.requestBillPrintModel(String(branch), 'T7', 'ravi');

    const job = await PrintJob.findOne({ branch_id: branch }).lean();
    expect(job.payload.items).toEqual([{ name: 'Idli', qty: '2', amount: 60 }]);
    expect(job.payload.total).toBe(60);
    expect(job.payload.billNo).toBe('INV-900');
    expect(job.payload.title).toBe('BILL');
  });

  test('a till takes it off, and nobody else can', async () => {
    /*
     * THE CORRECTNESS ARGUMENT OF THE WHOLE FEATURE. Read-then-mark is two
     * operations with a gap, and in that gap a second till reads the same
     * list - so a shop prints every bill twice on exactly the days it is busy
     * enough to have two tills running.
     */
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    const [counter, upstairs] = await Promise.all([
      queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' }),
      queue.claimPrintJobs({ branchId: String(branch), tillId: 'UPSTAIRS' }),
    ]);

    const took = counter.data.length + upstairs.data.length;
    expect(took).toBe(1);
  });

  test('a job addressed to one till is not taken by another', async () => {
    /* Owner: "need solution that which till need to send for bill also there."
       Two printers in two rooms; a bill for the counter must not come out
       beside the cook. */
    const branch = new mongoose.Types.ObjectId();
    await queue.queuePrintJob({
      branchId: String(branch),
      tillId: 'COUNTER',
      kind: 'bill',
      payload: { total: 10 },
    });

    const wrong = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'UPSTAIRS' });
    expect(wrong.data).toHaveLength(0);

    const right = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    expect(right.data).toHaveLength(1);
  });

  test('a job addressed to nobody in particular is taken by whoever asks', async () => {
    /* The ordinary shop: one till, one printer, nothing configured. */
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    const out = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'ANY-OLD-PC' });
    expect(out.data).toHaveLength(1);
  });

  test("one shop cannot claim another shop's bills", async () => {
    const mine = new mongoose.Types.ObjectId();
    const theirs = new mongoose.Types.ObjectId();
    await askForABill(mine);

    const out = await queue.claimPrintJobs({ branchId: String(theirs), tillId: 'T' });
    expect(out.data).toHaveLength(0);
  });

  test('a printed job is closed and never offered again', async () => {
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    const first = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    await queue.finishPrintJob(String(first.data[0]._id), { ok: true });

    const again = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    expect(again.data).toHaveLength(0);

    const job = await PrintJob.findById(first.data[0]._id).lean();
    expect(job.status).toBe('done');
    expect(job.printed_at).toBeInstanceOf(Date);
  });

  test('a printer that refused gets the bill offered again', async () => {
    /* Dropping it would lose the bill for good, and the only person who knows
       is the guest still waiting. */
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    const first = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    await queue.finishPrintJob(String(first.data[0]._id), { ok: false, error: 'offline' });

    const again = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    expect(again.data).toHaveLength(1);
    expect(again.data[0].last_error).toBe('offline');
  });

  test('a bill that has failed all day stops going round', async () => {
    /* A printer switched off at the wall would otherwise cycle for the rest of
       the day. It stays in the collection, failed, where somebody can see it. */
    const branch = new mongoose.Types.ObjectId();
    await askForABill(branch);

    for (let i = 0; i < 8; i += 1) {
       
      const got = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
      if (!got.data.length) break;
       
      await queue.finishPrintJob(String(got.data[0]._id), { ok: false, error: 'offline' });
    }

    const last = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    expect(last.data).toHaveLength(0);
  });

  test('a table with three rounds gets three slips', async () => {
    const branch = new mongoose.Types.ObjectId();
    await openTicket(branch, 'T9');
    await openTicket(branch, 'T9');
    await openTicket(branch, 'T9');

    await repo.requestBillPrintModel(String(branch), 'T9', 'ravi');

    const out = await queue.claimPrintJobs({ branchId: String(branch), tillId: 'COUNTER' });
    expect(out.data).toHaveLength(3);
  });

  test('queueing wakes a till that is holding for one', async () => {
    /*
     * What makes the cloud path fast rather than merely possible: the till's
     * claim is held open for up to twenty seconds, and this is what ends it.
     */
    const pace = require('../../../src/helpers/print-pace');
    const branch = new mongoose.Types.ObjectId();

    const waiting = pace.waitForJob(String(branch), 3000);
    await askForABill(branch);

    await expect(waiting).resolves.toBe(true);
  });
});
