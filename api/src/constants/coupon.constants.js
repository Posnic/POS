'use strict';

/*
 * Coupons are currency- and country-agnostic, like loyalty.
 *
 * A percentage coupon needs no currency at all. A fixed coupon is a plain
 * amount in the BRANCH's own currency - nothing here assumes a symbol, a locale
 * or two decimal places. The bill handed in is always in the branch's currency;
 * the coupon just reduces it.
 *
 * One coupon row expresses BOTH kinds of code the shop asked for:
 *   - a shared campaign code (e.g. DIWALI10) -> usage_limit 0 or N, and a
 *     per_customer_limit so one shopper cannot drain it;
 *   - a unique one-time code -> usage_limit 1 (optionally bound to a customer).
 */

const COUPON_TYPE = {
  PERCENT: 'percent', // value is a % off the qualifying bill
  FIXED: 'fixed', // value is a fixed amount off, in the branch's currency
};

// The shape of a coupon, with sensible starting values the admin screen edits.
const DEFAULT_COUPON = {
  code: '',
  description: '',
  type: COUPON_TYPE.PERCENT,
  value: 0, // percent (0-100) or a fixed amount, per `type`

  min_spend: 0, // bill must reach this to qualify (0 = none)
  max_discount: 0, // cap the discount amount (0 = no cap); mainly for percent

  start_date: null, // valid from (null = open-ended)
  end_date: null, // valid until, inclusive of the day (null = open-ended)

  usage_limit: 0, // total redemptions allowed across everyone (0 = unlimited)
  per_customer_limit: 0, // redemptions allowed per customer (0 = unlimited)
  customer_id: null, // bind a unique code to one customer (null = anyone)

  times_used: 0, // running counter, maintained on redeem/reverse
  active: true,

  currency: '', // display-only symbol at save time; never used in maths
};

const MESSAGES = {
  SAVED: 'Coupon saved',
  DELETED: 'Coupon deleted',
  NOT_FOUND: 'Coupon not found',
  DUPLICATE_CODE: 'A coupon with this code already exists',
  CODE_REQUIRED: 'A coupon code is required',
  INVALID_CODE: 'Coupon code not recognised',
  INACTIVE: 'This coupon is not active',
  NOT_STARTED: 'This coupon is not valid yet',
  EXPIRED: 'This coupon has expired',
  MIN_SPEND: 'The bill is below this coupon’s minimum spend',
  USAGE_LIMIT: 'This coupon has reached its usage limit',
  PER_CUSTOMER_LIMIT: 'This customer has already used this coupon',
  WRONG_CUSTOMER: 'This coupon belongs to a different customer',
  NO_CUSTOMER: 'This coupon can only be used by a registered customer',
  APPLIED: 'Coupon applied',
  ZERO_DISCOUNT: 'This coupon gives no discount on this bill',
};

module.exports = { COUPON_TYPE, DEFAULT_COUPON, MESSAGES };
