'use strict';
const { ObjectId } = require('mongodb');
const { createDecisionLedger } = require('./business-decision-ledger');
const { claimDecision } = require('./business-decisions');
const { branchInfo, active } = require('./business-access');
const { resolveAccess } = require('../utils/access-resolver');
const { version } = require('../utils/auth-version');
const crypto = require('node:crypto');
const ACTIONS = ['create', 'read', 'cancel', 'claim', 'acknowledge'];
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const key = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail('invalid_device_request');
}
function view(row, now) {
  return {
    protocolVersion: 1,
    id: String(row._id),
    branchId: row.branchId,
    requesterId: row.requesterId,
    operationId: row.operationId,
    revisionHash: row.revisionHash,
    state:
      ['pending', 'approved'].includes(row.state) && row.expiresAt.getTime() <= now
        ? 'expired'
        : row.state,
    revision: row.revision,
    expiresAt: row.expiresAt.toISOString(),
    executionStartedAt:
      row.timeline.find((event) => event.state === 'applying')?.at.toISOString() || null,
    summary: row.summary,
    saleId: row.state === 'applied' ? row.saleId : null,
  };
}

/** Internal boundary for verified installations, not an HTTP request handler.
 * The adapter must authenticate and re-read the device directory before every
 * call. Never construct `device` from a body, x-device-id or cached login.
 * Cashier identity is asserted by that authoritative till after POS login;
 * current staff state, generation and explicit branch/sales access are checked
 * again here. Neither phone credentials nor totals supplied by a phone qualify.
 */
function createBusinessDeviceDecisions(db, { now = Date.now } = {}) {
  const ledger = createDecisionLedger(db, { now });
  async function scope(device, body, { recovery = false } = {}) {
    if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') fail('decisions_unavailable', 404);
    if (!device || !key(device.deviceId) || !id(body.branchId) || !id(body.requesterId))
      fail('invalid_source');
    // Null is the directory's explicit unrestricted assignment. An empty
    // array means no branches; absent/malformed authority is never all-access.
    if (
      device.branches !== null &&
      (!Array.isArray(device.branches) ||
        !device.branches.some((branch) => String(branch) === body.branchId))
    )
      fail('branch_access_denied', 403);
    const branch = await db.collection('branches').findOne({ _id: new ObjectId(body.branchId) });
    if (!branch || !ObjectId.isValid(branch.license)) fail('branch_access_denied', 403);
    const source = {
      businessId: String(branch.license),
      branchId: body.branchId,
      requesterId: body.requesterId,
      deviceId: device.deviceId,
    };
    if (!recovery) {
      const user = await db
        .collection('users')
        .findOne({ _id: new ObjectId(body.requesterId), license: branch.license });
      if (
        !active(user, now()) ||
        !user.branch_access?.some((entry) => String(entry.branch_id) === body.branchId)
      )
        fail('cashier_access_denied', 403);
      if (
        !['admin', 'super_admin'].includes(user.usertype || user.role) &&
        resolveAccess(user).sales?.write !== true
      )
        fail('cashier_access_denied', 403);
      source.authVersion = version(user);
    }
    return { source, branch };
  }
  async function record(device, body, recovery = false) {
    const current = await scope(device, body, { recovery });
    const row = await ledger.sourceRequest(current.source, body.requestId);
    if (!recovery && row.requesterAuthVersion !== current.source.authVersion)
      fail('cashier_session_changed', 403);
    return { ...current, row };
  }
  const reference = ['branchId', 'requesterId', 'requestId'];
  return {
    async create(device, body) {
      exact(body, ['branchId', 'requesterId', 'requesterAuthVersion', 'request']);
      const { source, branch } = await scope(device, body);
      if (
        !Number.isSafeInteger(body.requesterAuthVersion) ||
        body.requesterAuthVersion < 0 ||
        body.requesterAuthVersion !== source.authVersion
      )
        fail('cashier_session_changed', 403);
      const info = branchInfo(branch);
      if (
        body.request?.summary?.currency !== info.currency ||
        body.request?.summary?.currencyDigits !== info.currencyDigits
      )
        fail('branch_configuration_changed', 409);
      const row = await ledger.create(source, body.request);
      return view(row, now());
    },
    async read(device, body) {
      exact(body, reference);
      const { row } = await record(device, body);
      return view(row, now());
    },
    async cancel(device, body) {
      exact(body, reference);
      const { source } = await record(device, body);
      return view(await ledger.cancel(source, body.requestId), now());
    },
    async claim(device, body) {
      exact(body, [...reference, 'revisionHash', 'executionId']);
      if (!/^[a-f\d]{64}$/.test(body.revisionHash || '') || !key(body.executionId))
        fail('invalid_device_request');
      // Recovery checks the exact source/receipt, not permission to start a
      // new sale. A revoked cashier must not strand a committed receipt.
      const existing = await record(device, body, true);
      const recovery =
        ['applying', 'applied'].includes(existing.row.state) &&
        existing.row.executionId === body.executionId;
      const { source, row, branch } = recovery ? existing : await record(device, body);
      if (!recovery) {
        const info = branchInfo(branch);
        if (
          row.summary.currency !== info.currency ||
          row.summary.currencyDigits !== info.currencyDigits
        )
          fail('branch_configuration_changed', 409);
      }
      const result = await claimDecision(
        db,
        source,
        body.requestId,
        body.revisionHash,
        body.executionId,
        { now }
      );
      return {
        record: view(result.record, now()),
        executionPermit: result.executionPermit,
        proof:
          result.executionPermit === 'start'
            ? {
                decisionId: String(result.record._id),
                revisionHash: result.record.revisionHash,
                executionId: result.record.executionId,
                approverId: result.record.approverId,
              }
            : null,
      };
    },
    async acknowledge(device, body) {
      exact(body, [...reference, 'executionId', 'saleId']);
      const { source } = await record(device, body, true);
      return view(
        await ledger.acknowledge(source, body.requestId, body.executionId, body.saleId),
        now()
      );
    },
  };
}
async function useDeviceGrant(db, token, action, body, { now = Date.now } = {}) {
  if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') fail('decisions_unavailable', 404);
  if (!/^pbd1_[A-Za-z0-9_-]{43}$/.test(token || '') || !ACTIONS.includes(action))
    fail('device_grant_required', 401);
  const serialized = JSON.stringify(body);
  if (!serialized || Buffer.byteLength(serialized) > 16_384) fail('invalid_device_request');
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  // Gateway writes this five-second, single-use, exact-operation grant only
  // after fresh directory/token/tenant checks. It contains no device token.
  const grant = await db.collection('business_device_grants').findOneAndDelete({
    _id: digest(token),
    protocolVersion: 1,
    action,
    tenantDb: db.databaseName,
    bodyHash: digest(serialized),
    issuedAt: { $gte: new Date(now() - 5000), $lte: new Date(now() + 1000) },
    expiresAt: { $gt: new Date(now()), $lte: new Date(now() + 6000) },
  });
  if (!grant) fail('device_grant_required', 401);
  return createBusinessDeviceDecisions(db, { now })[action](grant.device, body);
}
module.exports = { protocolVersion: 1, createBusinessDeviceDecisions, useDeviceGrant };
