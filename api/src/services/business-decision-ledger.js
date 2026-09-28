'use strict';

const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const indexes = new WeakMap();
const LIFETIME_MS = 5 * 60_000;
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const key = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);

/** Hash the complete authoritative sale intent, not a client-supplied total.
 * The caller removes transport credentials before invoking this function. */
function revisionHash(intent) {
  let nodes = 0,
    bytes = 0;
  function piece(value) {
    bytes += Buffer.byteLength(value);
    if (bytes > 256_000) fail('invalid_bill_intent', 400);
    return value;
  }
  function canonical(value, depth) {
    if (++nodes > 20_000 || depth > 16) fail('invalid_bill_intent', 400);
    if (value === null || typeof value === 'boolean') return piece(JSON.stringify(value));
    if (typeof value === 'number' && Number.isFinite(value)) return piece(JSON.stringify(value));
    if (typeof value === 'string' && value.length <= 8192) return piece(JSON.stringify(value));
    if (Array.isArray(value))
      return '[' + value.map((entry) => canonical(entry, depth + 1)).join(',') + ']';
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map((name) => {
            if (
              name.length > 256 ||
              [
                '__proto__',
                'prototype',
                'constructor',
                'approval_token',
                'password',
                'token',
              ].includes(name)
            )
              fail('invalid_bill_intent', 400);
            return piece(JSON.stringify(name)) + ':' + canonical(value[name], depth + 1);
          })
          .join(',') +
        '}'
      );
    }
    fail('invalid_bill_intent', 400);
  }
  const encoded = canonical(intent, 0);
  if (Buffer.byteLength(encoded) > 256_000) fail('invalid_bill_intent', 400);
  return crypto.createHash('sha256').update(encoded).digest('hex');
}
function sourceFilter(source) {
  if (
    !source ||
    !id(source.businessId) ||
    !id(source.branchId) ||
    !id(source.requesterId) ||
    !key(source.deviceId)
  )
    fail('invalid_source', 400);
  return {
    license: new ObjectId(source.businessId),
    branchId: source.branchId,
    deviceId: source.deviceId,
    requesterId: source.requesterId,
  };
}
function requestInput(input) {
  if (
    !input ||
    Object.keys(input).sort().join(',') !== 'operationId,revisionHash,summary' ||
    !key(input.operationId) ||
    !/^[a-f\d]{64}$/.test(input.revisionHash || '')
  )
    fail('invalid_request', 400);
  const summary = input.summary;
  if (
    !summary ||
    Object.keys(summary).sort().join(',') !==
      'beforeDiscountMinor,currency,currencyDigits,discountMinor,itemCount,payableMinor,reason,roundingMinor' ||
    !/^[A-Z]{3}$/.test(summary.currency || '') ||
    !Number.isInteger(summary.currencyDigits) ||
    summary.currencyDigits < 0 ||
    summary.currencyDigits > 3 ||
    !Number.isInteger(summary.itemCount) ||
    summary.itemCount < 1 ||
    summary.itemCount > 500 ||
    typeof summary.reason !== 'string' ||
    summary.reason.trim().length < 1 ||
    summary.reason.length > 500
  )
    fail('invalid_summary', 400);
  for (const field of ['beforeDiscountMinor', 'discountMinor', 'payableMinor']) {
    if (!Number.isSafeInteger(summary[field]) || summary[field] < 0) fail('invalid_summary', 400);
  }
  if (
    summary.discountMinor === 0 ||
    summary.discountMinor > summary.beforeDiscountMinor ||
    !Number.isSafeInteger(summary.roundingMinor) ||
    Math.abs(summary.roundingMinor) > 100 ||
    summary.payableMinor !==
      summary.beforeDiscountMinor - summary.discountMinor + summary.roundingMinor
  )
    fail('invalid_summary', 400);
}
/** Durable mechanics only. Callers must authenticate sources, derive the price
 * preview with the sale authority, and re-read ACL/step-up before every action.
 * No route exposes this ledger until the complete till consume path is wired. */
function createDecisionLedger(db, { now = Date.now } = {}) {
  const rows = db.collection('business_decisions');
  async function ready() {
    if (!indexes.has(db)) {
      const work = Promise.all([
        rows.createIndex(
          { license: 1, deviceId: 1, operationId: 1, revisionHash: 1 },
          { unique: true }
        ),
        rows.createIndex({ license: 1, branchId: 1, state: 1, createdAt: -1 }),
      ]).catch((error) => {
        indexes.delete(db);
        throw error;
      });
      indexes.set(db, work);
    }
    await indexes.get(db);
  }
  async function get(filter) {
    const row = await rows.findOne(filter);
    if (!row) fail('request_not_found', 404);
    return row;
  }
  function fresh(row) {
    if (row.expiresAt.getTime() <= now()) fail('request_expired', 410);
  }
  function approver(context, row) {
    if (
      !context ||
      context.businessId !== String(row.license) ||
      !context.capabilities.includes('discounts.approve') ||
      !context.branches.some((branch) => branch.id === row.branchId) ||
      !id(context.accountId)
    )
      fail('access_denied', 403);
    if (context.accountId === row.requesterId) fail('self_approval_denied', 403);
  }
  async function transition(row, state, details) {
    const at = new Date(now());
    const changed = await rows.findOneAndUpdate(
      {
        _id: row._id,
        revision: row.revision,
        state: row.state,
        ...(['approved', 'declined', 'applying'].includes(state) ? { expiresAt: { $gt: at } } : {}),
      },
      {
        $set: { state, ...details },
        $inc: { revision: 1 },
        $push: { timeline: { state, at, ...details } },
      },
      { returnDocument: 'after' }
    );
    if (!changed) fail('decision_changed');
    return changed;
  }
  return {
    async create(source, input) {
      const filter = sourceFilter(source);
      requestInput(input);
      await ready();
      const at = new Date(now());
      const identity = {
        license: filter.license,
        deviceId: filter.deviceId,
        operationId: input.operationId,
        revisionHash: input.revisionHash,
      };
      await rows
        .updateOne(
          identity,
          {
            $setOnInsert: {
              ...filter,
              ...input,
              action: 'discount_apply',
              state: 'pending',
              revision: 0,
              createdAt: at,
              expiresAt: new Date(now() + LIFETIME_MS),
              timeline: [{ state: 'pending', at }],
            },
          },
          { upsert: true }
        )
        .catch((error) => {
          if (error.code !== 11000) throw error;
        });
      const row = await get(identity);
      if (
        row.branchId !== filter.branchId ||
        row.requesterId !== filter.requesterId ||
        revisionHash(row.summary) !== revisionHash(input.summary)
      )
        fail('operation_conflict');
      return row;
    },
    async decide(context, requestId, input) {
      if (
        !id(requestId) ||
        !input ||
        Object.keys(input).sort().join(',') !== 'decisionId,expectedRevision,outcome,reason' ||
        !key(input.decisionId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        !['approved', 'declined'].includes(input.outcome) ||
        typeof input.reason !== 'string' ||
        input.reason.length > 500 ||
        (input.outcome === 'declined' && !input.reason.trim())
      )
        fail('invalid_decision', 400);
      const row = await get({ _id: new ObjectId(requestId) });
      approver(context, row);
      if (row.decisionId === input.decisionId) {
        if (
          row.approverId !== context.accountId ||
          row.outcome !== input.outcome ||
          row.decisionReason !== input.reason
        )
          fail('decision_conflict');
        return row;
      }
      fresh(row);
      if (row.state !== 'pending' || row.revision !== input.expectedRevision)
        fail('decision_changed');
      return transition(row, input.outcome, {
        decisionId: input.decisionId,
        approverId: context.accountId,
        outcome: input.outcome,
        decisionReason: input.reason,
      });
    },
    async cancel(source, requestId) {
      if (!id(requestId)) fail('invalid_request', 400);
      const row = await get({ _id: new ObjectId(requestId), ...sourceFilter(source) });
      if (row.state === 'cancelled') return row;
      if (!['pending', 'approved'].includes(row.state)) fail('decision_changed');
      return transition(row, 'cancelled', {});
    },
    async claim(source, requestId, hash, executionId, currentApprover) {
      if (!id(requestId) || !key(executionId)) fail('invalid_request', 400);
      const row = await get({ _id: new ObjectId(requestId), ...sourceFilter(source) });
      if (row.revisionHash !== hash) fail('bill_changed');
      if (['applying', 'applied'].includes(row.state) && row.executionId === executionId)
        return { record: row, executionPermit: row.state === 'applied' ? 'complete' : 'reconcile' };
      fresh(row);
      if (row.state !== 'approved') fail('decision_changed');
      approver(currentApprover, row);
      if (row.approverId !== currentApprover.accountId) fail('access_denied', 403);
      return {
        record: await transition(row, 'applying', { executionId }),
        executionPermit: 'start',
      };
    },
    async acknowledge(source, requestId, executionId, saleId) {
      if (!id(requestId) || !key(executionId) || !id(saleId)) fail('invalid_receipt', 400);
      const row = await get({ _id: new ObjectId(requestId), ...sourceFilter(source) });
      if (row.executionId !== executionId || !['applying', 'applied'].includes(row.state))
        fail('execution_conflict');
      if (row.state === 'applied') {
        if (row.saleId !== saleId) fail('execution_conflict');
        return row;
      }
      const receipt = await db.collection('sales').findOne(
        {
          _id: new ObjectId(saleId),
          license: row.license,
          branch_id: new ObjectId(row.branchId),
          billing_transaction_id: row.operationId,
          'business_decision_receipt.version': 1,
          'business_decision_receipt.decisionId': String(row._id),
          'business_decision_receipt.revisionHash': row.revisionHash,
          'business_decision_receipt.executionId': executionId,
          'business_decision_receipt.operationId': row.operationId,
          'business_decision_receipt.deviceId': row.deviceId,
          'business_decision_receipt.requesterId': row.requesterId,
          'business_decision_receipt.approverId': row.approverId,
          'business_decision_receipt.currency': row.summary.currency,
          'business_decision_receipt.currencyDigits': row.summary.currencyDigits,
          'business_decision_receipt.payableMinor': row.summary.payableMinor,
          'business_decision_receipt.discountMinor': row.summary.discountMinor,
        },
        { projection: { _id: 1 } }
      );
      if (!receipt) fail('sale_receipt_unconfirmed');
      return transition(row, 'applied', { saleId });
    },
  };
}
module.exports = { createDecisionLedger, revisionHash, LIFETIME_MS };
