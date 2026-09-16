'use strict';

/*
 * An order nobody answered is finally answered, or finally left alone.
 *
 * Owner: "let restaurent owner decide that. give option auto cancel or auto
 * accept. based ont time he defines it. by default dont accpept or reject."
 *
 * WHAT THIS REPLACES
 *
 * waiting-order-policy.js was written, tested and merged, and decided
 * perfectly for nobody. `setPolicy()` on the till was called from nowhere, so
 * the policy was always "nothing"; and when it did speak, the till emitted an
 * event NOTHING LISTENED TO and then dropped the order from its pending map -
 * so the alarm went quiet with the order still sitting there. A stopped alarm
 * is a promise that somebody dealt with it, and that promise was false.
 *
 * The tests below are in the order of the ways this can go wrong, worst first:
 * cancelling an order nobody asked to cancel, then failing to act at all.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const sweeper = require('../../../src/services/unanswered-orders');
const BaseModel = require('../../../src/models/base.model');

let mem;
let db;

const BRANCH = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();
const M = 60 * 1000;

/** A shop that has asked for something to happen. */
function shopWants(values) {
  return jest
    .spyOn(sweeper._settings(), 'resolveGroup')
    .mockResolvedValue({ status: true, data: { values: values || {} } });
}

/** An online order, held, placed this many minutes ago. */
async function held(minutesAgo, over = {}) {
  const _id = new mongoose.Types.ObjectId();
  await db.collection('sales').insertOne({
    _id,
    branch_id: BRANCH,
    license: LICENSE,
    order_state: 'pending',
    sale_process: 'KOT',
    created_date: new Date(Date.now() - minutesAgo * M),
    ...over,
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
  await db.collection('sales').deleteMany({});
  await db.collection('branches').deleteMany({});
  await db.collection('branches').insertOne({ _id: BRANCH, license: LICENSE });
});

afterEach(() => {
  sweeper.stop();
  jest.restoreAllMocks();
});

/**
 * A stand-in for the repository, so nothing here can print.
 *
 * It MOVES THE ORDER, because the real one does and because the sweep reads
 * the state back before it announces anything - see `lyingRepository` below
 * for what happens when a decision only says it worked.
 */
function fakeRepository({ status = true, moves = true } = {}) {
  const calls = [];
  return {
    calls,
    /*
     * ONE ARGUMENT, AN OBJECT - because that is what the real function takes.
     *
     * This fake used to take three positional arguments, and the sweep called
     * it that way, and every test here passed. The REAL decideOnOrder takes
     * `{ saleId, decision, reason }`, so in production `saleId` was undefined,
     * the guard answered "Enter must correct order id", and the shop rule the
     * owner asked for decided precisely nothing.
     *
     * A fake that speaks a language the real thing does not is a test that
     * proves the caller agrees with itself. The contract is now pinned
     * against the real module below, which is the only thing that can catch
     * this shape.
     */
    decideOnOrder: jest.fn(async ({ saleId, decision, reason } = {}) => {
      calls.push({ saleId, decision, reason });
      if (status && moves && saleId) {
        await db
          .collection('sales')
          .updateOne(
            { _id: new mongoose.Types.ObjectId(saleId) },
            { $set: { order_state: decision, order_state_at: new Date() } }
          );
      }
      return { status, message: 'ok', data: { sale_id: saleId, state: decision } };
    }),
  };
}

/**
 * A decision that reports success and changes nothing.
 *
 * Not hypothetical: decideOnOrder narrows its write by whatever tenant the
 * PROCESS was last serving, and answers success on what it asked for rather
 * than on what changed. If that write matches nothing, an alarm would stop for
 * an order still sitting in the queue.
 */
const lyingRepository = () => fakeRepository({ status: true, moves: false });

/* ------------------------------------- 1. it does nothing unless asked to */

describe('a shop that has chosen nothing gets nothing', () => {
  test('AN UNCONFIGURED SHOP NEVER HAS AN ORDER DECIDED FOR IT', async () => {
    /*
     * The one that must never fail. A product that cancels a customer's order
     * because a shop never opened a settings page has made a decision that
     * was not its to make - and the shop finds out from the customer.
     */
    shopWants({});
    await held(600);
    const Repository = fakeRepository();
    const out = await sweeper.sweepOnce({ Repository });

    expect(Repository.decideOnOrder).not.toHaveBeenCalled();
    expect(out.branches).toBe(0);
    expect(out.decided).toEqual([]);
  });

  test('and neither does a shop whose settings cannot be read at all', async () => {
    jest
      .spyOn(sweeper._settings(), 'resolveGroup')
      .mockRejectedValue(new Error('the database is gone'));
    await held(600);
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).not.toHaveBeenCalled();
  });

  test('HALF A RULE IS NOT A RULE', async () => {
    /* A choice with no time fires immediately; a time with no choice fires
       nothing. Either half alone is something nobody finished saying. */
    for (const values of [
      { online_order_on_silence: 'cancel' },
      { online_order_on_silence: 'cancel', online_order_decide_after_minutes: 0 },
      { online_order_decide_after_minutes: 10 },
      { online_order_on_silence: 'explode', online_order_decide_after_minutes: 1 },
    ]) {
      shopWants(values);
      const Repository = fakeRepository();
      await sweeper.sweepOnce({ Repository });
      expect(Repository.decideOnOrder).not.toHaveBeenCalled();
    }
  });

  test('a shop that asked is not acted on before its own time is up', async () => {
    shopWants({ online_order_on_silence: 'cancel', online_order_decide_after_minutes: 10 });
    await held(9);
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------- 2. and it does act when asked */

describe('and when it has chosen, it fires on its own clock', () => {
  test('ACCEPT SENDS IT TO THE KITCHEN THROUGH THE SAME DOOR A PERSON USES', async () => {
    /*
     * decideOnOrder is what the approval queue calls: it moves the state,
     * stamps it and prints the kitchen ticket on the move to accepted, and
     * only then. A second path writing the state itself would sooner or later
     * stop printing, or print twice.
     */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    const saleId = await held(11);
    const Repository = fakeRepository();
    const out = await sweeper.sweepOnce({ Repository });

    expect(Repository.decideOnOrder).toHaveBeenCalledTimes(1);
    expect(Repository.calls[0].saleId).toBe(saleId);
    expect(Repository.calls[0].decision).toBe('accepted');
    expect(out.decided).toHaveLength(1);
  });

  test('cancel turns it away, and says why', async () => {
    shopWants({ online_order_on_silence: 'cancel', online_order_decide_after_minutes: 5 });
    await held(6);
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });

    expect(Repository.calls[0].decision).toBe('rejected');
    /* Every decision carries a reason, because a shop will ask. */
    expect(String(Repository.calls[0].reason).length).toBeGreaterThan(10);
    expect(Repository.calls[0].reason).toMatch(/5 minutes/);
  });

  test('AND THE ALARM IS TOLD, so it stops asking about something that is done', async () => {
    /*
     * The other half of the old bug. The till used to silence itself the
     * moment its policy spoke, before anything happened. Now the noise stops
     * only after the order has actually moved.
     */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    const saleId = await held(11);
    const heard = [];
    const listener = (payload) => heard.push(payload);
    process.on('posnic:order-resolved', listener);
    try {
      await sweeper.sweepOnce({ Repository: fakeRepository() });
    } finally {
      process.off('posnic:order-resolved', listener);
    }
    expect(heard).toHaveLength(1);
    expect(heard[0].saleId).toBe(saleId);
    expect(heard[0].by).toBe('rule');
  });

  test('and it is NOT told when the decision was refused', async () => {
    /* A silence nobody earned is the bug this replaces. */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    await held(11);
    const heard = [];
    const listener = (payload) => heard.push(payload);
    process.on('posnic:order-resolved', listener);
    try {
      await sweeper.sweepOnce({ Repository: fakeRepository({ status: false }) });
    } finally {
      process.off('posnic:order-resolved', listener);
    }
    expect(heard).toEqual([]);
  });

  test('NOR WHEN THE DECISION ONLY SAID IT WORKED', async () => {
    /*
     * The subtle one. decideOnOrder narrows its write by the tenant the
     * process was last serving and reports success on what it ASKED for, so a
     * write that matched nothing still answers yes. Announcing that would stop
     * the alarm for an order still sitting in the queue - which is precisely
     * the failure this whole change removes, arriving by a different door.
     */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    const saleId = await held(11);
    const heard = [];
    const listener = (payload) => heard.push(payload);
    process.on('posnic:order-resolved', listener);
    let out;
    try {
      out = await sweeper.sweepOnce({ Repository: lyingRepository() });
    } finally {
      process.off('posnic:order-resolved', listener);
    }
    expect(heard).toEqual([]);
    expect(out.decided).toEqual([]);
    /* And the order is still there, still waiting, still audible. */
    const still = await db
      .collection('sales')
      .findOne({ _id: new mongoose.Types.ObjectId(saleId) });
    expect(still.order_state).toBe('pending');
  });
});

/* ------------------------------------------------- 3. what it will not touch */

describe('what it leaves alone', () => {
  test('anything that is not still waiting', async () => {
    shopWants({ online_order_on_silence: 'cancel', online_order_decide_after_minutes: 5 });
    await held(60, { order_state: 'accepted' });
    await held(60, { order_state: 'rejected' });
    await held(60, { order_state: undefined });
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).not.toHaveBeenCalled();
  });

  test('AN ORDER FROM LAST NIGHT IS NOT STARTED THIS MORNING', async () => {
    /*
     * A till that was off overnight comes back to orders nobody will collect.
     * Accepting them on a rule means cooking food for people who left hours
     * ago; a person should look at those.
     */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    await held(13 * 60);
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).not.toHaveBeenCalled();
    expect(sweeper.TOO_OLD_HOURS).toBe(12);
  });

  test("AN AGGREGATOR'S CLOCK IS NOT OURS", async () => {
    /*
     * Swiggy and Zomato reject on their own timer and count it against the
     * shop. A decision of ours landing after theirs is worse than none: the
     * order is already gone and we have recorded the opposite.
     */
    shopWants({
      online_order_on_silence: 'accept',
      online_order_decide_after_minutes: 10,
      online_order_partner_window_minutes: 8,
    });
    await held(30, { channel: 'marketplace' });
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).not.toHaveBeenCalled();

    /* The shop's own order is not governed by their clock at all. */
    await held(30, { channel: 'online' });
    await sweeper.sweepOnce({ Repository });
    expect(Repository.decideOnOrder).toHaveBeenCalledTimes(1);
  });

  test('and it takes only a handful at a time', async () => {
    /* A shop coming back from an outage must not print two hundred tickets
       in one breath. */
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    for (let i = 0; i < 25; i += 1) await held(11);
    const Repository = fakeRepository();
    const out = await sweeper.sweepOnce({ Repository });
    expect(out.looked).toBe(sweeper.MOST_PER_TICK);
    expect(Repository.decideOnOrder).toHaveBeenCalledTimes(sweeper.MOST_PER_TICK);
  });

  test('the oldest are taken first, because they have waited longest', async () => {
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    const older = await held(60);
    await held(11);
    const Repository = fakeRepository();
    await sweeper.sweepOnce({ Repository });
    expect(Repository.calls[0].saleId).toBe(older);
  });
});

/* --------------------------------------------------------- it is a bystander */

describe('nothing here may take a shop down', () => {
  test('a repository that throws costs one order, not the sweep', async () => {
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    await held(11);
    await held(12);
    const honest = fakeRepository();
    const exploding = {
      decideOnOrder: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementation((saleId, decision, reason) =>
          honest.decideOnOrder(saleId, decision, reason)
        ),
    };
    const out = await sweeper.sweepOnce({ Repository: exploding });
    expect(exploding.decideOnOrder).toHaveBeenCalledTimes(2);
    expect(out.decided).toHaveLength(1);
  });

  test('no database is a quiet nothing, not a crash', async () => {
    BaseModel.getDb.mockRejectedValue(new Error('not connected yet'));
    await expect(sweeper.sweepOnce({ Repository: fakeRepository() })).resolves.toMatchObject({
      branches: 0,
      decided: [],
    });
  });

  test('starting twice starts one timer, and stopping releases it', () => {
    const first = sweeper.start({ everyMs: 60000 });
    const second = sweeper.start({ everyMs: 60000 });
    expect(second).toBe(first);
    sweeper.stop();
    expect(sweeper.start({ everyMs: 60000 })).not.toBe(first);
  });
});

/* ------------------------------------------------- the call itself */

describe('it calls the real door the way the real door is written', () => {
  test('THE SWEEP HANDS decideOnOrder AN OBJECT, and that is checked against the REAL one', async () => {
    /*
     * The bug this file shipped with. The sweep called
     * `decideOnOrder(saleId, decision, reason)` and the real function takes
     * `{ saleId, decision, reason }`, so `saleId` was undefined and every
     * decision was refused at the guard. Nothing looked wrong: the read-back
     * added for a different reason saw the order had not moved and quietly
     * moved on, so the shop rule simply never did anything.
     *
     * Spied on the REAL module rather than replaced by a fake, because a fake
     * is exactly what hid it - a fake agrees with whoever wrote it.
     */
    const real = require('../../../src/repositories/sale.repository');
    shopWants({ online_order_on_silence: 'accept', online_order_decide_after_minutes: 10 });
    const saleId = await held(11);

    const spy = jest.spyOn(real, 'decideOnOrder').mockResolvedValue({ status: true, data: {} });
    await sweeper.sweepOnce({});

    expect(spy).toHaveBeenCalledTimes(1);
    const [given, ...extra] = spy.mock.calls[0];
    expect(extra).toEqual([]);
    expect(given).toEqual({
      saleId,
      decision: 'accepted',
      reason: expect.any(String),
    });
  });

  test('and the real function refuses the way it used to be called', async () => {
    /*
     * The other half of the proof: if the old positional call were still
     * there, this is what it would have produced on every single order, in
     * silence, for as long as the feature existed.
     */
    const real = require('../../../src/repositories/sale.repository');
    const out = await real.decideOnOrder('6aa5509215e3686c543e5cc3', 'accepted', 'because');
    expect(out.status).toBe(false);
    expect(out.message).toMatch(/order id/i);
  });
});

/* ------------------------------------------------------- where it came from */

test('an order is named by the channel it arrived through', () => {
  expect(sweeper.sourceOf({ channel: 'marketplace' })).toBe('marketplace');
  expect(sweeper.sourceOf({ sale_method: 'Swiggy' })).toBe('marketplace');
  expect(sweeper.sourceOf({ channel: 'ZOMATO' })).toBe('marketplace');
  expect(sweeper.sourceOf({ channel: 'online' })).toBe('online');
  expect(sweeper.sourceOf({})).toBe('online');
});
