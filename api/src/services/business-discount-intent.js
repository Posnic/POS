'use strict';
const { revisionHash } = require('./business-decision-ledger');
const { branchInfo } = require('./business-access');
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: 422 });
};
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const minor = (value) => {
  if (!Number.isFinite(value) || value < 0) fail('invalid_discount_preview');
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result)) fail('invalid_discount_preview');
  return result;
};

/** First operation contract: a new paid counter sale with a bill-level manual
 * discount. Unsupported combinations fail explicitly, never use client totals. */
function validateIntent(payload, context, reason) {
  if (
    !payload ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(payload.billing_transaction_id || '') ||
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 100 ||
    typeof reason !== 'string' ||
    !reason.trim() ||
    reason.length > 500
  )
    fail('invalid_discount_request');
  if (
    String(payload.unpaid) === 'true' ||
    String(payload.partial_check) === 'true' ||
    !payload.payment_mode ||
    payload.sale_method === 'Table-Order' ||
    (payload.sale_process && payload.sale_process !== 'Add') ||
    payload.coupon_code ||
    positive(payload.coupon_discount_value) ||
    positive(payload.loyalty_redeem_value) ||
    positive(payload.loyalty_redeem_points) ||
    positive(payload.tip_amount) ||
    payload._id ||
    payload.sales_id ||
    !positive(payload.extra_discount)
  )
    fail('unsupported_discount_combination');
  if (
    payload.items.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        [
          'sale_inline_discount_value',
          'sale_inline_discount_pervalue',
          'item_discount',
          'item_discount_percentage',
          'discount_amount',
          'discount_percentage',
        ].some((field) => positive(item[field]))
    )
  )
    fail('unsupported_discount_combination');
  const branch = branchInfo(context.branchSettings || {});
  if (branch.id !== String(context.branchId) || branch.currencyDigits !== 2)
    fail('unsupported_discount_currency');
  const intent = { ...payload };
  delete intent.approval_token;
  delete intent.business_decision_id;
  // Validate the complete JSON intent before any pricing queries.
  revisionHash(intent);
  return { intent, branch };
}
async function prepareDiscountIntent(payload, context, reason) {
  const { intent } = validateIntent(payload, context, reason);
  const preview = await require('./sale.service').previewSale(intent, context);
  if (preview.status !== true) fail('discount_preview_unavailable');
  return discountIntentFromPricing(payload, context, reason, preview.data);
}
function discountIntentFromPricing(payload, context, reason, pricing) {
  const { intent, branch } = validateIntent(payload, context, reason);
  const header = pricing.header;
  const beforeDiscountMinor = minor(header.beforeManualDiscountForDoc),
    discountMinor = minor(header.salesExtraDiscount),
    payableMinor = minor(header.salesTotalForDoc);
  const roundingMinor = payableMinor - beforeDiscountMinor + discountMinor;
  if (discountMinor <= 0 || discountMinor > beforeDiscountMinor || Math.abs(roundingMinor) > 100)
    fail('invalid_discount_preview');
  return {
    operationId: intent.billing_transaction_id,
    revisionHash: revisionHash({
      intent,
      pricing,
      branchId: branch.id,
      currency: branch.currency,
      currencyDigits: branch.currencyDigits,
    }),
    summary: {
      beforeDiscountMinor,
      discountMinor,
      payableMinor,
      roundingMinor,
      currency: branch.currency,
      currencyDigits: branch.currencyDigits,
      itemCount: intent.items.length,
      reason: reason.trim(),
    },
  };
}
module.exports = { prepareDiscountIntent, discountIntentFromPricing };
