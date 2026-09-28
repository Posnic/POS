'use strict';
const { ObjectId } = require('mongodb');
const { active } = require('./business-access');
const { version } = require('../utils/auth-version');
const { resolveAccess } = require('../utils/access-resolver');
const { createCheckoutTransport } = require('./business-checkout-transport');
const { prepareDiscountIntent, discountIntentFromPricing } = require('./business-discount-intent');
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => /^[a-f\d]{24}$/.test(String(value || ''));

/** Authenticated checkout side of owner decisions. The public request supplies
 * only a bill/reason or decision reference, never device or cashier authority. */
function createCheckoutDecisions(db, { now = Date.now, transport } = {}) {
  const channel = transport || createCheckoutTransport(db, { now });
  async function cashier(context, authenticatedUser) {
    if (
      !id(context.branchId) ||
      !id(context.licenseId) ||
      !id(context.userId) ||
      String(authenticatedUser?._id) !== String(context.userId)
    )
      fail('cashier_access_denied', 403);
    const user = await db.collection('users').findOne({
      _id: new ObjectId(String(context.userId)),
      license: new ObjectId(String(context.licenseId)),
    });
    if (
      !active(user, now()) ||
      version(user) !== version(authenticatedUser) ||
      !user.branch_access?.some((entry) => String(entry.branch_id) === String(context.branchId)) ||
      (!['admin', 'super_admin'].includes(user.usertype || user.role) &&
        resolveAccess(user).sales?.write !== true)
    )
      fail('cashier_access_denied', 403);
    const branch = await db.collection('branches').findOne({
      _id: new ObjectId(String(context.branchId)),
      license: user.license,
    });
    if (!branch) fail('branch_access_denied', 403);
    return {
      branchId: String(branch._id),
      requesterId: String(user._id),
      requesterAuthVersion: version(user),
    };
  }
  async function reference(context, user, requestId) {
    if (!id(requestId)) fail('invalid_discount_request', 400);
    const source = await cashier(context, user);
    return {
      branchId: source.branchId,
      requesterId: source.requesterId,
      requestId: String(requestId),
    };
  }
  return {
    async request(context, user, payload, reason) {
      const source = await cashier(context, user);
      const request = await prepareDiscountIntent(payload, context, reason);
      return channel.exchange('create', { ...source, request });
    },
    async read(context, user, requestId) {
      return channel.exchange('read', await reference(context, user, requestId));
    },
    async cancel(context, user, requestId) {
      return channel.exchange('cancel', await reference(context, user, requestId));
    },
    async gate(context, user, payload) {
      const ref = await reference(context, user, payload.business_decision_id);
      const record = await channel.exchange('read', ref);
      if (record.operationId !== payload.billing_transaction_id)
        fail('decision_execution_conflict');
      if (record.state !== 'approved') fail('decision_not_approved');
      return async (pricing) => {
        await cashier(context, user);
        const current = discountIntentFromPricing(payload, context, record.summary.reason, pricing);
        if (current.revisionHash !== record.revisionHash) fail('decision_revision_changed');
        const result = await channel.start(
          { ...ref, revisionHash: current.revisionHash },
          current.operationId
        );
        // This internal context field is not copied from the sale payload.
        // Register locking retains its existing request device identity.
        context.businessDecisionDeviceId = result.deviceId;
        return result.proof;
      };
    },
  };
}
module.exports = { createCheckoutDecisions };
