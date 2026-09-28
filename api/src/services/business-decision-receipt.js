'use strict';
/** Called only with proof returned by the server's pre-commit decision gate. */
function decisionReceipt(proof, context, operationId, pricing) {
  const deviceId = context.businessDecisionDeviceId || context.deviceId;
  const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
  const key = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
  if (
    !proof ||
    Object.keys(proof).sort().join(',') !== 'approverId,decisionId,executionId,revisionHash' ||
    !id(proof.decisionId) ||
    !id(proof.approverId) ||
    proof.approverId === String(context.userId) ||
    !id(String(context.userId)) ||
    !/^[a-f\d]{64}$/.test(proof.revisionHash || '') ||
    !key(proof.executionId) ||
    !key(operationId) ||
    !key(deviceId)
  )
    throw new Error('Invalid decision commit proof');
  const branch = require('./business-access').branchInfo(context.branchSettings || {});
  const payableMinor = Math.round(pricing.header.salesTotalForDoc * 100);
  const discountMinor = Math.round(pricing.header.salesExtraDiscount * 100);
  if (
    branch.id !== String(context.branchId) ||
    branch.currencyDigits !== 2 ||
    !Number.isSafeInteger(payableMinor) ||
    payableMinor < 0 ||
    !Number.isSafeInteger(discountMinor) ||
    discountMinor <= 0
  )
    throw new Error('Invalid decision receipt amounts');
  return {
    version: 1,
    ...proof,
    operationId,
    deviceId,
    requesterId: String(context.userId),
    currency: branch.currency,
    currencyDigits: branch.currencyDigits,
    payableMinor,
    discountMinor,
    recordedAt: new Date(),
  };
}
module.exports = { decisionReceipt };
