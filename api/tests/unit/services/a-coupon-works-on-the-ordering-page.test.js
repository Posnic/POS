'use strict';

/*
 * A COUPON WORKS ON THE ORDERING PAGE.
 *
 * The product has shipped coupons since the loyalty release, and the channel
 * they exist to drive could not take one: every coupon route is behind an
 * authenticated user, and a customer at a table has no account and never will.
 * So a shop could print a code on a flyer and the QR menu would refuse it.
 *
 * Two doors, and the split between them is the whole design:
 *
 *   the PREVIEW says whether a code is real and what it offers
 *   the ORDER says what it is worth, once, from the shop's own document
 *
 * The preview never returns a money figure for a basket. Working one out
 * would mean pricing every line a second time off the order path, and two
 * places that price a basket are two places that will one day disagree about
 * what a customer owes.
 */

const customerOrder = require('../../../src/services/customer-order.service');
const CouponService = require('../../../src/services/coupon.service');

const BRANCH = '507f1f77bcf86cd799439011';
const OTHER_BRANCH = '507f1f77bcf86cd799439012';

const live = (over = {}) => ({
  code: 'WELCOME10',
  active: true,
  type: 'percent',
  value: 10,
  min_bill: 500,
  max_discount: 100,
  description: '10% off your first order',
  ...over,
});

function shopHas(coupon) {
  return jest.spyOn(CouponService.prototype, 'getByCode').mockResolvedValue(coupon);
}

afterEach(() => jest.restoreAllMocks());

describe('what the preview tells a stranger', () => {
  test('a live code answers with its terms', async () => {
    shopHas(live());
    const said = await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH });

    expect(said).toMatchObject({
      code: 'WELCOME10',
      type: 'percent',
      value: 10,
      min_bill: 500,
      max_discount: 100,
    });
  });

  test('and never a money figure for this basket', async () => {
    /*
     * THE LINE THAT MATTERS. A number here would have to be worked out by
     * pricing the basket a second time, away from the order path. The exact
     * discount is computed once, when the order is placed.
     */
    shopHas(live());
    const said = await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH });

    expect(said).not.toHaveProperty('discount');
    expect(said).not.toHaveProperty('total');
    expect(Object.keys(said).sort()).toEqual(
      ['code', 'description', 'max_discount', 'min_bill', 'type', 'value'].sort()
    );
  });

  test('the minimum is named, so nobody finds it out at checkout', async () => {
    shopHas(live({ min_bill: 750 }));
    const said = await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH });
    expect(said.min_bill).toBe(750);
  });
});

describe('and what it refuses, all the same way', () => {
  /*
   * ONE SHAPE OF REFUSAL. This door is open to the internet. A difference
   * between "no such code" and "that one has run out" is a way to read a
   * shop's coupon list one guess at a time.
   */
  test('a code that does not exist', async () => {
    shopHas(null);
    expect(await customerOrder.couponTerms('NOPE', { branchId: BRANCH })).toBeNull();
  });

  test('one the shop switched off', async () => {
    shopHas(live({ active: false }));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).toBeNull();
  });

  test('one that has expired', async () => {
    shopHas(live({ expires_at: new Date(Date.now() - 86400000) }));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).toBeNull();
  });

  test('one that has not started', async () => {
    shopHas(live({ starts_at: new Date(Date.now() + 86400000) }));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).toBeNull();
  });

  test('and one that belongs to another branch', async () => {
    shopHas(live({ branch_id: OTHER_BRANCH }));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).toBeNull();
  });

  test('a licence-wide coupon is this shop own, because most are written that way', async () => {
    shopHas(live({ branch_id: null }));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).not.toBeNull();
  });

  test('an empty code asks nothing of the database', async () => {
    const lookup = shopHas(live());
    expect(await customerOrder.couponTerms('   ', { branchId: BRANCH })).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  test('a lookup that throws does not stop somebody ordering', async () => {
    jest.spyOn(CouponService.prototype, 'getByCode').mockRejectedValue(new Error('down'));
    expect(await customerOrder.couponTerms('WELCOME10', { branchId: BRANCH })).toBeNull();
  });
});

/* ------------------------------------------- and what the ORDER path does */

describe('the order is where the money is decided', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const REPO = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );
  const order = REPO.slice(REPO.indexOf('async createOnlineOrder('));

  test('a code the shop will not honour REFUSES the order', () => {
    /*
     * Rather than quietly charging full price. Somebody who typed a code, saw
     * a price and pressed pay must not be charged more than the number they
     * agreed to. Silently ignoring it is the one outcome nobody would forgive.
     */
    expect(order).toMatch(/state: 'coupon_refused'/);
    expect(order).toMatch(/if \(!said \|\| said\.valid !== true \|\| !said\.data\)/);
  });

  test('the discount comes from the shop, never from the request', () => {
    expect(order).toMatch(/await coupons\.validate\(wantedCoupon, \{/);
    expect(order).toMatch(/couponDiscount = round\(Number\(said\.data\.discount\) \|\| 0\)/);
    /* The request supplies a CODE and nothing else about money. */
    expect(order).not.toMatch(/coupon_discount:\s*Number\(data\./);
  });

  test('a coupon cannot be used to dodge a minimum order', () => {
    /*
     * `charge` is worked out on the food BEFORE any coupon, so a shop's "we do
     * not deliver under 200" still means 200 of food.
     */
    const minimumAt = order.indexOf("state: 'below_minimum'");
    const couponAt = order.indexOf('const wantedCoupon =');
    expect(minimumAt).toBeGreaterThan(-1);
    expect(couponAt).toBeGreaterThan(minimumAt);
  });

  test('and it cannot make the shop pay the customer', () => {
    expect(order).toMatch(/Math\.max\(0, round\(foodTotal - couponDiscount\)\)/);
    /* On the food, not on the delivery fee. */
    expect(order).toMatch(/const finalTotal = round\(afterCoupon \+ deliveryFee\)/);
  });

  test('the redemption is recorded only after the order exists', () => {
    /*
     * A coupon with a usage limit is a promise to everybody who has not used
     * it yet. Counting it against an order that then failed to save would
     * spend somebody else's turn on nothing.
     */
    const insertAt = order.indexOf('const insertedId = insertResult.insertedId.toString()');
    const applyAt = order.indexOf('await coupons.apply(');
    expect(insertAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(insertAt);
  });

  test('and a failure to record it does not lose the order', () => {
    const block = order.slice(order.indexOf('if (couponUsed && couponDiscount > 0)'));
    expect(block.slice(0, 600)).toMatch(/catch \(e\)/);
  });

  test('what the customer was charged is stored, not recomputed later', () => {
    /* The offer can be edited or withdrawn tomorrow; a bill has to keep saying
       what this customer actually paid. */
    expect(order).toMatch(/coupon_code: couponUsed \? String\(couponUsed\.code \|\| ''\) : ''/);
    expect(order).toMatch(/coupon_discount: couponDiscount/);
  });
});
