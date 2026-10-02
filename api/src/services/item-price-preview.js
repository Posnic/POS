'use strict';

const { computeLineTax, round2 } = require('./tax-engine');

function preview(input) {
  const price = Number(input.price);
  const tax = Number(input.tax || 0);
  const amount = Number(input.discount_amount || 0);
  const percent = Number(input.discount_percentage || 0);
  if (
    input.price === '' ||
    input.price === undefined ||
    ![price, tax, amount, percent].every(Number.isFinite) ||
    price < 0 ||
    tax < 0 ||
    tax > 100 ||
    amount < 0 ||
    percent < 0 ||
    percent > 100 ||
    !['inclusive', 'exclusive'].includes(input.tax_type)
  )
    throw new Error('Check the price, tax and discount.');
  const result = computeLineTax({
    itemAmount: price,
    sellingPrice: price,
    itemQuantity: 1,
    itemTax: tax,
    taxType: input.tax_type,
    discountAmount: amount,
    discountPercentage: percent,
  });
  if (result.total < 0 || result.subtotal - result.discount < 0)
    throw new Error('The discount is greater than the price.');
  return {
    base: round2(result.subtotal),
    discount: round2(result.discount),
    tax: round2(result.tax),
    total: round2(result.total),
  };
}

module.exports = { preview };
