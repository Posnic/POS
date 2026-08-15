'use strict';

/*
 * Loyalty is currency- and country-agnostic on purpose.
 *
 * A point is a point. Every rate maps points <-> the BRANCH's own currency as a
 * ratio (earn X points per Y spent; Z points are worth W of currency), so the
 * same config works for a shop billing in rupees, dollars, dirhams or anything
 * else - nothing here assumes a symbol, a locale, or two decimal places. The
 * amount handed in is always in the branch's currency; the config just scales it.
 *
 * Everything below is a DEFAULT. A branch overrides any of it in loyalty_config.
 */

const LEDGER_TYPE = {
  EARN: 'earn', // points added by a purchase
  REDEEM: 'redeem', // points spent as a discount
  EXPIRE: 'expire', // points lapsed
  ADJUST: 'adjust', // manual correction by staff
  REVERSE: 'reverse', // undo of an earn/redeem when a sale is returned/voided
};

const ROUNDING = { FLOOR: 'floor', ROUND: 'round', CEIL: 'ceil' };

// The shape of a config, with sensible starting values a branch can change.
const DEFAULT_CONFIG = {
  enabled: false,

  // EARN: earn `earn_points` points for every `earn_amount` of currency spent.
  // e.g. earn_points 1 / earn_amount 100  ->  1 point per 100 spent.
  earn_points: 1,
  earn_amount: 100,
  min_spend: 0, // a bill under this earns nothing
  earn_rounding: ROUNDING.FLOOR, // how fractional earned points are rounded

  // REDEEM: `redeem_points` points are worth `redeem_value` of currency.
  // e.g. redeem_points 1 / redeem_value 1  ->  1 point = 1 unit of currency.
  redeem_points: 1,
  redeem_value: 1,
  min_redeem: 0, // fewest points that can be redeemed in one go
  max_redeem_percent: 100, // most of a bill (%) that points may pay for

  // EXPIRY: points lapse this many months after they were earned. 0 = never.
  expiry_months: 0,

  // REFERRALS: when a customer referred by another makes their first qualifying
  // purchase, reward BOTH sides with points (so it stays currency-agnostic). The
  // referred customer's bill must reach referral_min_spend to count.
  referral_enabled: false,
  referral_referrer_points: 0, // to the existing customer who referred
  referral_referee_points: 0, // to the newly-referred customer
  referral_min_spend: 0, // the referee's first bill must reach this

  // TIERS: fully configurable. threshold is a lifetime-points bar; multiplier
  // scales earning while the customer sits in that tier.
  tiers: [
    { name: 'Bronze', threshold: 0, multiplier: 1 },
    { name: 'Silver', threshold: 1000, multiplier: 1 },
    { name: 'Gold', threshold: 5000, multiplier: 1.25 },
    { name: 'Platinum', threshold: 10000, multiplier: 1.5 },
  ],
};

const MESSAGES = {
  CONFIG_SAVED: 'Loyalty settings saved',
  NOT_ENABLED: 'Loyalty is not enabled for this branch',
  INVALID_POINTS: 'Enter a valid number of points',
  INSUFFICIENT_POINTS: 'Not enough points',
  BELOW_MIN_REDEEM: 'Below the minimum points needed to redeem',
  POINTS_EARNED: 'Points earned',
  POINTS_REDEEMED: 'Points redeemed',
  CUSTOMER_REQUIRED: 'A customer is required for loyalty',
};

module.exports = { LEDGER_TYPE, ROUNDING, DEFAULT_CONFIG, MESSAGES };
