'use strict';
const crypto = require('node:crypto');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const key = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};

/** Internal desktop transport. Identity must come from the local agent and
 * authenticated POS context, never a request header. No method writes a sale.
 * A consumed permit is deliberately never released, including after a crash.
 */
function createDecisionOutbox(db, { now = Date.now } = {}) {
  const local = db.collection('business_decision_local');
  function enabled() {
    if (process.env.POSNIC_BUSINESS_DECISIONS !== '1') fail('decisions_unavailable', 404);
  }
  async function advertise() {
    enabled();
    await local.updateOne(
      { _id: 'desktop-runtime' },
      { $set: { protocolVersion: 1, expiresAt: new Date(now() + 120000) } },
      { upsert: true }
    );
    const agent = await local.findOne({
      _id: 'agent-runtime',
      protocolVersion: 1,
      expiresAt: { $gt: new Date(now()) },
    });
    if (!agent || !key(agent.deviceId)) fail('decision_agent_unavailable', 503);
    return agent.deviceId;
  }
  async function claim(deviceId, body) {
    enabled();
    if (
      !key(deviceId) ||
      !body ||
      !id(body.branchId) ||
      !id(body.requesterId) ||
      !id(body.requestId) ||
      !/^[a-f\d]{64}$/.test(body.revisionHash || '') ||
      Object.keys(body).sort().join(',') !== 'branchId,requestId,requesterId,revisionHash'
    )
      fail('invalid_local_command', 400);
    // One immutable command per decision and installation, across restarts and
    // concurrent HTTP requests. Caller-supplied execution IDs are never used.
    const commandId = digest('claim:' + deviceId + ':' + body.requestId);
    const envelope = { ...body, executionId: crypto.randomUUID() };
    try {
      await local.updateOne(
        { _id: commandId },
        {
          $setOnInsert: {
            kind: 'command',
            protocolVersion: 1,
            deviceId,
            action: 'claim',
            body: envelope,
            bodyHash: digest(JSON.stringify(envelope)),
            state: 'queued',
            attempts: 0,
            createdAt: new Date(now()),
            nextAttemptAt: new Date(now()),
            expiresAt: new Date(now() + 86400000),
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const row = await local.findOne({ _id: commandId });
    if (
      !row ||
      row.deviceId !== deviceId ||
      row.action !== 'claim' ||
      Object.keys(body).some((field) => row.body?.[field] !== body[field])
    )
      fail('decision_execution_conflict');
    return { commandId, executionId: row.body.executionId };
  }
  async function consume(commandId, deviceId, expected) {
    enabled();
    if (
      !key(commandId) ||
      !key(deviceId) ||
      !expected ||
      !id(expected.requestId) ||
      !id(expected.branchId) ||
      !id(expected.requesterId) ||
      !key(expected.executionId) ||
      !key(expected.operationId) ||
      !/^[a-f\d]{64}$/.test(expected.revisionHash || '')
    )
      fail('invalid_local_command', 400);
    // Validate the returned proof before the CAS. The CAS also binds the exact
    // inspected response/body so a concurrent transport update cannot swap it.
    const row = await local.findOne({ _id: commandId, deviceId, action: 'claim', state: 'done' });
    const proof = row?.response?.proof,
      record = row?.response?.record;
    if (
      !row ||
      row.protocolVersion !== 1 ||
      row.bodyHash !== digest(JSON.stringify(row.body)) ||
      row.response.executionPermit !== 'start' ||
      !proof ||
      !record ||
      Object.keys(proof).sort().join(',') !== 'approverId,decisionId,executionId,revisionHash' ||
      !id(proof.approverId) ||
      proof.approverId === expected.requesterId ||
      proof.decisionId !== expected.requestId ||
      proof.executionId !== expected.executionId ||
      proof.revisionHash !== expected.revisionHash ||
      record.state !== 'applying' ||
      record.id !== expected.requestId ||
      record.operationId !== expected.operationId ||
      ['branchId', 'requesterId', 'revisionHash'].some(
        (field) => record[field] !== expected[field]
      ) ||
      ['branchId', 'requesterId', 'requestId', 'revisionHash', 'executionId'].some(
        (field) => row.body[field] !== expected[field]
      )
    )
      fail('decision_reconciliation_required');
    const startedAt = Date.parse(record.executionStartedAt);
    if (!Number.isFinite(startedAt) || startedAt > now() + 1000 || now() >= startedAt + 5000)
      fail('decision_reconciliation_required');
    const consumed = await local.findOneAndUpdate(
      {
        _id: commandId,
        deviceId,
        protocolVersion: 1,
        action: 'claim',
        state: 'done',
        body: row.body,
        response: row.response,
        consumedAt: { $exists: false },
        startExpiresAt: { $gt: new Date(now()), $lte: new Date(startedAt + 5000) },
      },
      { $set: { consumedAt: new Date(now()), executionState: 'committing' } },
      { returnDocument: 'after' }
    );
    if (!consumed) fail('decision_reconciliation_required');
    return { ...proof };
  }
  return { advertise, claim, consume };
}
module.exports = { createDecisionOutbox };
