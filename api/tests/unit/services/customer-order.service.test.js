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
