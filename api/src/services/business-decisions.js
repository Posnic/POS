'use strict';
const { ObjectId } = require('mongodb');
const { createBusinessAccess } = require('./business-access');
const { createDecisionLedger } = require('./business-decision-ledger');
const { remoteDiscountPolicy, withinDiscountLimit } = require('./business-decision-policy');
const fail = (code, status) => {
  throw Object.assign(new Error(code), { code, status });
};
const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const RECENT_AUTH_MS = 5 * 60_000;
function recentAuthentication(session, now) {
  const time = session.authenticatedAt instanceof Date ? session.authenticatedAt.getTime() : NaN;
  return Number.isFinite(time) && time <= now + 30_000 && now - time < RECENT_AUTH_MS;
}
function effectiveState(row, now) {
  return ['pending', 'approved'].includes(row.state) && row.expiresAt.getTime() <= now
    ? 'expired'
    : row.state;
}
async function actor(db, sessionId, now) {
  if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') fail('decisions_unavailable', 404);
  const access = createBusinessAccess(db, { now: () => now });
  const identity = await access.sessionIdentity(sessionId);
  const context = await access.contextFor(identity.user);
  const policy = remoteDiscountPolicy(identity.user);
  if (!policy || !context.capabilities.includes('approvals.read')) fail('access_denied', 403);
  return { ...identity, context, policy };
}
function scope(current) {
  return {
    license: new ObjectId(current.context.businessId),
    branchId: { $in: current.context.branches.map((branch) => branch.id) },
  };
}
async function namesFor(db, rows, license) {
  const ids = [
    ...new Set(rows.flatMap((row) => [row.requesterId, row.approverId]).filter(validId)),
  ];
  const users = ids.length
    ? await db
        .collection('users')
        .find(
          { license, _id: { $in: ids.map((id) => new ObjectId(id)) } },
          { projection: { firstname: 1, lastname: 1, username: 1 } }
        )
        .limit(100)
        .maxTimeMS(250)
        .toArray()
    : [];
  return new Map(
    users.map((user) => [
      String(user._id),
      String(
        [user.firstname, user.lastname].filter(Boolean).join(' ') || user.username || ''
      ).slice(0, 160),
    ])
  );
}
function view(row, current, names, now) {
  const state = effectiveState(row, now);
  const self = row.requesterId === current.context.accountId;
  const limited = !withinDiscountLimit(current.policy, row.summary);
  const label = (id) => ({ id, name: names.get(id) || null });
  return {
    id: String(row._id),
    branchId: row.branchId,
    action: 'discount_apply',
    state,
    revision: row.revision,
    requester: label(row.requesterId),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    summary: row.summary,
    canDecide: state === 'pending' && !self && !limited,
    unavailableReason:
      state !== 'pending' ? 'closed' : self ? 'self_approval' : limited ? 'discount_limit' : null,
    requiresStepUp: !recentAuthentication(current.session, now),
    decision: row.decisionId
      ? {
          id: row.decisionId,
          outcome: row.outcome,
          reason: row.decisionReason,
          approver: label(row.approverId),
        }
      : null,
    timeline: row.timeline
      .map((event) => ({ state: event.state, at: event.at.toISOString() }))
      .concat(state === 'expired' ? [{ state: 'expired', at: row.expiresAt.toISOString() }] : []),
  };
}
// Name resolution is asynchronous too. Recheck live identity and scope after
// all reads, and render current policy/expiry rather than the initial snapshot.
async function recheckRead(db, sessionId, previous, rows, branchId, now) {
  const time = now();
  const current = await actor(db, sessionId, time);
  const branches = new Set(current.context.branches.map((branch) => branch.id));
  if (
    current.context.businessId !== previous.context.businessId ||
    current.context.accountId !== previous.context.accountId ||
    (branchId && !branches.has(branchId)) ||
    rows.some((row) => !branches.has(row.branchId))
  )
    fail('access_denied', 403);
  return { current, time };
}
async function listDecisions(db, sessionId, query = {}, { now = Date.now } = {}) {
  if (
    Object.keys(query).some((key) => !['before', 'branchId', 'history'].includes(key)) ||
    (query.before !== undefined && !validId(query.before)) ||
    (query.branchId !== undefined && !validId(query.branchId)) ||
    (query.history !== undefined && !['true', 'false'].includes(query.history))
  )
    fail('invalid_request', 400);
  const time = now(),
    current = await actor(db, sessionId, time);
  await createDecisionLedger(db).ready();
  if (query.branchId && !current.context.branches.some((branch) => branch.id === query.branchId))
    fail('access_denied', 403);
  const filter = {
    ...scope(current),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.before ? { _id: { $lt: new ObjectId(query.before) } } : {}),
  };
  if (query.history === 'true')
    filter.$or = [
      { state: { $in: ['applied', 'declined', 'cancelled'] } },
      { state: { $in: ['pending', 'approved'] }, expiresAt: { $lte: new Date(time) } },
    ];
  else
    filter.$or = [
      { state: 'applying' },
      { state: { $in: ['pending', 'approved'] }, expiresAt: { $gt: new Date(time) } },
    ];
  const rows = await db
    .collection('business_decisions')
    .find(filter)
    .sort({ _id: -1 })
    .limit(51)
    .maxTimeMS(250)
    .toArray();
  const page = rows.slice(0, 50),
    names = await namesFor(db, page, filter.license);
  const fresh = await recheckRead(db, sessionId, current, page, query.branchId, now);
  return {
    schemaVersion: 1,
    entries: page.map((row) => view(row, fresh.current, names, fresh.time)),
    nextCursor: rows.length > 50 ? String(page[49]._id) : null,
  };
}
async function detail(db, current, requestId) {
  if (!validId(requestId)) fail('invalid_request', 400);
  const row = await db
    .collection('business_decisions')
    .findOne({ _id: new ObjectId(requestId), ...scope(current) });
  if (!row) fail('request_not_found', 404);
  return row;
}
async function readDecision(db, sessionId, requestId, { now = Date.now } = {}) {
  const time = now(),
    current = await actor(db, sessionId, time),
    row = await detail(db, current, requestId);
  const names = await namesFor(db, [row], row.license);
  const fresh = await recheckRead(db, sessionId, current, [row], row.branchId, now);
  return view(row, fresh.current, names, fresh.time);
}
async function decide(db, sessionId, requestId, input, { now = Date.now } = {}) {
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !['decisionId', 'expectedRevision', 'outcome', 'reason', 'confirmationToken'].includes(key)
    )
  )
    fail('invalid_decision', 400);
  const time = now(),
    current = await actor(db, sessionId, time),
    row = await detail(db, current, requestId);
  if (row.requesterId === current.context.accountId) fail('self_approval_denied', 409);
  if (!withinDiscountLimit(current.policy, row.summary)) fail('discount_limit_exceeded', 409);
  let authenticatedAt = current.session.authenticatedAt;
  if (row.decisionId !== input?.decisionId && !recentAuthentication(current.session, time)) {
    let confirmation;
    try {
      confirmation = await createBusinessAccess(db, { now: () => time }).authenticate(
        input.confirmationToken
      );
    } catch (error) {
      if ([401, 403].includes(error.status)) fail('step_up_required', 428);
      throw error;
    }
    if (
      String(confirmation.user._id) !== current.context.accountId ||
      String(confirmation.user.license) !== current.context.businessId
    )
      fail('confirmation_account_mismatch', 409);
    if (!recentAuthentication(confirmation.session, time)) fail('step_up_required', 428);
    const confirmedPolicy = remoteDiscountPolicy(confirmation.user);
    const confirmedContext = await createBusinessAccess(db).contextFor(confirmation.user);
    if (!confirmedPolicy || !confirmedContext.branches.some((branch) => branch.id === row.branchId))
      fail('access_denied', 403);
    if (!withinDiscountLimit(confirmedPolicy, row.summary)) fail('discount_limit_exceeded', 409);
    authenticatedAt = confirmation.session.authenticatedAt;
  }
  const decisionInput = {
    decisionId: input.decisionId,
    expectedRevision: input.expectedRevision,
    outcome: input.outcome,
    reason: input.reason,
  };
  const updated = await createDecisionLedger(db, { now }).decide(
    {
      ...current.context,
      approvalSessionId: current.session._id,
      approvalAuthenticatedAt: authenticatedAt,
    },
    requestId,
    decisionInput
  );
  if (
    authenticatedAt instanceof Date &&
    authenticatedAt.getTime() > (current.session.authenticatedAt?.getTime() || 0)
  ) {
    const refreshed = await db.collection('business_sessions').updateOne(
      {
        _id: current.session._id,
        tokenHash: current.session.tokenHash,
        authVersion: current.session.authVersion,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date(now()) },
      },
      { $max: { authenticatedAt } }
    );
    if (!refreshed.matchedCount) fail('sign_in_required', 401);
    current.session.authenticatedAt = authenticatedAt;
  }
  return view(updated, current, await namesFor(db, [updated], updated.license), now());
}
/** Internal till bridge only; source identity must come from its authenticated
 * device/cashier channel, never from the Business phone request body. */
async function claimDecision(
  db,
  source,
  requestId,
  revisionHash,
  executionId,
  { now = Date.now } = {}
) {
  if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') fail('decisions_unavailable', 404);
  const ledger = createDecisionLedger(db, { now });
  const row = await ledger.sourceRequest(source, requestId);
  if (['applying', 'applied'].includes(row.state) && row.executionId === executionId)
    return ledger.claim(source, requestId, revisionHash, executionId, null);
  if (row.state !== 'approved') fail('decision_changed', 409);
  const current = await actor(db, row.approverSessionId, now());
  if (
    current.context.accountId !== row.approverId ||
    !withinDiscountLimit(current.policy, row.summary)
  )
    fail('approval_access_changed', 409);
  return ledger.claim(source, requestId, revisionHash, executionId, current.context);
}
module.exports = {
  listDecisions,
  readDecision,
  decide,
  claimDecision,
  recentAuthentication,
  RECENT_AUTH_MS,
};
