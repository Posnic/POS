'use strict';

const { BadRequestError } = require('../utils/appError');

const round2 = (value, decimals = 2) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

function roundSaleTotal(value, enabled, decimals = 2) {
  const amount = round2(value, decimals);
  const total = enabled === true ? Math.round(amount) : amount;
  return { total, roundOff: round2(total - amount, decimals) };
}

/** Canonical sale header calculation. Coupons and loyalty must already be validated by the controller. */
function calculateSaleHeader(data, sale_tot_amount, context) {
  // Extra Discount & Round Off
  const extraDiscountRaw =
    data.extra_discount == null || data.extra_discount === '' ? 0 : Number(data.extra_discount);
  if (
    !Number.isFinite(extraDiscountRaw) ||
    extraDiscountRaw < 0 ||
    (data.extra_discount_type === 'percent'
      ? extraDiscountRaw > 100
      : extraDiscountRaw > sale_tot_amount)
  )
    throw new BadRequestError(
      'Additional discount must be between zero and the bill amount (or 100%).'
    );
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

  itemsTotAmount += Number(context.outletCharge) || 0;

  // Fetch Branch Settings for Round Off
  const roundOffSetting = context.roundOff === true;

  const { total: finalSaleTotAmount, roundOff: roundOffValue } = roundSaleTotal(
    itemsTotAmount,
    roundOffSetting
  );

  const salesTotalForDoc = round2(finalSaleTotAmount, 2);
  const roundOffForDoc = round2(roundOffValue, 2);
  const itemsTotalForDoc = salesTotalForDoc;

  return {
    beforeManualDiscountForDoc: round2(sale_tot_amount, 2),
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
module.exports = { calculateSaleHeader, round2, roundSaleTotal };
