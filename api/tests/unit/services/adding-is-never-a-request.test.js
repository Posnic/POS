'use strict';

/*
 * More food never needs permission. Less food does.
 *
 * Owner: "if customer add new order no approval required. we can just send. if
 * any cancel only need approval after few seconds based on settings."
 *
 * The asymmetry is real rather than a convenience. An extra naan costs the
 * kitchen a naan it is glad to sell: nothing is wasted, nothing already cooked
 * is thrown away, and the only answer anybody was ever going to give is yes.
 * Holding that in a queue until somebody notices is a customer waiting on a
 * decision that was never a decision.
 *
 * Taking something away is the opposite. The biryani may be in the pan, and
 * whether it can be called back is a judgement only somebody standing in the
 * kitchen can make.
 *
 * So the window now gates only the taking away, and a request carrying both
 * has its two halves answered separately: the naan is already being made by
 * the time the shop reads the question about the biryani.
 */

const customerOrder = require('../../../src/services/customer-order.service');
const salesRepository = require('../../../src/repositories/sale.repository');

const BRANCH = '646576656c6f7073616e6462';
const ORDER_ID = '6aa5509215e3686c543e5cc3';
const context = { branchId: BRANCH, licenseId: 'lic' };

function shopAllows(seconds) {
  return jest.spyOn(customerOrder._settings(), 'resolveGroup').mockResolvedValue({
    status: true,
    data: { values: seconds === undefined ? {} : { online_order_change_seconds: seconds } },
  });
}

/** A KOT placed an hour ago, so the window has long since closed. */
function oldOrder(extra = {}) {
  return {
    _id: ORDER_ID,
    branch_id: BRANCH,
    token_id: '219',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    created_date: new Date(Date.now() - 60 * 60 * 1000),
    delivery_fee: 0,
    venue_commission: 0,
    items: [
      { item_id: 'm1', item_name: 'Chicken Biryani', item_quantity: 2, quantity: 2 },
      { item_id: 'r1', item_name: 'Butter Naan', item_quantity: 1, quantity: 1 },
    ],
    ...extra,
  };
}

let applied;
let requested;

beforeEach(() => {
  shopAllows(60);
  applied = [];
  requested = [];
  jest.spyOn(salesRepository, 'findCustomerOrder').mockResolvedValue(oldOrder());
  jest.spyOn(salesRepository, 'changeCustomerOrderItems').mockImplementation((doc, wanted) => {
    applied.push(wanted);
    return Promise.resolve({
      status: true,
      message: 'Order updated',
      data: {
        order_id: ORDER_ID,
        token_id: '219',
        items: wanted.map((w) => ({
          item_id: w.item_id,
          name: w.item_id === 'm1' ? 'Chicken Biryani' : 'Butter Naan',
          quantity: w.quantity,
        })),
        total: 0,
      },
    });
  });
  jest.spyOn(salesRepository, 'requestCustomerChange').mockImplementation((doc, wanted, lines) => {
    requested.push({ wanted, lines });
    return Promise.resolve({ status: true, message: 'asked', data: { order_id: ORDER_ID } });
  });
});

afterEach(() => jest.restoreAllMocks());

const ask = (items) => customerOrder.change({ orderId: ORDER_ID, token: '219', items }, context);

/* ----------------------------------------------------------- adding */

test('one more naan, an hour later, goes straight to the kitchen', async () => {
  /*
   * The whole point. Nobody was ever going to refuse this, and holding it in
   * a queue is a customer waiting on a decision that was not one.
   */
  const out = await ask([
    { item_id: 'm1', quantity: 2 },
    { item_id: 'r1', quantity: 3 },
  ]);

  expect(out.status).toBe(true);
  expect(requested).toHaveLength(0);
  expect(applied).toHaveLength(1);
  expect(out.data.requested).toBeUndefined();
});

test('a dish that was not on the order at all is still just an addition', async () => {
  await ask([
    { item_id: 'm1', quantity: 2 },
    { item_id: 'r1', quantity: 1 },
    { item_id: 'd1', quantity: 1 },
  ]);
  expect(requested).toHaveLength(0);
  expect(applied[0]).toEqual(expect.arrayContaining([{ item_id: 'd1', quantity: 1 }]));
});

test('the applied list is the WHOLE order, not only the additions', async () => {
  /*
   * THE BUG THIS WOULD HAVE BEEN. changeCustomerOrderItems reads its list as
   * the order the customer wants, so a line left out of it is a line removed.
   * Sending "just the naan" would have silently cancelled the biryani - the
   * exact opposite of a request to add something.
   */
  await ask([{ item_id: 'r1', quantity: 3 }]);
  expect(applied[0]).toHaveLength(2);
  expect(applied[0]).toEqual(
    expect.arrayContaining([
      { item_id: 'm1', quantity: 2 },
      { item_id: 'r1', quantity: 3 },
    ])
  );
});

/* --------------------------------------------------------- taking away */

test('dropping a dish an hour later still asks the shop', async () => {
  const out = await ask([
    { item_id: 'm1', quantity: 0 },
    { item_id: 'r1', quantity: 1 },
  ]);
  expect(applied).toHaveLength(0);
  expect(requested).toHaveLength(1);
  expect(requested[0].wanted).toEqual([{ item_id: 'm1', quantity: 0 }]);
  expect(out.data.requested).toBe(true);
});

test('asking for fewer is asking, not doing', async () => {
  await ask([
    { item_id: 'm1', quantity: 1 },
    { item_id: 'r1', quantity: 1 },
  ]);
  expect(applied).toHaveLength(0);
  expect(requested[0].wanted).toEqual([{ item_id: 'm1', quantity: 1 }]);
});

/* ------------------------------------------------------- both at once */

test('"two more naan and drop the biryani" does both halves at once', async () => {
  /*
   * The case that decided the shape. It used to wait as a single wish until
   * somebody looked at the queue; now the naan is already being made by the
   * time the shop reads the question about the biryani.
   */
  const out = await ask([
    { item_id: 'm1', quantity: 0 },
    { item_id: 'r1', quantity: 3 },
  ]);

  expect(applied).toHaveLength(1);
  expect(applied[0]).toEqual(
    expect.arrayContaining([
      { item_id: 'm1', quantity: 2 },
      { item_id: 'r1', quantity: 3 },
    ])
  );
  expect(requested).toHaveLength(1);
  expect(requested[0].wanted).toEqual([{ item_id: 'm1', quantity: 0 }]);
  expect(out.data.added).toBe(true);
});

test('the shop is shown the order as it NOW stands, not as it was', async () => {
  /*
   * The additions are already on the order by the time the card is drawn. A
   * queue showing the old quantities beside the new wish would have the shop
   * reading a "before" that no longer exists anywhere.
   */
  await ask([
    { item_id: 'm1', quantity: 0 },
    { item_id: 'r1', quantity: 3 },
  ]);
  const naan = requested[0].lines.find((l) => l.item_id === 'r1');
  expect(naan.quantity).toBe(3);
});

/* ------------------------------------------------- what has not changed */

test('inside the window everything still simply happens', async () => {
  salesRepository.findCustomerOrder.mockResolvedValue(
    oldOrder({ created_date: new Date(Date.now() - 5 * 1000) })
  );
  const out = await ask([{ item_id: 'm1', quantity: 0 }]);
  expect(applied).toHaveLength(1);
  expect(requested).toHaveLength(0);
  expect(out.status).toBe(true);
});

test('a delivery is refused outright, additions included', async () => {
  /*
   * Not the same argument. The window is about the kitchen having started;
   * a delivery fee or a venue commission is somebody else's money in the
   * total, and adding to it moves what they are owed.
   */
  salesRepository.findCustomerOrder.mockResolvedValue(oldOrder({ delivery_fee: 40 }));
  const out = await ask([{ item_id: 'r1', quantity: 3 }]);
  expect(out.status).toBe(false);
  expect(out.message).toBe('at_the_counter');
  expect(applied).toHaveLength(0);
  expect(requested).toHaveLength(0);
});

test('a paid order is nobody-changes-it, in either direction', async () => {
  salesRepository.findCustomerOrder.mockResolvedValue(oldOrder({ payment_status: 'Paid' }));
  const out = await ask([{ item_id: 'r1', quantity: 3 }]);
  expect(out.status).toBe(false);
  expect(applied).toHaveLength(0);
});

test('asking for exactly what is already there is not a wish at all', async () => {
  const out = await ask([
    { item_id: 'm1', quantity: 2 },
    { item_id: 'r1', quantity: 1 },
  ]);
  expect(applied).toHaveLength(0);
  expect(requested).toHaveLength(0);
  expect(out.status).toBe(false);
  expect(out.message).toBe('nothing_asked');
});
