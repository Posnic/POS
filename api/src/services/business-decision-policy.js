'use strict';
const { resolveAccess } = require('../utils/access-resolver');

function remoteDiscountPolicy(user) {
  if (process.env.POSNIC_BUSINESS_DECISIONS !== '1' || !user) return null;
  const access = resolveAccess(user);
  if (['admin', 'super_admin'].includes(user.usertype || user.role))
    return { maxDiscountBasisPoints: 10000 };
  if (
    access.dashboard?.read !== true ||
    access.dashboard?.financials !== true ||
    access.pos?.discount_approve_remote !== true
  )
    return null;
  const cap = access.pos.discount_max_percent ?? 0;
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 100) return null;
  return { maxDiscountBasisPoints: cap === 0 ? 10000 : Math.floor((cap + Number.EPSILON) * 100) };
}
function withinDiscountLimit(policy, summary) {
  return (
    !!policy &&
    Number.isSafeInteger(summary.beforeDiscountMinor) &&
    summary.beforeDiscountMinor > 0 &&
    Number.isSafeInteger(summary.discountMinor) &&
    summary.discountMinor > 0 &&
    BigInt(summary.discountMinor) * 10000n <=
      BigInt(summary.beforeDiscountMinor) * BigInt(policy.maxDiscountBasisPoints)
  );
}
module.exports = { remoteDiscountPolicy, withinDiscountLimit };
