'use strict';

/*
 * A CALL THAT WAS ANSWERED STOPS ASKING.
 *
 * Owner: "i want option for customers call. example he is in table 7 and
 * wants to call waiter or captain... this biggest option i love."
 *
 * A call raises the same repeating alarm an order waiting for approval
 * raises, and deliberately so: it is the same kind of thing, in that nobody
 * is watching a screen and a person is sitting at a table waiting.
 *
 * But that alarm is only ever stopped by `posnic:order-resolved`, and the one
 * thing in the product that emitted it was the sweeper that decides
 * unanswered ORDERS - which reads the sales collection. A call does not live
 * there. Nothing else could reach the alarm either: the waiter who answers is
 * usually holding the handset, and the till making the noise never hears from
 * it.
 *
 * So a table called once, somebody walked over and pressed Got it, and the
 * desktop till went on escalating about it - louder, and further - for the
 * rest of the day. The feature the owner most wanted would have been the
 * first thing a shop muted, and muting it silences the orders too.
 *
 * Against a real MongoDB, because the whole question is what the repository
 * announces AFTER a write has actually landed. A fake collection would let
 * these pass while the real one matched nothing.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
const { ATTENTION_EVENT, RESOLVED_EVENT } = require('../../../src/helpers/order-attention');
const waiterCall = require('../../../src/utils/waiter-call');

let mem;
let calls;
let branches;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));
  calls = mongoose.connection.db.collection('waitercalls');
  branches = mongoose.connection.db.collection('branches');

  /*
   * The repository opens its own database through BaseModel rather than
   * taking one as an argument, so it is handed the memory server's. This is
   * the documented seam - initializeDB() leaves a database alone when
   * _connectedUri is null, because one that arrived without going through it
   * belongs to somebody else. That keeps these the REAL methods rather than a
   * copy of their logic.
   */
  BaseModel.database = mongoose.connection.db;
  BaseModel._connectedUri = null;
}, 60000);

afterAll(async () => {
  BaseModel.database = null;
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await calls.deleteMany({});
  await branches.deleteMany({});
  BaseModel.license = null;
});

/** Everything said on the bus while `work` runs, in order. */
async function listening(work) {
  const heard = { attention: [], resolved: [] };
  const onAttention = (payload) => heard.attention.push(payload);
  const onResolved = (payload) => heard.resolved.push(payload);
  process.on(ATTENTION_EVENT, onAttention);
  process.on(RESOLVED_EVENT, onResolved);
  try {
    heard.answer = await work();
  } finally {
    process.off(ATTENTION_EVENT, onAttention);
    process.off(RESOLVED_EVENT, onResolved);
  }
  return heard;
}

/** A restaurant, because a shop with no table service has no calls at all. */
async function aShopWithTables() {
  const written = await branches.insertOne({
    name: 'Seven Tables',
    table_options: true,
    online_ordering: { store_id: 'seven' },
  });
  return written.insertedId;
}

/** A call written straight in, so its age is ours to choose. */
async function aCallFrom(minutesAgo, branchId, extra = {}) {
  const written = await calls.insertOne({
    branch_id: branchId,
    table_number: '7',
    called_at: new Date(Date.now() - minutesAgo * 60000),
    seen_at: null,
    ...extra,
  });
  return written.insertedId;
}

describe('the alarm a call raises can be stopped', () => {
  test('answering a call says so on the bus the alarm listens on', async () => {
    const branchId = await aShopWithTables();
    const callId = await aCallFrom(1, branchId);

    const heard = await listening(() =>
      repo.seeWaiterCall({ branchId: String(branchId), callId: String(callId) })
    );

    expect(heard.answer.status).toBe(true);
    expect(heard.resolved).toHaveLength(1);
    expect(heard.resolved[0]).toMatchObject({
      saleId: String(callId),
      state: 'seen',
    });
  });

  test('the id it announces is the id the alarm was started with', async () => {
    /*
     * THE TEST THAT MATTERS.
     *
     * The alarm keeps a map keyed by the id it was raised with, and
     * `resolve(id)` deletes by that exact key. A resolution naming anything
     * else - the branch, the table, a sale - is a message that arrives,
     * matches nothing, and leaves the noise running while reading in the log
     * as though it stopped.
     */
    await aShopWithTables();

    const raised = await listening(() => repo.callTheWaiter({ branch: 'seven', table: '7' }));
    expect(raised.answer.status).toBe(true);
    expect(raised.attention).toHaveLength(1);
    /* The loud, repeating one - which is the whole reason it must be stopped. */
    expect(raised.attention[0].alert).toBe('waiting');

    const started = raised.attention[0].saleId;
    expect(started).toBeTruthy();

    const answered = await listening(() => repo.seeWaiterCall({ callId: started }));
    expect(answered.resolved).toHaveLength(1);
    expect(answered.resolved[0].saleId).toBe(started);
  });

  test('a call that was never there announces nothing', async () => {
    /*
     * A stopped alarm is a promise that somebody dealt with it, so it is only
     * ever sent after something actually moved. Silence on a write that
     * matched nothing would be a lie told quietly.
     */
    const branchId = await aShopWithTables();
    const heard = await listening(() =>
      repo.seeWaiterCall({
        branchId: String(branchId),
        callId: String(new mongoose.Types.ObjectId()),
      })
    );
    expect(heard.answer.status).toBe(false);
    expect(heard.resolved).toHaveLength(0);
  });
});

describe('a call nobody ever answered', () => {
  test('stops asking once it has aged out of the window', async () => {
    /*
     * At twenty minutes a call stops being drawn on every screen. Without
     * this the till would go on escalating about something no screen can show
     * and nobody can answer, which is exactly the kind of alarm that teaches
     * people to ignore alarms.
     */
    const branchId = await aShopWithTables();
    const stale = await aCallFrom(waiterCall.OPEN_FOR_MINUTES + 5, branchId);

    const heard = await listening(() => repo.openWaiterCalls({ branchId: String(branchId) }));

    expect(heard.answer).toHaveLength(0);
    expect(heard.resolved).toHaveLength(1);
    expect(heard.resolved[0]).toMatchObject({
      saleId: String(stale),
      state: 'unanswered',
    });
  });

  test('and one still inside the window is left alone', async () => {
    /* Until it ages out the customer is still sitting there, and the noise is
       the only thing telling anybody about it. */
    const branchId = await aShopWithTables();
    const fresh = await aCallFrom(2, branchId);

    const heard = await listening(() => repo.openWaiterCalls({ branchId: String(branchId) }));

    expect(heard.answer).toHaveLength(1);
    expect(heard.answer[0].call_id).toBe(String(fresh));
    expect(heard.resolved).toHaveLength(0);
  });

  test('a shop with one of each silences only the one that timed out', async () => {
    const branchId = await aShopWithTables();
    const stale = await aCallFrom(waiterCall.OPEN_FOR_MINUTES + 1, branchId, { table_number: '3' });
    const fresh = await aCallFrom(1, branchId, { table_number: '9' });

    const heard = await listening(() => repo.openWaiterCalls({ branchId: String(branchId) }));

    expect(heard.answer.map((row) => row.call_id)).toEqual([String(fresh)]);
    expect(heard.resolved.map((row) => row.saleId)).toEqual([String(stale)]);
  });
});
