'use strict';

/*
 * A WAITER SEES THEIR OWN DAY, AND ONLY THEIRS.
 *
 * Owner: "total sales today current user done or some dashboard you can give.
 * but no on the first page. seperate page. sales history of own and table wise
 * seperate."
 *
 * The order history the handset already loads is the whole BRANCH: the call
 * takes a user_id and has never used it, and it must keep not using it,
 * because the floor needs every table's orders whoever took them. Any waiter
 * can pick up any table.
 *
 * This is a different question and it gets its own door. The part worth
 * pinning is where the answer to "whose day" comes from: the token, never the
 * request body. A handset that could name its own user could name anybody's.
 */

const SalesController = require('../../src/controllers/sales.controller');
const salesService = require('../../src/services/sale.service');

/** A controller with the framework bits answered. */
function controller() {
  const instance = Object.create(
    SalesController.constructor.prototype || Object.getPrototypeOf(SalesController)
  );
  instance.success = (res, data, message, code) => ({ code, message, data });
  instance.error = (res, message, code) => ({ code, message, error: true });
  return instance;
}

function reply() {
  return {};
}

describe('whose figures these are', () => {
  let asked;

  beforeEach(() => {
    asked = null;
    jest.spyOn(salesService, 'myDayModel').mockImplementation(async (branchId, userId, day) => {
      asked = { branchId, userId, day };
      return { total: 420, orders: 3, cancelled: 1, tables: [], recent: [] };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('THE USER COMES FROM THE TOKEN, NOT THE BODY', async () => {
    const at = controller();
    const said = await at.myDay(
      {
        user: { _id: 'me-1', username: 'anita' },
        body: { user_id: 'somebody-else', branch_id: 'b1' },
      },
      reply()
    );

    expect(asked.userId).toBe('me-1');
    expect(asked.userId).not.toBe('somebody-else');
    expect(said.data.user_name).toBe('anita');
  });

  it('and a caller with no token is refused rather than shown a zero', async () => {
    /*
     * A page that answers "you have sold nothing today" to somebody who is not
     * signed in reads as a bad day, not as a missing sign-in.
     */
    const at = controller();
    const said = await at.myDay({ body: {} }, reply());

    expect(said.code).toBe(401);
    expect(said.error).toBe(true);
    expect(asked).toBeNull();
  });

  it('A DAY TYPED WRONG READS AS TODAY, never as an error mid-service', async () => {
    const at = controller();
    /* Local parts, not toISOString: that is UTC, and it is the bug this
       endpoint just had. A test written the same wrong way would have agreed
       with it. */
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    for (const day of ['not-a-day', '2026-13-45x', '', { $ne: null }]) {
      const said = await at.myDay({ user: { _id: 'me-1' }, body: { day } }, reply());
      expect(said.data.day).toBe(today);
    }
  });

  it('and a real date is honoured, because a waiter checks yesterday', async () => {
    const at = controller();
    const said = await at.myDay({ user: { _id: 'me-1' }, body: { day: '2026-09-17' } }, reply());

    expect(said.data.day).toBe('2026-09-17');
    expect(asked.day.getFullYear()).toBe(2026);
    expect(asked.day.getMonth()).toBe(8);
    expect(asked.day.getDate()).toBe(17);
  });

  it('the figures are handed back as the repository counted them', async () => {
    const at = controller();
    const said = await at.myDay({ user: { _id: 'me-1' }, body: {} }, reply());

    expect(said.data.total).toBe(420);
    expect(said.data.orders).toBe(3);
    expect(said.data.cancelled).toBe(1);
  });

  it('a day with nothing in it says so rather than looking broken', async () => {
    salesService.myDayModel.mockImplementation(async () => ({
      total: 0,
      orders: 0,
      cancelled: 0,
      tables: [],
      recent: [],
    }));

    const at = controller();
    const said = await at.myDay({ user: { _id: 'me-1' }, body: {} }, reply());

    expect(said.code).toBe(200);
    expect(said.message).toMatch(/nothing sold/i);
  });
});

describe('what the history call must keep doing', () => {
  it('THE BRANCH HISTORY STILL IGNORES user_id, on purpose', () => {
    /*
     * The floor screen and the order list read every table's orders, whoever
     * took them, because any waiter can pick up any table. Filtering that call
     * by the caller would empty a floor.
     */
    const fs = require('fs');
    const path = require('path');
    const repo = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'repositories', 'sale.repository.js'),
      'utf8'
    );

    const at = repo.indexOf('async getOrderHistoryModel(');
    const body = repo.slice(at, repo.indexOf('async myDayModel(') > at ? repo.length : at + 3000);
    const upTo = body.slice(0, body.indexOf('.sort('));

    expect(upTo).not.toMatch(/query\.user_id/);
    expect(upTo).not.toMatch(/created_by_id/);
  });
});
