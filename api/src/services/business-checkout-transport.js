'use strict';
const crypto = require('node:crypto');
const { isMultiTenant } = require('../db/tenant-context');
const { createDecisionOutbox } = require('./business-decision-outbox');
const { createBusinessDeviceDecisions } = require('./business-device-decisions');
const fail = (code, status = 503) => {
  throw Object.assign(new Error(code), { code, status });
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checkoutMode() {
  if (
    process.env.POSNIC_DESKTOP !== '1' ||
    isMultiTenant() ||
    process.env.POSNIC_BUSINESS_DECISIONS !== '1'
  )
    return null;
  if (process.env.POSNIC_SYNC_PAIRED === '1') return 'cloud';
  return process.env.POSNIC_BUSINESS_LOCAL_DECISIONS === '1' ? 'community' : null;
}

/** Internal checkout adapter. The desktop shell decides the pairing mode;
 * callers cannot select a server or provide an installation identity. */
function createCheckoutTransport(db, { now = Date.now, wait = sleep } = {}) {
  if (
    process.env.POSNIC_DESKTOP !== '1' ||
    isMultiTenant() ||
    process.env.POSNIC_BUSINESS_DECISIONS !== '1'
  )
    fail('decisions_unavailable', 404);
  const paired = process.env.POSNIC_SYNC_PAIRED === '1';
  if (!paired && process.env.POSNIC_BUSINESS_LOCAL_DECISIONS !== '1')
    fail('decisions_unavailable', 404);
  const outbox = createDecisionOutbox(db, { now });
  const local = db.collection('business_decision_local');
  const community = paired ? null : createBusinessDeviceDecisions(db, { now });
  let installation;
  async function identity() {
    if (paired) {
      // Bootstrap the existing agent without creating a background process.
      for (let n = 0; n < 16; n++) {
        try {
          return await outbox.advertise();
        } catch (error) {
          if (error.code !== 'decision_agent_unavailable' || n === 15) throw error;
          await wait(200);
        }
      }
    }
    if (!installation) {
      // Explicit Community mode never advertises work to a Cloud agent.
      await local.deleteOne({ _id: 'desktop-runtime' });
      try {
        await local.updateOne(
          { _id: 'community-installation' },
          {
            $setOnInsert: { deviceId: 'community-' + crypto.randomUUID() },
          },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
      installation = (await local.findOne({ _id: 'community-installation' }))?.deviceId;
      if (!/^community-[A-Za-z0-9_-]{16,128}$/.test(installation || ''))
        fail('decision_installation_unavailable');
    }
    return installation;
  }
  async function awaitReply(commandId, deviceId) {
    // Bounded foreground wait. A timeout leaves the exact durable command for
    // retry/reconciliation; it does not mean the remote operation was rejected.
    for (let n = 0; n < 60; n++) {
      const response = await outbox.result(commandId, deviceId);
      if (response !== null) return response;
      await wait(200);
    }
    fail('decision_transport_unavailable');
  }
  async function exchange(action, body) {
    if (!['create', 'read', 'cancel', 'acknowledge'].includes(action))
      fail('invalid_local_command', 400);
    const deviceId = await identity();
    if (community) return community[action]({ deviceId, branches: null }, body);
    return awaitReply(await outbox.enqueue(deviceId, action, body), deviceId);
  }
  async function deliverCommunityClaim(commandId, deviceId) {
    const leaseId = crypto.randomUUID();
    const command = await local.findOneAndUpdate(
      {
        _id: commandId,
        kind: 'command',
        protocolVersion: 1,
        deviceId,
        action: 'claim',
        $or: [{ state: 'queued' }, { state: 'sending', leaseUntil: { $lte: new Date(now()) } }],
      },
      {
        $set: { state: 'sending', leaseId, leaseUntil: new Date(now() + 45000) },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!command) return;
    const filter = { _id: commandId, state: 'sending', leaseId };
    try {
      const response = await community.claim({ deviceId, branches: null }, command.body);
      const startedAt = Date.parse(response.record.executionStartedAt);
      await local.updateOne(filter, {
        $set: {
          state: 'done',
          response,
          receivedAt: new Date(now()),
          ...(response.executionPermit === 'start'
            ? {
                startExpiresAt: new Date(Math.min(now() + 3000, startedAt + 5000)),
              }
            : {}),
        },
        $unset: { leaseUntil: '', leaseId: '', error: '' },
      });
    } catch (error) {
      const permanent = [400, 401, 403, 404, 409, 410, 422].includes(error.status);
      await local.updateOne(filter, {
        $set: {
          state: permanent ? 'failed' : 'queued',
          error: {
            code: error.code || 'decision_transport_unavailable',
            status: error.status || 503,
          },
        },
        $unset: { leaseUntil: '', leaseId: '' },
      });
      throw error;
    }
  }
  async function start(body, operationId) {
    const deviceId = await identity();
    const command = await outbox.claim(deviceId, body);
    if (community) await deliverCommunityClaim(command.commandId, deviceId);
    await awaitReply(command.commandId, deviceId);
    const proof = await outbox.consume(command.commandId, deviceId, {
      ...body,
      executionId: command.executionId,
      operationId,
    });
    return { proof, deviceId };
  }
  async function recover(body) {
    const deviceId = await identity();
    if (community) return community.acknowledge({ deviceId, branches: null }, body);
    return outbox.result(await outbox.enqueue(deviceId, 'acknowledge', body), deviceId);
  }
  async function lookup(source, operationId) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationId || '')) fail('invalid_discount_request', 400);
    const deviceId = await identity();
    let requestId;
    if (community) {
      const record = await db.collection('business_decisions').findOne(
        {
          deviceId,
          branchId: source.branchId,
          requesterId: source.requesterId,
          operationId,
        },
        { projection: { _id: 1 }, maxTimeMS: 250 }
      );
      requestId = record && String(record._id);
    } else {
      await require('./business-decision-local').ensureLocalDecisionIndexes(db);
      const command = await local.findOne(
        {
          kind: 'command',
          protocolVersion: 1,
          deviceId,
          action: 'create',
          'body.branchId': source.branchId,
          'body.requesterId': source.requesterId,
          'body.request.operationId': operationId,
        },
        { sort: { createdAt: -1 }, maxTimeMS: 250 }
      );
      if (command) requestId = (await outbox.result(command._id, deviceId))?.id;
    }
    if (!requestId) return null; // Unknown/pending is never proof that a bill failed.
    return exchange('read', { ...source, requestId });
  }
  async function recoveries(source, cursor) {
    if (
      !source ||
      !/^[a-f\d]{24}$/.test(source.branchId || '') ||
      !/^[a-f\d]{24}$/.test(source.requesterId || '') ||
      (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f\d]{64}$/.test(cursor)))
    )
      fail('invalid_recovery_cursor', 400);
    const deviceId = await identity();
    await require('./business-decision-local').ensureLocalDecisionIndexes(db);
    // Claims survive process restart and have no TTL. This is a list of
    // references to investigate, never proof of a sale or permission to retry.
    const rows = await local
      .find(
        {
          kind: 'command',
          protocolVersion: 1,
          action: 'claim',
          deviceId,
          'body.branchId': source.branchId,
          'body.requesterId': source.requesterId,
          executionState: { $ne: 'applied' },
          ...(cursor ? { _id: { $gt: cursor } } : {}),
        },
        { projection: { _id: 1, 'body.requestId': 1, createdAt: 1 } }
      )
      .sort({ _id: 1 })
      .limit(21)
      .maxTimeMS(250)
      .toArray();
    const page = rows.slice(0, 20);
    if (
      rows.some(
        (row) =>
          !/^[a-f\d]{64}$/.test(row._id || '') ||
          !/^[a-f\d]{24}$/.test(row.body?.requestId || '') ||
          !(row.createdAt instanceof Date) ||
          !Number.isFinite(row.createdAt.getTime())
      )
    )
      fail('decision_recovery_unavailable');
    return {
      references: page.map((row) => ({
        requestId: row.body.requestId,
        startedAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 20 ? page[page.length - 1]._id : null,
    };
  }
  return { exchange, start, recover, lookup, recoveries };
}
module.exports = { createCheckoutTransport, checkoutMode };
