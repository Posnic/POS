'use strict';

/*
 * AN ORDER ANSWERED ANYWHERE STOPS THE ALARM.
 *
 * An online order arriving for approval raises the repeating, escalating
 * alarm (helpers/order-attention.js). Until now the only thing that ever
 * stopped it from a person's decision was the Online orders PAGE telling the
 * desktop main process by hand, through `silence(saleId)`.
 *
 * So an order answered anywhere else left the till nagging about an order
 * that had been dealt with:
 *
 *   - from the request dock, which is reachable from every other screen
 *   - from the CAPTAIN HANDSET, which never talks to that main process at
 *     all - and a restaurant with a handset is exactly the shop where an
 *     order arrives with nobody standing at the till
 *
 * The alarm belongs to the order rather than to the screen that answered it,
 * so it is stopped from `decideOnOrder`: the one door a person, the shop's
 * own rule and the handset all go through.
 *
 * AND ONLY WHEN THE WRITE MATCHED. decideOnOrder narrows both its read and
 * its write by whatever tenant the process was last serving. The read refuses
 * first, so a mismatch answers no rather than a false yes - but the two
 * narrowings are separate lines, and a promise that somebody dealt with an
 * order should not rest on them agreeing. Silence is only ever earned.
 *
 * Against a real MongoDB, because every one of those sentences is about what
 * actually landed.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
const { RESOLVED_EVENT } = require('../../../src/helpers/order-attention');
const orderApproval = require('../../../src/utils/order-approval');

let mem;
let sales;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  sales = mongoose.connection.db.collection('sales');

  /* The documented seam: initializeDB() leaves a database alone when
     _connectedUri is null, because one that arrived without going through it
     belongs to somebody else. That keeps this the REAL method. */
  BaseModel.database = mongoose.connection.db;
  BaseModel._connectedUri = null;
}, 60000);

afterAll(async () => {
  BaseModel.database = null;
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await sales.deleteMany({});
  BaseModel.license = null;
  BaseModel.currentBranch = null;
  BaseModel.loggedUserName = 'Amudha';
});

/** Everything said on the resolved bus while `work` runs. */
async function listening(work) {
  const heard = [];
  const listener = (payload) => heard.push(payload);
  process.on(RESOLVED_EVENT, listener);
  try {
    heard.answer = await work();
  } finally {
    process.off(RESOLVED_EVENT, listener);
  }
  return heard;
}

/** An order the kitchen has not been told about, waiting for somebody. */
async function waitingForSomebody(extra = {}) {
  const written = await sales.insertOne({
    sale_process: 'KOT',
    order_state: orderApproval.ORDER_STATE.PENDING,
    branch_id: new mongoose.Types.ObjectId(),
    sales_total: 420,
    created_date: new Date(),
    ...extra,
  });
  return String(written.insertedId);
}

describe('answering an order stops it asking', () => {
  test('accepting says so, naming the order the alarm was raised with', async () => {
    const saleId = await waitingForSomebody();

    const heard = await listening(() =>
      repo.decideOnOrder({ saleId, decision: orderApproval.ORDER_STATE.ACCEPTED, reason: '' })
    );

    expect(heard.answer.status).toBe(true);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      saleId,
      state: orderApproval.ORDER_STATE.ACCEPTED,
      /* The alarm deletes by this exact key, so anything else would arrive,
         match nothing, and leave the noise running while reading in the log
         as though it stopped. */
      by: 'person',
    });
  });

  test('so does turning one away, because the customer is no longer waiting either', async () => {
    const saleId = await waitingForSomebody();

    const heard = await listening(() =>
      repo.decideOnOrder({
        saleId,
        decision: orderApproval.ORDER_STATE.REJECTED,
        reason: 'kitchen closed',
      })
    );

    expect(heard).toHaveLength(1);
    expect(heard[0].state).toBe(orderApproval.ORDER_STATE.REJECTED);
  });

  test('the shop own rule is named as the rule, not as a person', async () => {
    /* A shop asking later who cancelled an order deserves the true answer,
       and "the ten minute rule" and "Amudha" are different answers. */
    const saleId = await waitingForSomebody();

    const heard = await listening(() =>
      repo.decideOnOrder({
        saleId,
        decision: orderApproval.ORDER_STATE.REJECTED,
        reason: 'nobody answered',
        by: 'rule',
      })
    );

    expect(heard[0].by).toBe('rule');
  });

  test('and the order really moved, not just the announcement', async () => {
    const saleId = await waitingForSomebody();
    await repo.decideOnOrder({ saleId, decision: orderApproval.ORDER_STATE.ACCEPTED, reason: '' });

    const fresh = await sales.findOne({ _id: new mongoose.Types.ObjectId(saleId) });
    expect(fresh.order_state).toBe(orderApproval.ORDER_STATE.ACCEPTED);
  });
});

describe('silence is only ever earned', () => {
  test('another tenant cannot answer this order, and nothing is announced', async () => {
    /*
     * THE ONE THAT MATTERS.
     *
     * Both the read and the write are narrowed by whatever tenant the process
     * was last serving - a module-level license and branch that a request in
     * flight sets and a background sweep does not own. unanswered-orders.js
     * warns about exactly this: point it elsewhere and the decision touches
     * nothing while still reading like it worked.
     *
     * The read refuses first, so the method says no and the order is
     * untouched. The announcement is gated on the WRITE having matched all
     * the same, because the two narrowings are separate lines and a promise
     * that somebody dealt with an order should not rest on them agreeing.
     */
    const saleId = await waitingForSomebody({ license: 'SHOP-1' });
    BaseModel.license = 'SOMEBODY-ELSE';

    const heard = await listening(() =>
      repo.decideOnOrder({ saleId, decision: orderApproval.ORDER_STATE.ACCEPTED, reason: '' })
    );

    expect(heard.answer.status).toBe(false);
    expect(heard).toHaveLength(0);

    /* And the order is exactly where it was. */
    const fresh = await sales.findOne({ _id: new mongoose.Types.ObjectId(saleId) });
    expect(fresh.order_state).toBe(orderApproval.ORDER_STATE.PENDING);
  });

  test('the announcement is gated on the write, not on the answer', async () => {
    /* Said in source because the two narrowings cannot be made to disagree
       from outside: the read refuses first. It is a belt, and it should stay
       one - a future change that moves the read is what it is there for. */
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'sale.repository.js'),
      'utf8'
    );
    expect(source).toMatch(/if \(written && written\.matchedCount\)/);
    expect(source).toMatch(/matchedCount[\s\S]{0,200}notifyOrderResolved\(/);
  });

  test('a decision the state machine refuses announces nothing', async () => {
    const saleId = await waitingForSomebody({ order_state: orderApproval.ORDER_STATE.REJECTED });

    const heard = await listening(() =>
      repo.decideOnOrder({ saleId, decision: orderApproval.ORDER_STATE.ACCEPTED, reason: '' })
    );

    expect(heard.answer.status).toBe(false);
    expect(heard).toHaveLength(0);
  });

  test('an order that is not there announces nothing', async () => {
    const heard = await listening(() =>
      repo.decideOnOrder({
        saleId: String(new mongoose.Types.ObjectId()),
        decision: orderApproval.ORDER_STATE.ACCEPTED,
        reason: '',
      })
    );

    expect(heard.answer.status).toBe(false);
    expect(heard).toHaveLength(0);
  });
});
