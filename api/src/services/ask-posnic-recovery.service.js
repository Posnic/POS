'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const owner = require('./ask-posnic-execution-owner');
const budget = require('./ai-budget');

function scope(context) {
  if (!context?.licenseId || !context?.branchId)
    throw new Error('An explicit shop and outlet are required.');
  return { license: String(context.licenseId), branch_id: String(context.branchId) };
}
function id(value) {
  if (!/^[a-f0-9]{24}$/i.test(String(value))) throw new Error('Choose a valid record ID.');
  return new ObjectId(value);
}
function receipt(input, operator) {
  if (!operator || String(operator).trim().length < 3)
    throw new Error('Name the human operator responsible for the recovery.');
  if (
    !['completed', 'not_accepted'].includes(input?.outcome) ||
    !input.provider_reference ||
    !input.verified_at ||
    !Number.isFinite(new Date(input.verified_at).getTime()) ||
    new Date(input.verified_at) > new Date()
  )
    throw new Error('Supply a verified provider outcome, reference and verification time.');
  const tokens = [input.tokens_in ?? 0, input.tokens_out ?? 0];
  if (
    !tokens.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1e9) ||
    (input.outcome === 'not_accepted' && tokens.some(Boolean))
  )
    throw new Error('Provider token counts are invalid.');
  return {
    operator: String(operator).trim().slice(0, 120),
    outcome: input.outcome,
    provider_reference: String(input.provider_reference).slice(0, 200),
    verified_at: new Date(input.verified_at),
    at: new Date(),
    evidence_hash: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    tokens_in: tokens[0],
    tokens_out: tokens[1],
  };
}

async function pendingHolds(db, license, operation) {
  const rows = [];
  for (const collection of ['managed_ai_credits', 'ask_posnic_embedding_budget']) {
    for await (const account of db
      .collection(collection)
      .find({ license, holds: { $exists: true } })) {
      for (const [key, hold] of Object.entries(account.holds || {})) {
        if (
          ['released', 'reconciled'].includes(hold.status) ||
          (operation && hold.operation_id !== operation)
        )
          continue;
        rows.push({
          collection,
          account_id: String(account._id),
          id: key,
          month: account.month,
          branch_id: hold.branch_id || account.branch_id || '',
          model: hold.model || '',
          operation_id: hold.operation_id || '',
          state: hold.status || 'unsettled',
          created_at: hold.created_at || hold.at,
          execution_owner: hold.execution_owner,
        });
        if (rows.length === 100) return rows;
      }
    }
  }
  return rows;
}

async function inspect(db, context) {
  const wall = scope(context);
  const [actions, documents, schedules, holds] = await Promise.all([
    db
      .collection('ask_posnic_action_drafts')
      .find(
        { ...wall, status: { $in: ['executing', 'needs_review'] } },
        { projection: { type: 1, status: 1, user_id: 1, confirmed_at: 1, execution_owner: 1 } }
      )
      .limit(100)
      .toArray(),
    db
      .collection('ask_posnic_documents')
      .find(
        {
          ...wall,
          $or: [
            { 'semantic.state': { $in: ['processing', 'needs_review'] } },
            { 'own_semantic.state': { $in: ['processing', 'needs_review'] } },
          ],
        },
        {
          projection: {
            title: 1,
            'semantic.state': 1,
            'semantic.execution_owner': 1,
            'own_semantic.state': 1,
            'own_semantic.execution_owner': 1,
          },
        }
      )
      .limit(100)
      .toArray(),
    db
      .collection('ask_posnic_schedules')
      .find(
        { ...wall, $or: [{ running_at: { $exists: true } }, { last_status: 'needs_review' }] },
        {
          projection: {
            report: 1,
            last_status: 1,
            running_at: 1,
            execution_owner: 1,
            last_delivery: 1,
          },
        }
      )
      .limit(100)
      .toArray(),
    pendingHolds(db, wall.license),
  ]);
  for (const schedule of schedules) {
    schedule.connector_deliveries = await db
      .collection('whatsapp_outbox')
      .find(
        {
          'scheduled.id': String(schedule._id),
          'scheduled.license': wall.license,
          'scheduled.branch_id': wall.branch_id,
        },
        { projection: { status: 1, created_date: 1, sent_at: 1 } }
      )
      .sort({ created_date: -1 })
      .limit(5)
      .toArray();
  }
  return {
    actions,
    documents,
    schedules,
    holds: holds.filter((hold) => !hold.branch_id || hold.branch_id === wall.branch_id),
    limit_per_category: 100,
  };
}

async function recoverAction(db, context, value, options = {}) {
  const wall = scope(context),
    drafts = db.collection('ask_posnic_action_drafts');
  const draft = await drafts.findOne({ _id: id(value), ...wall, status: 'executing' });
  if (!draft) throw new Error('No executing action found in this outlet.');
  owner.requireStopped(draft.execution_owner, options.process);
  const refs = require('./ask-posnic-action-identity').records(draft),
    saved = [];
  for (const ref of refs) {
    const record = await db.collection(ref.collection).findOne(
      {
        _id: ref.id,
        license: id(wall.license),
        branch_id: id(wall.branch_id),
        ask_posnic_action_id: String(draft._id),
        ask_posnic_step: ref.step,
      },
      { projection: { _id: 1, po_id: 1, quote_id: 1 } }
    );
    if (record)
      saved.push({
        id: String(record._id),
        step: ref.step,
        ...(record.po_id ? { po_id: record.po_id } : {}),
        ...(record.quote_id ? { quote_id: record.quote_id } : {}),
      });
  }
  const status = saved.length === refs.length ? 'completed' : 'needs_review';
  const result = {
    id: String(draft._id),
    status,
    saved: saved.length,
    remaining: refs.length - saved.length,
    applied: options.apply === true,
  };
  if (!options.apply) return result;
  if (!options.operator) throw new Error('Name the human operator.');
  owner.requireStopped(draft.execution_owner, options.process);
  const update = await drafts.updateOne(
    {
      _id: draft._id,
      ...wall,
      status: 'executing',
      'execution_owner.instance': draft.execution_owner.instance,
    },
    {
      $set: {
        status,
        recovered_records: saved,
        recovery: {
          at: new Date(),
          operator: String(options.operator).slice(0, 120),
          worker_stopped: true,
          saved: saved.length,
        },
        ...(status === 'completed'
          ? { completed_at: new Date() }
          : {
              error:
                'Stopped worker recovered. Review saved records before preparing remaining work.',
            }),
      },
    }
  );
  if (update.modifiedCount !== 1)
    throw new Error('Action changed during recovery. Inspect it again.');
  return result;
}

async function resolveHold(db, context, value, input, options = {}) {
  const wall = scope(context),
    proof = receipt(input, options.operator);
  if (!/^[a-f0-9-]{36}$/.test(String(value))) throw new Error('Choose a valid reservation ID.');
  const name =
    options.engine === 'own_key'
      ? 'ask_posnic_embedding_budget'
      : options.engine === 'managed'
        ? 'managed_ai_credits'
        : null;
  if (!name) throw new Error('Choose managed or own_key.');
  const collection = db.collection(name),
    prefix = `holds.${value}`;
  const account = await collection.findOne({
    license: wall.license,
    ...(options.engine === 'own_key' ? { branch_id: wall.branch_id } : {}),
    [prefix]: { $exists: true },
  });
  const hold = account?.holds?.[value];
  if (!hold || ['released', 'reconciled'].includes(hold.status))
    throw new Error('No unresolved reservation found.');
  if (hold.branch_id && hold.branch_id !== wall.branch_id)
    throw new Error('Reservation belongs to a different outlet.');
  owner.requireStopped(hold.execution_owner, options.process);
  let actual = 0;
  if (proof.outcome === 'completed') {
    if (proof.tokens_in + proof.tokens_out < 1)
      throw new Error('Completed model calls require verified nonzero token usage.');
    if (!hold.unit_price || !(Number(hold.currency?.rate || hold.exchange_rate) > 0))
      throw new Error('Historical pricing is missing; do not guess its cost.');
    if (options.engine === 'own_key' && (proof.tokens_out || proof.tokens_in > 8192))
      throw new Error('Invalid embedding token count.');
    actual = budget.costMicrominor({
      model: hold.model,
      tokensIn: proof.tokens_in,
      tokensOut: proof.tokens_out,
      unitPrice: hold.unit_price,
      rate: hold.currency?.rate || hold.exchange_rate,
    });
    if (
      !Number.isSafeInteger(actual) ||
      actual < 0 ||
      (options.engine === 'own_key' && actual > hold.amount)
    )
      throw new Error('Usage exceeds the recorded embedding reservation.');
  }
  const result = {
    id: value,
    outcome: proof.outcome,
    actual_microminor: actual,
    applied: options.apply === true,
  };
  if (!options.apply) return result;
  owner.requireStopped(hold.execution_owner, options.process);
  const meterCost =
    proof.outcome === 'completed'
      ? budget.costMicrominor({
          model: hold.model,
          tokensIn: proof.tokens_in,
          tokensOut: proof.tokens_out,
          unitPrice: hold.unit_price,
          rate: hold.meter_currency?.rate || hold.currency?.rate || hold.exchange_rate,
        })
      : 0;
  proof.meter = {
    license: wall.license,
    branch_id: hold.branch_id || account.branch_id || wall.branch_id,
    month: budget.monthKey(new Date(hold.created_at || hold.at || proof.at)),
    feature: hold.feature || 'ask_posnic_own_key_embedding',
    last_model: hold.model,
    payer: options.engine === 'managed' ? 'posnic' : 'shop',
    currency: hold.meter_currency?.code || hold.currency?.code || account.currency || '',
    tokens_in: proof.tokens_in,
    tokens_out: proof.tokens_out,
    calls: proof.outcome === 'completed' ? 1 : 0,
    cost_minor: Math.floor(meterCost / 1e6),
    cost_microminor_adjustment: meterCost % 1e6,
    last_at: proof.at,
  };
  const match = {
    _id: account._id,
    license: wall.license,
    [`${prefix}.execution_owner.instance`]: hold.execution_owner.instance,
    ...(options.engine === 'managed'
      ? { [`${prefix}.status`]: { $in: ['reserved', 'uncertain'] } }
      : { [`${prefix}.amount`]: hold.amount }),
  };
  const update =
    options.engine === 'own_key'
      ? {
          $inc: { held: -hold.amount, count: -1, spent: actual },
          $unset: { [prefix]: '' },
          $set: { [`recoveries.${value}`]: { ...proof, actual_microminor: actual } },
        }
      : [
          {
            $set: {
              reserved_minor: { $subtract: ['$reserved_minor', hold.reserved_minor] },
              used_microminor: {
                $add: [
                  { $ifNull: ['$used_microminor', { $multiply: ['$used_minor', 1e6] }] },
                  actual,
                ],
              },
              [`${prefix}.status`]: proof.outcome === 'completed' ? 'reconciled' : 'released',
              [`${prefix}.actual_microminor`]: actual,
              [`${prefix}.recovery`]: { $literal: proof },
              updated_at: new Date(),
            },
          },
          { $set: { used_minor: { $ceil: { $divide: ['$used_microminor', 1e6] } } } },
        ];
  const changed = await collection.updateOne(match, update);
  if (changed.modifiedCount !== 1)
    throw new Error('Reservation changed during recovery. Inspect it again.');
  result.usage_projection_pending = false;
  try {
    await projectUsage(db, context, value, options);
  } catch (_error) {
    result.usage_projection_pending = true;
  }
  return result;
}

async function projectUsage(db, context, value, options = {}) {
  const wall = scope(context);
  if (!/^[a-f0-9-]{36}$/.test(String(value))) throw new Error('Choose a valid reservation ID.');
  const name =
    options.engine === 'own_key'
      ? 'ask_posnic_embedding_budget'
      : options.engine === 'managed'
        ? 'managed_ai_credits'
        : null;
  if (!name) throw new Error('Choose managed or own_key.');
  const path = options.engine === 'own_key' ? `recoveries.${value}` : `holds.${value}.recovery`;
  const account = await db
    .collection(name)
    .findOne({ license: wall.license, [`${path}.meter`]: { $exists: true } });
  // Managed finalized holds may already have been projected to the durable
  // reservation audit collection and pruned from the active allowance row.
  const archived =
    !account && options.engine === 'managed'
      ? await db
          .collection('managed_ai_reservations')
          .findOne({ _id: value, license: wall.license })
      : null;
  const proof =
    options.engine === 'own_key'
      ? account?.recoveries?.[value]
      : account?.holds?.[value]?.recovery || archived?.recovery;
  if (!proof?.meter || proof.meter.branch_id !== wall.branch_id)
    throw new Error('No recovered usage receipt exists in this outlet.');
  if (options.apply && !options.operator) throw new Error('Name the human operator.');
  const key = `ask-recovery:${crypto
    .createHash('sha256')
    .update(JSON.stringify([wall.license, wall.branch_id, name, value]))
    .digest('hex')}`;
  if (options.apply)
    await db
      .collection('ai_usage')
      .updateOne({ _id: key }, { $setOnInsert: proof.meter }, { upsert: true });
  return { id: value, applied: options.apply === true };
}

async function recoverIndex(db, context, value, options = {}) {
  const wall = scope(context),
    field =
      options.engine === 'own_key'
        ? 'own_semantic'
        : options.engine === 'managed'
          ? 'semantic'
          : null;
  if (!field) throw new Error('Choose managed or own_key.');
  const documents = db.collection('ask_posnic_documents');
  const doc = await documents.findOne({
    _id: id(value),
    ...wall,
    [`${field}.state`]: { $in: ['processing', 'needs_review'] },
  });
  if (!doc) throw new Error('No interrupted source found in this outlet.');
  const state = doc[field];
  owner.requireStopped(state.execution_owner, options.process);
  if (!state.operation) throw new Error('This source lacks a recorded operation identity.');
  if ((await pendingHolds(db, wall.license, state.operation)).length)
    throw new Error('Resolve the operation’s provider reservations before restarting indexing.');
  const cache =
    options.engine === 'own_key'
      ? await db
          .collection('ask_posnic_local_vectors')
          .find({
            license: wall.license,
            operation_id: state.operation,
            state: { $in: ['processing', 'needs_review'] },
          })
          .toArray()
      : [];
  for (const row of cache) owner.requireStopped(row.execution_owner, options.process);
  const result = {
    id: value,
    state: 'pending',
    incomplete_cache_entries: cache.length,
    new_embeddings_may_be_billed: true,
    applied: options.apply === true,
  };
  if (!options.apply) return result;
  if (!options.operator || options.rebuildMissing !== true)
    throw new Error(
      'Name the operator and explicitly allow new charges for missing embeddings. Existing vectors will be reused.'
    );
  owner.requireStopped(state.execution_owner, options.process);
  for (const row of cache)
    await db.collection('ask_posnic_local_vectors').updateOne(
      {
        _id: row._id,
        state: row.state,
        'execution_owner.instance': row.execution_owner.instance,
      },
      {
        $set: {
          state: 'retry',
          recovery: { operator: String(options.operator).slice(0, 120), at: new Date() },
        },
      }
    );
  const changed = await documents.updateOne(
    {
      _id: doc._id,
      ...wall,
      [`${field}.state`]: state.state,
      [`${field}.operation`]: state.operation,
      [`${field}.execution_owner.instance`]: state.execution_owner.instance,
    },
    {
      $set: {
        [`${field}.state`]: 'pending',
        [`${field}.recovery`]: {
          operator: String(options.operator).slice(0, 120),
          at: new Date(),
          worker_stopped: true,
        },
      },
      $unset: { [`${field}.claim`]: '', [`${field}.retry_at`]: '' },
    }
  );
  if (changed.modifiedCount !== 1)
    throw new Error('Source changed during recovery. Inspect it again.');
  return result;
}

async function recoverSchedule(db, context, value, input, options = {}) {
  const wall = scope(context),
    proof = receipt(input, options.operator);
  const schedules = db.collection('ask_posnic_schedules');
  const row = await schedules.findOne({
    _id: id(value),
    ...wall,
    $or: [{ running_at: { $exists: true } }, { last_status: 'needs_review' }],
  });
  if (!row) throw new Error('No interrupted delivery found in this outlet.');
  // A caught provider failure has already ended its execution. An abandoned
  // running claim needs independent proof that its process cannot resume.
  if (row.running_at) owner.requireStopped(row.execution_owner, options.process);
  const next = require('./ask-posnic-schedule.service').nextRun(row);
  const result = {
    id: value,
    state: 'reviewed',
    enabled: false,
    next_run_at: next,
    applied: options.apply === true,
  };
  if (!options.apply) return result;
  if (row.running_at) owner.requireStopped(row.execution_owner, options.process);
  const changed = await schedules.updateOne(
    {
      _id: row._id,
      ...wall,
      last_status: row.last_status,
      running_claim: row.running_claim || { $exists: false },
      running_at: row.running_at || { $exists: false },
    },
    {
      $set: {
        enabled: false,
        last_status: 'reviewed',
        last_error: null,
        next_run_at: next,
        recovery: proof,
      },
      $unset: { running_at: '', running_claim: '', delivering_at: '' },
    }
  );
  if (changed.modifiedCount !== 1)
    throw new Error('Delivery changed during review. Inspect it again.');
  return result;
}

module.exports = {
  inspect,
  recoverAction,
  resolveHold,
  recoverIndex,
  recoverSchedule,
  projectUsage,
  receipt,
  pendingHolds,
};
