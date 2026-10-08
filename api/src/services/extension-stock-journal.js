'use strict';
const { createHash } = require('node:crypto');
const { ObjectId } = require('mongodb');
const { applyStockEffect } = require('./extension-stock-effects');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const id = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('invalid_stock_scope');
  return String(new ObjectId(String(value)));
};

/** Durable all-or-compensate plan for host-authorized inventory operations.
 * Intermediate stock changes are visible to other tills; they cannot oversell.
 * Completion is published only after every item has durably decided its effect.
 * There are no expiring locks whose stale owner could write after a new owner.
 * Network errors leave the command recoverable rather than guessing a failure.
 */
async function runStockBatch(db, scope, command, options = {}) {
  const license = id(scope?.license),
    branchId = id(scope?.branchId),
    actorId = id(scope?.actorId);
  if (
    !/^[a-z0-9.-]{3,100}$/.test(command?.extensionId ?? '') ||
    !/^[a-zA-Z0-9:_-]{16,160}$/.test(command?.operationId ?? '') ||
    !Array.isArray(command?.lines) ||
    command.lines.length < 1 ||
    command.lines.length > 100
  )
    fail('invalid_stock_batch');
  const lines = command.lines
    .map((line) => {
      if (
        !Number.isSafeInteger(line?.quantityMilli) ||
        line.quantityMilli <= 0 ||
        line.quantityMilli > 1e12
      )
        fail('invalid_stock_quantity');
      return { itemId: id(line.itemId), quantityMilli: line.quantityMilli };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length) fail('duplicate_stock_item');
  const operationId = hash(`${license}:${branchId}:${command.extensionId}:${command.operationId}`);
  const digest = hash(
    JSON.stringify({ actorId, lines, ...(command.stream ? { stream: command.stream } : {}) })
  );
  const collection = db.collection('extension_stock_commands');
  try {
    await collection.insertOne({
      _id: operationId,
      license: new ObjectId(license),
      branch_id: new ObjectId(branchId),
      actorId,
      extensionId: command.extensionId,
      digest,
      lines,
      phase: 'applying',
      createdAt: new Date(),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  let journal = await collection.findOne({ _id: operationId });
  if (journal.digest !== digest) fail('stock_batch_conflict');
  if (journal.phase === 'cleared') fail('stock_batch_cleared');
  const effect = options.applyEffect || applyStockEffect;
  const apply = (line, index, reverse = false) =>
    effect(
      db,
      { license, branchId },
      {
        itemId: line.itemId,
        operationId: `${operationId}:${index}${reverse ? ':reverse' : ''}`,
        deltaMilli: line.quantityMilli * (reverse ? 1 : -1),
        ...(command.stream
          ? { stream: command.stream, ...(reverse ? { reverseOf: `${operationId}:${index}` } : {}) }
          : {}),
      }
    );
  if (journal.phase === 'applying') {
    const outcomes = [];
    for (let index = 0; index < lines.length; index++)
      outcomes.push(await apply(lines[index], index));
    const phase = outcomes.every((result) => result.applied) ? 'committed' : 'reversing';
    await collection.updateOne(
      { _id: operationId, phase: 'applying' },
      {
        $set: { phase, applied: outcomes.map((result) => result.applied), decidedAt: new Date() },
      }
    );
    journal = await collection.findOne({ _id: operationId });
  }
  if (journal.phase === 'reversing') {
    for (let index = 0; index < lines.length; index++) {
      if (journal.applied[index]) {
        const result = await apply(lines[index], index, true);
        if (!result.applied) fail('stock_compensation_incomplete');
      }
    }
    await collection.updateOne(
      { _id: operationId, phase: 'reversing' },
      {
        $set: { phase: 'rejected', completedAt: new Date() },
      }
    );
    journal = await collection.findOne({ _id: operationId });
  }
  return { operationId, status: journal.phase };
}

module.exports = { runStockBatch };
