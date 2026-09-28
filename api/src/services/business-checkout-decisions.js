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
    async capabilities(context, user) {
      const source = await cashier(context, user);
      return {
        enabled: true,
        protocolVersion: 1,
        branchId: source.branchId,
        requesterId: source.requesterId,
        mode: require('./business-checkout-transport').checkoutMode(),
        currencyDigits: require('./business-access').branchInfo(context.branchSettings)
          .currencyDigits,
      };
    },
    async request(context, user, payload, reason) {
      const source = await cashier(context, user);
      const request = await prepareDiscountIntent(payload, context, reason);
      return channel.exchange('create', { ...source, request });
    },
    async lookup(context, user, operationId) {
      const source = await cashier(context, user);
      const record = await channel.lookup(
        { branchId: source.branchId, requesterId: source.requesterId },
        operationId
      );
      return record ? this.read(context, user, record.id) : null;
    },
    async read(context, user, requestId) {
      const ref = await reference(context, user, requestId);
      const record = await channel.exchange('read', ref);
      let checkout = { state: 'not_started', saleId: null };
      await require('./business-decision-local').ensureLocalDecisionIndexes(db);
      const local = await db.collection('business_decision_local').findOne({
        kind: 'command',
        protocolVersion: 1,
        action: 'claim',
        'body.requestId': ref.requestId,
        'body.branchId': ref.branchId,
        'body.requesterId': ref.requesterId,
      });
      if (local) {
        // Confirm local persistence, never infer a sale from an execution claim.
        const sale = await db.collection('sales').findOne(
          {
            license: new ObjectId(String(context.licenseId)),
            branch_id: new ObjectId(ref.branchId),
            billing_transaction_id: record.operationId,
            'business_decision_receipt.version': 1,
            'business_decision_receipt.decisionId': ref.requestId,
            'business_decision_receipt.executionId': local.body.executionId,
            'business_decision_receipt.revisionHash': record.revisionHash,
            'business_decision_receipt.requesterId': ref.requesterId,
            'business_decision_receipt.deviceId': local.deviceId,
          },
          { projection: { _id: 1 }, maxTimeMS: 250 }
        );
        if (sale)
          checkout = {
            state: record.state === 'applied' ? 'applied' : 'saved',
            saleId: String(sale._id),
          };
        else if (local.consumedAt || ['applying', 'applied'].includes(record.state))
          checkout = { state: 'reconciling', saleId: null };
      } else if (['applying', 'applied'].includes(record.state))
        checkout = { state: 'reconciling', saleId: null };
      return { ...record, checkout };
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
