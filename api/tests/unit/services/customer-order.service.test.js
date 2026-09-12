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

/** A KOT taken a minute ago, on the shop's own floor. */
function order(extra = {}) {
  return {
    _id: ORDER_ID,
    branch_id: BRANCH,
    token_id: '219',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    created_date: new Date(Date.now() - 60 * 1000),
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
      [
        'the kitchen has long since moved on',
        { created_date: new Date(Date.now() - 3 * 60 * 60 * 1000) },
        'too_late',
      ],
    ];
    for (const [what, extra, reason] of cases) {
      test(`${what}: ${reason}`, async () => {
        jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(order(extra));
        const changed = jest.spyOn(salesRepository, 'changeCustomerOrderItems');
        const cancelled = jest.spyOn(salesRepository, 'cancelCustomerOrder');
        expect(
          (
            await customerOrder.change(
              { orderId: ORDER_ID, token: '219', items: [{ item_id: 'm1', quantity: 1 }] },
              context
            )
          ).message
        ).toBe(reason);
        expect(
          (await customerOrder.cancel({ orderId: ORDER_ID, token: '219' }, context)).message
        ).toBe(reason);
        expect(changed).not.toHaveBeenCalled();
        expect(cancelled).not.toHaveBeenCalled();
      });
    }

    test("a fresh KOT on the shop's own floor is theirs", () => {
      expect(customerOrder.whyNot(order())).toBe('');
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
