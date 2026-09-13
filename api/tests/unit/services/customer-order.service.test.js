'use strict';
/*
 * The order a customer has already placed, from the phone that placed it.
 *
 * Owner: "i want full control for ai for create and edit order cancel order
 * or existing items." Everything here is about the line between an order the
 * customer may still move and one they may not: a bill, a payment, a refusal,
 * a hotel room, or simply an hour gone by. Each of those is a sentence the
 * assistant says out loud, so each is named rather than numbered.
 */
const customerOrder = require('../../../src/services/customer-order.service');
const salesRepository = require('../../../src/repositories/sale.repository');

const BRANCH = '646576656c6f7073616e6462';
const ORDER_ID = '6aa5509215e3686c543e5cc3';
const context = { branchId: BRANCH, licenseId: 'lic' };

/** How long this shop leaves an order open to its customer. */
function shopAllows(seconds) {
  return jest.spyOn(customerOrder._settings(), 'resolveGroup').mockResolvedValue({
    status: true,
    data: { values: seconds === undefined ? {} : { online_order_change_seconds: seconds } },
  });
}

/** A KOT taken five seconds ago, on the shop's own floor. */
function order(extra = {}) {
  return {
    _id: ORDER_ID,
    branch_id: BRANCH,
    token_id: '219',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    created_date: new Date(Date.now() - 5 * 1000),
    delivery_fee: 0,
    venue_commission: 0,
    items: [
      {
        item_id: 'm1',
        item_name: 'Chicken Biryani',
        item_quantity: 2,
        quantity: 2,
        unit_price: 300,
        tax_amount: 30,
        item_tax: 30,
        total: 660,
        item_total: 660,
        item_discount: 0,
      },
    ],
    ...extra,
  };
}

describe('customer-order.service', () => {
  beforeEach(() => shopAllows(30));
  afterEach(() => jest.restoreAllMocks());

  describe('who may move it', () => {
    test('the id and the token together, and a wrong token is an unknown order', async () => {
      const found = jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order());
      const changed = jest
        .spyOn(salesRepository, 'changeCustomerOrderItems')
        .mockResolvedValue({ status: true, data: {} });

      await customerOrder.change(
        { orderId: ORDER_ID, token: '219', items: [{ item_id: 'm1', quantity: 1 }] },
        context
      );
      expect(found).toHaveBeenCalledWith({ branchId: BRANCH, orderId: ORDER_ID });
      expect(changed).toHaveBeenCalled();

      /* The same answer an unknown id gets, so ids cannot be felt out. */
      changed.mockClear();
      const wrong = await customerOrder.change(
        { orderId: ORDER_ID, token: '999', items: [{ item_id: 'm1', quantity: 1 }] },
        context
      );
      expect(wrong).toEqual({ status: false, message: 'not_found', data: null });
      expect(changed).not.toHaveBeenCalled();

      found.mockResolvedValue(null);
      const missing = await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context);
      expect(missing.message).toBe('not_found');
    });

    test('no id or no token asks the database nothing at all', async () => {
      const found = jest.spyOn(salesRepository, 'findCustomerOrder');
      expect((await customerOrder.cancel({ orderId: ORDER_ID }, context)).message).toBe(
        'not_found'
      );
      expect((await customerOrder.cancel({ token: '219' }, context)).message).toBe('not_found');
      expect(found).not.toHaveBeenCalled();
    });
  });

  describe('when it is no longer theirs to move', () => {
    const cases = [
      ['a bill has been made of it', { sale_process: 'Add' }, 'already_billed'],
      ['the money is in', { payment_status: 'Paid' }, 'already_paid'],
      ['it is already off', { sale_process: 'cancelled' }, 'already_cancelled'],
      ['the shop refused it', { order_state: 'rejected' }, 'refused_by_shop'],
      ['it is going to a hotel room', { venue: 'Royal Club, Room 123' }, 'at_the_counter'],
      ['somebody is driving it over', { delivery_fee: 30 }, 'at_the_counter'],
      ['the window has closed', { created_date: new Date(Date.now() - 3 * 60 * 1000) }, 'too_late'],
    ];
    for (const [what, extra, reason] of cases) {
      test(`${what}: ${reason}`, async () => {
        jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order(extra));
        const changed = jest.spyOn(salesRepository, 'changeCustomerOrderItems');
        const cancelled = jest.spyOn(salesRepository, 'cancelCustomerOrder');
        const asked = jest
          .spyOn(salesRepository, 'requestCustomerCancel')
          .mockResolvedValue({ status: true, data: { cancel_requested: true } });

        expect(
          (
            await customerOrder.change(
              { orderId: ORDER_ID, token: '219', items: [{ item_id: 'm1', quantity: 1 }] },
              context
            )
          ).message
        ).toBe(reason);
        expect(changed).not.toHaveBeenCalled();
        expect(cancelled).not.toHaveBeenCalled();

        /* Cancelling is different: where the order still exists and is not
           settled, the customer may always ASK and the shop decides. */
        const out = await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context);
        const settled = ['already_billed', 'already_paid', 'already_cancelled'].includes(reason);
        if (settled) {
          expect(out).toEqual({ status: false, message: reason, data: null });
          expect(asked).not.toHaveBeenCalled();
        } else {
          expect(out.status).toBe(true);
          expect(out.data).toMatchObject({ requested: true, why_not: reason });
        }
      });
    }

    test("a fresh KOT on the shop's own floor is theirs", () => {
      expect(customerOrder.whyNot(order())).toBe('');
    });

    test("the window is the shop's to set, and zero closes it at once", async () => {
      /* Owner: "within 30 seconds they can modify ... shop ower setting
         might be." */
      const read = shopAllows(30);
      expect(await customerOrder.changeSeconds(context)).toBe(30);

      read.mockResolvedValue({
        status: true,
        data: { values: { online_order_change_seconds: '120' } },
      });
      expect(await customerOrder.changeSeconds(context)).toBe(120);

      /* Nothing said is the sensible default, not no window at all. */
      read.mockResolvedValue({ status: true, data: { values: {} } });
      expect(await customerOrder.changeSeconds(context)).toBe(customerOrder.DEFAULT_CHANGE_SECONDS);

      /* Nonsense is the default too; a shop cannot leave one open for a day. */
      read.mockResolvedValue({
        status: true,
        data: { values: { online_order_change_seconds: 'soon' } },
      });
      expect(await customerOrder.changeSeconds(context)).toBe(customerOrder.DEFAULT_CHANGE_SECONDS);
      read.mockResolvedValue({
        status: true,
        data: { values: { online_order_change_seconds: 99999 } },
      });
      expect(await customerOrder.changeSeconds(context)).toBe(customerOrder.MAX_CHANGE_SECONDS);

      /* A settings read that throws still leaves a working window. */
      read.mockRejectedValue(new Error('no database'));
      expect(await customerOrder.changeSeconds(context)).toBe(customerOrder.DEFAULT_CHANGE_SECONDS);

      /* Switched off: the order is the shop's from the moment it lands. */
      expect(customerOrder.whyNot(order(), Date.now(), 0)).toBe('too_late');
      /* And a longer window keeps an older order open. */
      const older = order({ created_date: new Date(Date.now() - 90 * 1000) });
      expect(customerOrder.whyNot(older, Date.now(), 30)).toBe('too_late');
      expect(customerOrder.whyNot(older, Date.now(), 300)).toBe('');
    });

    test('nothing asked is not a change', async () => {
      jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order());
      expect(
        (await customerOrder.change({ orderId: ORDER_ID, token: '219' }, context)).message
      ).toBe('nothing_asked');
      expect(
        (await customerOrder.change({ orderId: ORDER_ID, token: '219', items: [] }, context))
          .message
      ).toBe('nothing_asked');
    });
  });
});

describe('sale.repository, changing an order that has gone', () => {
  afterEach(() => jest.restoreAllMocks());

  /* The arithmetic, without a database: every money field on an online line
     is linear in its quantity, so scaling reproduces exactly what the order
     would have cost had it been placed that way. */
  test('a line scales exactly, and the totals follow it', () => {
    const line = order().items[0];
    const halved = salesRepository._scaleOrderLine(line, 2, 1);
    expect(halved).toMatchObject({
      item_quantity: 1,
      quantity: 1,
      unit_price: 300,
      tax_amount: 15,
      total: 330,
    });

    const totals = salesRepository._onlineOrderTotals([halved], order());
    expect(totals).toEqual({
      subtotal: 300,
      tax: 15,
      total: 330,
      discount: 0,
      number_of_items: 1,
    });
  });

  test('a line taken to zero leaves the order, and the order keeps its own prices', () => {
    const line = order().items[0];
    /* Tripled from the ORDER's price, not from whatever the catalogue says
       now: the customer is held to what they were quoted. */
    const tripled = salesRepository._scaleOrderLine(line, 2, 3);
    expect(tripled.total).toBe(990);
    expect(tripled.unit_price).toBe(300);
    expect(salesRepository._scaleOrderLine(line, 2, 0)).toMatchObject({ item_quantity: 0 });
  });

  test('a delivery fee stays on the total when the lines move', () => {
    const line = salesRepository._scaleOrderLine(order().items[0], 2, 1);
    const totals = salesRepository._onlineOrderTotals([line], order({ delivery_fee: 30 }));
    expect(totals.total).toBe(360);
  });
});

describe('the order, read back by the phone that placed it', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reading is allowed where changing is not, and it says which', async () => {
    /* A paid order is exactly the one a customer wants to look at, and the
       only one with a bill behind it. */
    const paid = order({ payment_status: 'Paid' });
    jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(paid);

    const out = await customerOrder.read({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.status).toBe(true);
    expect(out.data).toMatchObject({
      order_id: ORDER_ID,
      token: '219',
      paid: true,
      bill_ready: true,
      cancelled: false,
      can_change: false,
      why_not: 'already_paid',
    });
    expect(out.data.items).toEqual([
      { item_id: 'm1', name: 'Chicken Biryani', quantity: 2, note: '', total: 660 },
    ]);
  });

  test('an unpaid order has no bill behind it, and may still be changed', async () => {
    jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order());
    const out = await customerOrder.read({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.data).toMatchObject({ paid: false, bill_ready: false, can_change: true });
    expect(out.data.why_not).toBeUndefined();
  });

  test('a cancelled order says so, and never offers a bill', async () => {
    jest
      .spyOn(salesRepository, 'findCustomerOrder')
      .mockResolvedValue(order({ sale_process: 'cancelled', payment_status: 'Paid' }));
    const out = await customerOrder.read({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.data).toMatchObject({ cancelled: true, state: 'cancelled', bill_ready: false });
  });

  test('a wrong token, or none, is an unknown order', async () => {
    const found = jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order());
    expect((await customerOrder.read({ orderId: ORDER_ID, token: '999' }, context)).message).toBe(
      'not_found'
    );
    expect((await customerOrder.read({ orderId: ORDER_ID }, context)).message).toBe('not_found');
    expect(found).toHaveBeenCalledTimes(1);
  });

  test("the view never carries the shop's own numbers, or the device the order came from", () => {
    const view = salesRepository.customerOrderView(
      order({
        company_price_total: 180,
        venue_commission: 42,
        client: { ip: '49.207.1.1', user_agent: 'Mozilla', device_id: 'abc' },
      })
    );
    const said = JSON.stringify(view);
    expect(said).not.toContain('49.207.1.1');
    expect(said).not.toContain('Mozilla');
    expect(said).not.toContain('company_price_total');
    expect(said).not.toContain('venue_commission');
  });
});

describe('what an order keeps about the device it came from', () => {
  test('the facts are kept, cut to size, and anything unrecognised is dropped', () => {
    const facts = salesRepository._clientFacts({
      ip: '49.207.1.1',
      user_agent: 'Mozilla/5.0 ' + 'x'.repeat(500),
      device_id: 'd-' + 'y'.repeat(100),
      language: 'ta-IN',
      platform: 'Android',
      screen: '412x915',
      time_zone: 'Asia/Kolkata',
      referrer: 'https://develop.posnic.io/order/ABC',
      /* Not ours to keep, and not asked for. */
      email: 'someone@example.com',
      cookies: 'session=abc',
    });
    expect(facts).toMatchObject({
      ip: '49.207.1.1',
      language: 'ta-IN',
      platform: 'Android',
      screen: '412x915',
      time_zone: 'Asia/Kolkata',
    });
    expect(facts.user_agent).toHaveLength(300);
    expect(facts.device_id).toHaveLength(40);
    expect(facts.at instanceof Date).toBe(true);
    expect(Object.keys(facts)).not.toContain('email');
    expect(Object.keys(facts)).not.toContain('cookies');
  });

  test('a screen size that is not one is dropped, and control characters never land', () => {
    const facts = salesRepository._clientFacts({
      ip: '1.2.3.4',
      screen: 'DROP TABLE',
      platform: 'And\u0007roid',
    });
    expect(facts.screen).toBeUndefined();
    expect(facts.platform).toBe('Androi\u0064'.replace('\\u0064', 'd'));
  });

  test('nothing worth keeping is nothing kept, not an empty stamp', () => {
    expect(salesRepository._clientFacts(null)).toBeNull();
    expect(salesRepository._clientFacts({})).toBeNull();
    expect(salesRepository._clientFacts({ ip: '' })).toBeNull();
  });
});

describe('cancelling after the window has closed', () => {
  beforeEach(() => shopAllows(30));
  afterEach(() => jest.restoreAllMocks());

  test('a cancellation after the window is a request, not a refusal', async () => {
    /* Owner: "second cancel the order. may be approval from desktop. user
       can submit the request however." */
    const late = order({ created_date: new Date(Date.now() - 5 * 60 * 1000) });
    jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(late);
    const cancelled = jest.spyOn(salesRepository, 'cancelCustomerOrder');
    const asked = jest
      .spyOn(salesRepository, 'requestCustomerCancel')
      .mockResolvedValue({ status: true, data: { order_id: ORDER_ID, cancel_requested: true } });

    const out = await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.status).toBe(true);
    expect(out.data).toMatchObject({ requested: true, why_not: 'too_late' });
    expect(asked).toHaveBeenCalledWith(late);
    expect(cancelled).not.toHaveBeenCalled();
  });

  test('inside the window it simply goes, and nothing is asked of anybody', async () => {
    jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order());
    const asked = jest.spyOn(salesRepository, 'requestCustomerCancel');
    const cancelled = jest
      .spyOn(salesRepository, 'cancelCustomerOrder')
      .mockResolvedValue({ status: true, data: { cancelled: true } });
    const out = await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.data).toMatchObject({ cancelled: true });
    expect(cancelled).toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
  });

  test('an order already off, billed or paid is not asked about again', async () => {
    const asked = jest.spyOn(salesRepository, 'requestCustomerCancel');
    for (const [extra, reason] of [
      [{ sale_process: 'cancelled' }, 'already_cancelled'],
      [{ sale_process: 'Add' }, 'already_billed'],
      [{ payment_status: 'Paid' }, 'already_paid'],
    ]) {
      jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order(extra));
      const out = await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context);
      expect(out).toEqual({ status: false, message: reason, data: null });
    }
    expect(asked).not.toHaveBeenCalled();
  });

  test('the read says how long the window is and whether one has been asked for', async () => {
    jest
      .spyOn(salesRepository, 'findCustomerOrder')
      .mockResolvedValue(order({ cancel_requested: true }));
    const out = await customerOrder.read({ orderId: ORDER_ID, token: '219' }, context);
    expect(out.data).toMatchObject({
      change_seconds: 30,
      cancel_requested: true,
      can_change: true,
    });
  });
});

describe('adding a dish to an order that has already gone', () => {
  const BaseModel = require('../../../src/models/base.model');
  let written;

  beforeEach(() => {
    /* changeCustomerOrderItems opens a database on its first line; this
       stands in for it and keeps what was written. */
    written = [];
    jest.spyOn(BaseModel, 'getDb').mockResolvedValue({
      collection: () => ({
        updateOne: async (...args) => {
          written.push(args);
          return { modifiedCount: 1 };
        },
      }),
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('a dish that was never on the order is priced and added, not refused', async () => {
    /* Owner: "if any changes like add new item to the order possible?" */
    const fresh = {
      item_id: 'd1',
      item_name: 'Fresh Lime Soda',
      name: 'Fresh Lime Soda',
      item_quantity: 2,
      quantity: 2,
      unit_price: 80,
      tax_amount: 8,
      total: 176,
      item_total: 176,
      item_discount: 0,
    };
    const doc = order();
    jest
      .spyOn(salesRepository, '_priceAddedLines')
      .mockResolvedValue({ status: true, lines: [fresh] });

    const out = await salesRepository.changeCustomerOrderItems(doc, [
      { item_id: 'd1', quantity: 2 },
    ]);
    expect(out.status).toBe(true);
    expect(salesRepository._priceAddedLines).toHaveBeenCalledWith(doc, [['d1', 2]]);

    /* It is on the order, and the kitchen was told it was added. */
    const set = written[0][1].$set;
    expect(set.items.map((l) => l.item_id)).toEqual(['m1', 'd1']);
    const latest = set.changes[set.changes.length - 1].items;
    expect(latest).toEqual([
      expect.objectContaining({ item_id: 'd1', process: 'add', item_quantity: 2, price: 80 }),
    ]);
    /* And the total moved by exactly what the new line costs. */
    expect(set.total).toBe(660 + 176);
  });

  test("a dish the shop will not sell right now is refused, in the shop's own words", async () => {
    jest.spyOn(salesRepository, '_priceAddedLines').mockResolvedValue({
      status: false,
      data: { state: 'item_out_of_hours', item: 'Masala Dosa' },
      message: 'Masala Dosa is not being served right now. It is served at Breakfast.',
    });
    const out = await salesRepository.changeCustomerOrderItems(order(), [
      { item_id: 'b1', quantity: 1 },
    ]);
    expect(out.status).toBe(false);
    expect(out.message).toMatch(/not being served right now/);
    expect(written).toHaveLength(0);
  });

  test('asking for none of something that was never there changes nothing', async () => {
    const priced = jest.spyOn(salesRepository, '_priceAddedLines');
    const out = await salesRepository.changeCustomerOrderItems(order(), [
      { item_id: 'ghost', quantity: 0 },
    ]);
    expect(out).toEqual({ status: false, message: 'nothing_changed', data: null });
    expect(priced).not.toHaveBeenCalled();
  });
});

describe('after the order, by kind and in bulk', () => {
  /* shopAllows() above is the seam that actually works: changeSeconds calls
     the module-local _settings binding, so spying on the EXPORT does nothing
     at all and the test would quietly run against the real repository. */
  afterEach(() => jest.restoreAllMocks());

  test('a shop that is not a restaurant has no window at all', async () => {
    /*
     * Owner: "this is specifig functionality about after order and modify.
     * also restaurent specific. other business usually wont have this
     * feature." A counter that has picked and packed has no minute in which
     * the order is still the customer's, so it is not offered one - whatever
     * the stored number says.
     */
    shopAllows(300);
    expect(await customerOrder.changeSeconds({ branchId: 'b1', kind: 'retail' })).toBe(0);
    /* And a restaurant gets exactly what the shop set. */
    expect(await customerOrder.changeSeconds({ branchId: 'b1', kind: 'restaurant' })).toBe(300);
    /* A context with no kind is not assumed to be a shop: the storefront
       always carries one, and guessing "retail" here would switch the
       feature off for every restaurant on an older caller. */
    expect(await customerOrder.changeSeconds({ branchId: 'b1' })).toBe(300);
  });

  test('the shop never leaves an order open for longer than it said it would', async () => {
    shopAllows(100000);
    expect(await customerOrder.changeSeconds({ branchId: 'b1', kind: 'restaurant' })).toBe(
      customerOrder.MAX_CHANGE_SECONDS
    );
    shopAllows(undefined);
    expect(await customerOrder.changeSeconds({ branchId: 'b1', kind: 'restaurant' })).toBe(
      customerOrder.DEFAULT_CHANGE_SECONDS
    );
  });

  test('a page of orders is read in one go, and each one still has to prove itself', async () => {
    /*
     * Owner: "i requested one order both order status saying as not checked."
     * The history page asked once PER ORDER against a limiter of ten a
     * minute. One question for the page; and an entry whose token is wrong is
     * simply absent, exactly as a single read would answer not_found, so this
     * is not a way to read somebody else's orders in bulk.
     */
    shopAllows(30);
    const now = new Date();
    const orders = {
      o1: {
        _id: 'o1',
        token_id: '111',
        sale_process: 'KOT',
        created_date: now,
        items: [],
        total: 0,
      },
      o2: {
        _id: 'o2',
        token_id: '222',
        sale_process: 'KOT',
        created_date: now,
        items: [],
        total: 0,
      },
    };
    jest
      .spyOn(salesRepository, 'findCustomerOrder')
      .mockImplementation(async ({ orderId }) => orders[orderId] || null);

    const out = await customerOrder.readMany(
      {
        orders: [
          { orderId: 'o1', token: '111' },
          { orderId: 'o2', token: 'WRONG' },
          { orderId: 'gone', token: '333' },
        ],
      },
      { branchId: 'b1', kind: 'restaurant' }
    );
    expect(out.status).toBe(true);
    expect(out.data.orders.map((o) => o.order_id)).toEqual(['o1']);
    expect(out.data.orders[0].can_change).toBe(true);
    expect(out.data.orders[0].change_seconds).toBe(30);
  });

  test('a phone cannot ask about an unbounded number of orders at once', async () => {
    shopAllows(30);
    const asked = jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(null);
    const many = [];
    for (let i = 0; i < 60; i += 1) many.push({ orderId: 'o' + i, token: 't' });
    await customerOrder.readMany({ orders: many }, { branchId: 'b1', kind: 'restaurant' });
    expect(asked).toHaveBeenCalledTimes(customerOrder.MOST_ORDERS_AT_ONCE);
  });

  test('nothing asked is an empty answer, not an error', async () => {
    const out = await customerOrder.readMany({ orders: [] }, { branchId: 'b1' });
    expect(out).toEqual({ status: true, message: 'OK', data: { orders: [] } });
  });
});
