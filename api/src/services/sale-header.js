'use strict';

const round2 = (value, decimals = 2) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

/** Canonical sale header calculation. Coupons and loyalty must already be validated by the controller. */
function calculateSaleHeader(data, sale_tot_amount, context) {
  // Extra Discount & Round Off
  const extraDiscountRaw = data.extra_discount ? Math.abs(parseFloat(data.extra_discount)) : 0;
  const extraDiscount = round2(extraDiscountRaw, 2);
  let itemsTotAmount = sale_tot_amount - extraDiscount;
  let salesExtraDiscount = extraDiscount;

  if (data.extra_discount_type === 'percent') {
    const discAmt = sale_tot_amount * (extraDiscount / 100);
    itemsTotAmount = sale_tot_amount - discAmt;
    salesExtraDiscount = discAmt;
  }

  /*
   * Coupon discount - a code the cashier applied. Validated in the controller
   * against this branch's coupons (active, in date, within its usage limits,
   * over its minimum spend), so here it is simply a fixed amount that reduces
   * the payable total. A coupon and a loyalty redemption may both apply to one
   * bill; each is clamped so the running total can never go below zero.
   */
  const couponCode = (data.coupon_code || '').toString().trim().toUpperCase();
  const couponDiscountValue = round2(
    Math.min(Math.abs(parseFloat(data.coupon_discount_value) || 0), itemsTotAmount),
    2
  );
  if (couponDiscountValue > 0) {
    itemsTotAmount = itemsTotAmount - couponDiscountValue;
  }

  /*
   * Loyalty redemption - a discount the cashier chose to spend points on.
   *
   * The points and the currency value were already validated in the
   * controller against this branch's loyalty rules and the customer's
   * balance, so here it is simply a fixed amount that reduces the payable
   * total, exactly like the extra discount above, and then rides the same
   * round-off and payment logic below. It is a plain number in the branch's
   * own currency, so it carries no assumption about symbol or country. Clamped
   * so a redemption can never push a bill below zero.
   */
  const loyaltyRedeemValue = round2(
    Math.min(Math.abs(parseFloat(data.loyalty_redeem_value) || 0), itemsTotAmount),
    2
  );
  const loyaltyRedeemPoints = Math.max(0, parseInt(data.loyalty_redeem_points, 10) || 0);
  if (loyaltyRedeemValue > 0) {
    itemsTotAmount = itemsTotAmount - loyaltyRedeemValue;
  }

  // Fetch Branch Settings for Round Off
  const roundOffSetting = context.roundOff === true;

  let roundOffValue = 0;
  let finalSaleTotAmount = itemsTotAmount;

  if (roundOffSetting) {
    finalSaleTotAmount = Math.round(itemsTotAmount);
    roundOffValue = finalSaleTotAmount - itemsTotAmount;
  }

  const salesTotalForDoc = round2(finalSaleTotAmount, 2);
  const roundOffForDoc = round2(roundOffValue, 2);
  const itemsTotalForDoc = roundOffSetting ? Math.round(itemsTotAmount) : round2(itemsTotAmount, 2);

  return {
    extraDiscount,
    salesExtraDiscount,
    couponCode,
    couponDiscountValue,
    loyaltyRedeemPoints,
    loyaltyRedeemValue,
    finalSaleTotAmount,
    salesTotalForDoc,
    roundOffForDoc,
    itemsTotalForDoc,
  };
}
module.exports = { calculateSaleHeader, round2 };
