'use strict';
const { calculateSaleHeader } = require('../../../src/services/sale-header');

describe('canonical sale header used by checkout and decision previews', () => {
  test('manual, coupon and loyalty discounts reduce the same running amount in order', () => {
    const result = calculateSaleHeader(
      {
        extra_discount: 10,
        coupon_code: ' welcome ',
        coupon_discount_value: 5,
        loyalty_redeem_value: 5,
        loyalty_redeem_points: 50,
      },
      100,
      { roundOff: false }
    );
    expect(result).toMatchObject({
      salesExtraDiscount: 10,
      couponCode: 'WELCOME',
      couponDiscountValue: 5,
      loyaltyRedeemValue: 5,
      loyaltyRedeemPoints: 50,
      salesTotalForDoc: 80,
      itemsTotalForDoc: 80,
      roundOffForDoc: 0,
    });
  });
  test('percentage discounts preserve raw calculation before the existing branch round-off rule', () => {
    const data = { extra_discount: 12.5, extra_discount_type: 'percent' };
    expect(calculateSaleHeader(data, 199.99, { roundOff: false })).toMatchObject({
      salesTotalForDoc: 174.99,
      itemsTotalForDoc: 174.99,
      roundOffForDoc: 0,
    });
    expect(calculateSaleHeader(data, 199.99, { roundOff: true })).toMatchObject({
      salesTotalForDoc: 175,
      itemsTotalForDoc: 175,
      roundOffForDoc: 0.01,
    });
  });
  test('validated coupon and loyalty values cannot each spend the original total again', () => {
    expect(
      calculateSaleHeader({ coupon_discount_value: 80, loyalty_redeem_value: 80 }, 100, {
        roundOff: false,
      })
    ).toMatchObject({ couponDiscountValue: 80, loyaltyRedeemValue: 20, salesTotalForDoc: 0 });
  });
  test('tips and display totals do not alter the server-calculated sale amount', () => {
    expect(
      calculateSaleHeader({ sales_total: 99999, tip_amount: 25, tip_in_total: 'true' }, 100, {
        roundOff: false,
      }).salesTotalForDoc
    ).toBe(100);
  });
});

test.each([-1, 101, Infinity, 'bad', '20abc'])('rejects invalid percent discount %s', (value) => {
  expect(() =>
    calculateSaleHeader({ extra_discount: value, extra_discount_type: 'percent' }, 100, {})
  ).toThrow();
});
test('full discount leaves additional charges payable and never discounts them', () => {
  expect(
    calculateSaleHeader({ extra_discount: 100, extra_discount_type: 'percent' }, 100, {
      outletCharge: 20.05,
    }).salesTotalForDoc
  ).toBe(20.05);
  expect(() => calculateSaleHeader({ extra_discount: 101 }, 100, {})).toThrow();
});
