'use strict';

const CouponService = require('../../../src/services/coupon.service');
const { COUPON_TYPE, MESSAGES } = require('../../../src/constants/coupon.constants');

// A base coupon; individual tests override just what they exercise. Currency is
// irrelevant to the maths, so these hold for any currency or country.
const base = {
  code: 'SAVE',
  type: COUPON_TYPE.PERCENT,
  value: 10,
  min_spend: 0,
  max_discount: 0,
  usage_limit: 0,
  per_customer_limit: 0,
  customer_id: null,
  start_date: null,
  end_date: null,
  active: true,
};

describe('CouponService.computeDiscount - value', () => {
  test('percentage off the bill', () => {
    const r = CouponService.computeDiscount(base, 500);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(50);
  });

  test('fixed amount off, never exceeding the bill', () => {
    const c = { ...base, type: COUPON_TYPE.FIXED, value: 100 };
    expect(CouponService.computeDiscount(c, 500).discount).toBe(100);
    // A 100-off coupon on an 80 bill only takes 80.
    expect(CouponService.computeDiscount(c, 80).discount).toBe(80);
  });

  test('percentage is capped by max_discount', () => {
    const c = { ...base, value: 50, max_discount: 40 };
    const r = CouponService.computeDiscount(c, 200); // 50% = 100, capped to 40
    expect(r.discount).toBe(40);
    expect(r.capped).toBe(true);
  });

  test('a coupon that yields no discount is rejected', () => {
    const c = { ...base, type: COUPON_TYPE.FIXED, value: 0 };
    const r = CouponService.computeDiscount(c, 500);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(MESSAGES.ZERO_DISCOUNT);
  });
});

describe('CouponService.computeDiscount - eligibility', () => {
  test('rejects an inactive coupon', () => {
    expect(CouponService.computeDiscount({ ...base, active: false }, 500).error).toBe(
      MESSAGES.INACTIVE
    );
  });

  test('respects the minimum spend', () => {
    const r = CouponService.computeDiscount({ ...base, min_spend: 1000 }, 500);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(MESSAGES.MIN_SPEND);
  });

  test('honours the validity window', () => {
    const now = new Date('2026-06-15').getTime();
    const notYet = { ...base, start_date: '2026-07-01' };
    const gone = { ...base, end_date: '2026-06-01' };
    const live = { ...base, start_date: '2026-06-01', end_date: '2026-06-30' };
    expect(CouponService.computeDiscount(notYet, 500, { now }).error).toBe(MESSAGES.NOT_STARTED);
    expect(CouponService.computeDiscount(gone, 500, { now }).error).toBe(MESSAGES.EXPIRED);
    expect(CouponService.computeDiscount(live, 500, { now }).valid).toBe(true);
  });

  test('the end day is inclusive', () => {
    const c = { ...base, end_date: '2026-06-30' };
    const noonOnLastDay = new Date('2026-06-30T12:00:00').getTime();
    expect(CouponService.computeDiscount(c, 500, { now: noonOnLastDay }).valid).toBe(true);
  });

  test('stops at the total usage limit', () => {
    const c = { ...base, usage_limit: 100 };
    expect(CouponService.computeDiscount(c, 500, { timesUsed: 100 }).error).toBe(
      MESSAGES.USAGE_LIMIT
    );
    expect(CouponService.computeDiscount(c, 500, { timesUsed: 99 }).valid).toBe(true);
  });

  test('stops at the per-customer limit and needs a customer', () => {
    const c = { ...base, per_customer_limit: 1 };
    // No customer -> cannot check the limit, so it is refused.
    expect(CouponService.computeDiscount(c, 500, {}).error).toBe(MESSAGES.NO_CUSTOMER);
    // Customer who already used it once.
    expect(CouponService.computeDiscount(c, 500, { customerId: 'c1', customerUses: 1 }).error).toBe(
      MESSAGES.PER_CUSTOMER_LIMIT
    );
    // Fresh customer is fine.
    expect(CouponService.computeDiscount(c, 500, { customerId: 'c2', customerUses: 0 }).valid).toBe(
      true
    );
  });

  test('a customer-bound code refuses everyone else', () => {
    const c = { ...base, customer_id: 'owner1' };
    expect(CouponService.computeDiscount(c, 500, { customerId: 'someone' }).error).toBe(
      MESSAGES.WRONG_CUSTOMER
    );
    expect(CouponService.computeDiscount(c, 500, { customerId: 'owner1' }).valid).toBe(true);
  });
});
