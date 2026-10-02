'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const fingerprint = require('../utils/order-request-fingerprint');
const fail = (code, status = 409) => {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
};
const objectId = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('extension_scope_invalid', 403);
  return new ObjectId(String(value));
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value, max = 1024 * 1024) => {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('extension_plan_invalid', 422);
  }
  if (!serialized || Buffer.byteLength(serialized) > max) fail('extension_plan_too_large', 422);
  const copy = JSON.parse(serialized);
  const walk = (node, depth = 0) => {
    if (depth > 40) fail('extension_plan_too_deep', 422);
    if (node && typeof node === 'object')
      for (const [key, child] of Object.entries(node)) {
        if (
          ['__proto__', 'constructor', 'prototype'].includes(key) ||
          key.startsWith('$') ||
          key.includes('.')
        )
          fail('extension_plan_key_invalid', 422);
        walk(child, depth + 1);
      }
  };
  walk(copy);
  return copy;
};
function identity(scope, extensionId) {
  if (!/^[a-z][a-z0-9.-]{2,99}$/.test(extensionId || '')) fail('extension_id_invalid', 422);
  const license = objectId(scope?.license),
    branchId = objectId(scope?.branchId);
  return {
    _id: hash(`${license}:${branchId}:${extensionId}`),
    license,
    branch_id: branchId,
    extensionId,
  };
}
function authorize(descriptor, command, actor) {
  const required = descriptor.commands?.[command?.type];
  if (
    !Array.isArray(required) ||
    required.length === 0 ||
    required.some((permission) => !actor.permissions?.includes(permission))
  )
    fail('extension_command_forbidden', 403);
}
async function readNamespace(db, scope, descriptor, actor) {
  if (!actor.permissions?.includes('read')) fail('extension_read_forbidden', 403);
  const key = identity(scope, descriptor.id);
  const row = await db.collection('extension_namespaces').findOne(key);
  return {
    revision: row?.revision || 0,
    state: row?.data || json(descriptor.initialState),
    busy: Boolean(row?.pending),
    recoveryOperation: row?.pending?.operationId || null,
  };
}

/** Run one installed extension command through a durable single-writer lane.
 * No lease expiry: an interrupted request is resumed by its operation identity.
 * The plan and the original state are persisted before any host effect begins.
 * A plan carries at most one host effect, which must itself be durable and
 * all-or-compensate. The core executor is never supplied by an HTTP body.
 */
async function executeNamespace(db, scope, descriptor, actor, input, dependencies) {
  const key = identity(scope, descriptor.id),
    actorId = String(objectId(actor?.userId));
  const command = json(input?.command, 64 * 1024);
  authorize(descriptor, command, actor);
  if (
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(input?.requestKey || '') ||
    !Number.isSafeInteger(input?.expectedRevision) ||
    input.expectedRevision < 0
  )
    fail('extension_request_invalid', 422);
  const operationId = hash(`${key._id}:${input.requestKey}`);
  const digest = fingerprint({ actorId, command, expectedRevision: input.expectedRevision });
  const receipts = db.collection('extension_command_receipts');
  const namespaces = db.collection('extension_namespaces');
  const previous = await receipts.findOne({ _id: operationId });
  if (previous) {
    if (previous.digest !== digest) fail('extension_request_conflict');
    if (['completed', 'rejected'].includes(previous.status)) {
      await namespaces.updateOne(
        {
          ...key,
          'pending.operationId': operationId,
          'pending.digest': digest,
          'pending.phase': previous.status === 'completed' ? 'applied' : 'rejected',
        },
        { $unset: { pending: '' } }
      );
      if (previous.status === 'completed') return previous.result;
      fail(previous.failureCode);
    }
  }
  try {
    await namespaces.insertOne({ ...key, revision: 0, data: json(descriptor.initialState) });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  let row = await namespaces.findOne(key);
  if (row.lifecycle?.enabled === false) fail('extension_disabled', 403);
  if (row.pending && row.pending.operationId !== operationId)
    fail('extension_operation_in_progress');
  if (row.pending?.digest && row.pending.digest !== digest) fail('extension_request_conflict');
  if (!row.pending) {
    // Recheck the result after reading an unlocked lane: another identical
    // request may have committed while this request was waiting for MongoDB.
    const completed = await receipts.findOne({ _id: operationId });
    if (completed) {
      if (completed.digest !== digest) fail('extension_request_conflict');
      if (completed.status === 'completed') return completed.result;
      if (completed.status === 'rejected') fail(completed.failureCode);
    }
    if (row.revision !== input.expectedRevision) fail('extension_revision_conflict');
    const resources = descriptor.contextNeeds?.[command.type] || [];
    const selection =
      resources.length && descriptor.readContext
        ? json(await descriptor.readContext({ state: row.data, command }), 16 * 1024)
        : undefined;
    const prepared = dependencies.prepareContext
      ? await dependencies.prepareContext({
          db,
          scope,
          state: row.data,
          command,
          extensionId: descriptor.id,
          resources,
          selection,
        })
      : {};
    const plan = json(
      await descriptor.plan({
        state: row.data,
        revision: row.revision,
        command,
        actor: json(actor),
        operationId,
        context: json(prepared),
      })
    );
    if (
      !plan ||
      !Array.isArray(plan.effects) ||
      plan.effects.length > 1 ||
      !plan.state ||
      typeof plan.state !== 'object' ||
      Array.isArray(plan.state)
    )
      fail('extension_plan_invalid', 422);
    // Results deliberately contain references and booleans only. Basket and
    // receipt payloads must be read from current state, so deletion cannot be
    // undone by replaying an old successful command's result cache.
    if (
      !plan.result ||
      typeof plan.result !== 'object' ||
      Array.isArray(plan.result) ||
      Object.entries(plan.result).some(
        ([name, value]) =>
          !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) ||
          !(
            typeof value === 'boolean' ||
            (name.endsWith('Id') &&
              typeof value === 'string' &&
              /^[a-zA-Z0-9:_-]{1,160}$/.test(value))
          )
      )
    )
      fail('extension_result_invalid', 422);
    const sequence = (row.effectSequence || 0) + 1;
    if (!Number.isSafeInteger(sequence)) fail('extension_sequence_exhausted');
    const locked = await namespaces.updateOne(
      {
        ...key,
        revision: row.revision,
        pending: { $exists: false },
        'lifecycle.enabled': { $ne: false },
        'lifecycle.generation': row.lifecycle?.generation === undefined
          ? { $exists: false } : row.lifecycle.generation,
        effectSequence: row.effectSequence === undefined ? { $exists: false } : row.effectSequence,
      },
      {
        $set: {
          effectSequence: sequence,
          pending: {
            sequence,
            operationId,
            digest,
            phase: 'planned',
            actorId,
            permissions: actor.permissions.filter((permission) =>
              ['read', 'write', 'manage'].includes(permission)
            ),
            plan,
            requestKey: input.requestKey,
            expectedRevision: input.expectedRevision,
            command,
            extensionVersion: descriptor.version,
            startedAt: new Date(),
          },
        },
      }
    );
    row = await namespaces.findOne(key);
    if (locked.modifiedCount !== 1 && row.pending?.operationId !== operationId)
      fail('extension_operation_in_progress');
    if (row.pending?.digest !== digest) fail('extension_request_conflict');
  }
  if (row.pending.extensionVersion !== descriptor.version)
    fail('extension_recovery_version_mismatch');
  if (row.pending.phase === 'planned') {
    const effectResults = [];
    for (const effect of row.pending.plan.effects) {
      effectResults.push(
        await dependencies.executeEffect(
          {
            db,
            scope,
            actorId,
            permissions: row.pending.permissions || [],
            extensionId: descriptor.id,
            operationId,
            sequence: row.pending.sequence,
          },
          effect
        )
      );
    }
    if (effectResults.some((result) => result?.rejected === true)) {
      const failureCode = effectResults.find((result) => result?.rejected)?.failureCode;
      await namespaces.updateOne(
        { ...key, 'pending.operationId': operationId, 'pending.phase': 'planned' },
        {
          $set: {
            'pending.phase': 'rejected',
            'pending.failureCode':
              typeof failureCode === 'string' && /^extension_[a-z_]{1,100}$/.test(failureCode)
                ? failureCode
                : 'extension_effect_rejected',
          },
        }
      );
    } else {
      const nextState = descriptor.finalize
        ? json(await descriptor.finalize(row.pending.plan.state, effectResults))
        : row.pending.plan.state;
      await namespaces.updateOne(
        { ...key, 'pending.operationId': operationId, 'pending.phase': 'planned' },
        {
          $set: {
            data: nextState,
            revision: input.expectedRevision + 1,
            'pending.hostActions': row.pending.plan.effects.flatMap((effect, index) =>
              effect.kind === 'payment.cash' && effectResults[index]?.status === 'paid'
                ? [{ type: 'cash-sale-completed', saleId: effectResults[index].saleId }]
                : []
            ),
            'pending.phase': 'applied',
          },
        }
      );
    }
    row = await namespaces.findOne(key);
  }
  if (row.pending?.operationId === operationId && row.pending.phase === 'rejected') {
    await receipts.updateOne(
      { _id: operationId },
      {
        $setOnInsert: {
          digest,
          namespaceId: key._id,
          status: 'rejected',
          failureCode: row.pending.failureCode,
          completedAt: new Date(),
        },
      },
      { upsert: true }
    );
    await namespaces.updateOne(
      { ...key, 'pending.operationId': operationId, 'pending.phase': 'rejected' },
      { $unset: { pending: '' } }
    );
    fail(row.pending.failureCode);
  }
  if (row.pending?.operationId !== operationId || row.pending?.phase !== 'applied') {
    const completed = await receipts.findOne({ _id: operationId, digest, status: 'completed' });
    if (completed) return completed.result;
    fail('extension_recovery_required');
  }
  const result = { ...row.pending.plan.result, revision: input.expectedRevision + 1 };
  // Only trusted effects may request host hardware, never a worker result.
  delete result.hostActions;
  if (row.pending.hostActions?.length) result.hostActions = row.pending.hostActions;
  await receipts.updateOne(
    { _id: operationId },
    {
      $setOnInsert: {
        digest,
        namespaceId: key._id,
        status: 'completed',
        result,
        completedAt: new Date(),
      },
    },
    { upsert: true }
  );
  await namespaces.updateOne(
    { ...key, 'pending.operationId': operationId, 'pending.phase': 'applied' },
    {
      $unset: { pending: '' },
    }
  );
  return result;
}
async function recoverNamespace(db, scope, descriptor, actor, dependencies) {
  const row = await db.collection('extension_namespaces').findOne(identity(scope, descriptor.id));
  if (!row?.pending) return { recovered: false };
  if (String(actor?.userId) !== row.pending.actorId && !actor.permissions?.includes('manage'))
    fail('extension_recovery_forbidden', 403);
  // A manager resumes a persisted authorized plan; they cannot submit a new
  // command under another person's identity or alter its saved parameters.
  const replayActor = {
    userId: row.pending.actorId,
    permissions: descriptor.commands[row.pending.command.type] || [],
  };
  return executeNamespace(
    db,
    scope,
    descriptor,
    replayActor,
    {
      requestKey: row.pending.requestKey,
      expectedRevision: row.pending.expectedRevision,
      command: row.pending.command,
    },
    dependencies
  );
}
async function setEnabled(db, scope, descriptor, actor, enabled) {
  if (!actor.permissions?.includes('manage')) fail('extension_manage_required', 403);
  if (typeof enabled !== 'boolean') fail('extension_enabled_invalid', 422);
  const key = identity(scope, descriptor.id);
  const actorId = String(objectId(actor.userId));
  const collection = db.collection('extension_namespaces');
  try {
    await collection.insertOne({ ...key, revision: 0, data: json(descriptor.initialState) });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const row = await collection.findOne(key);
  if (row.pending) fail('extension_operation_in_progress');
  if ((row.lifecycle?.enabled !== false) === enabled)
    return { enabled, generation: row.lifecycle?.generation || 0 };
  const generation = (row.lifecycle?.generation || 0) + 1;
  if (!Number.isSafeInteger(generation)) fail('extension_lifecycle_sequence_exhausted');
  const changed = await collection.updateOne({
    ...key,
    pending: { $exists: false },
    'lifecycle.generation': row.lifecycle?.generation === undefined
      ? { $exists: false } : row.lifecycle.generation,
  }, { $set: { lifecycle: { enabled, generation, actorId, changedAt: new Date() } } });
  if (changed.modifiedCount !== 1) fail('extension_lifecycle_conflict');
  return { enabled, generation };
}
module.exports = { readNamespace, executeNamespace, recoverNamespace, setEnabled };
