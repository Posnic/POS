'use strict';
const { ObjectId } = require('mongodb');
const { isMultiTenant } = require('../db/tenant-context');
const { validateBatch: validateLocalBatch, digestOf } = require('./business-stock-alert-handoff');
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
function validateBatch(batch, branch, at) {
  validateLocalBatch(batch, { id: String(branch._id), license: String(branch.license) });
  if (batch.events.some((event) => Date.parse(event.preparedAt) > at + 300000))
    fail('invalid_stock_alert_event');
}
// Internal Community adapter only; no HTTP route accepts a caller-supplied
// installation identity. Match Gateway's reservation/receipt semantics.
async function receiveCommunityStockAlerts(db, device, body, { now = Date.now } = {}) {
  if (
    process.env.POSNIC_DESKTOP !== '1' ||
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1' ||
    isMultiTenant()
  )
    fail('desktop_required', 403);
  if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') fail('stock_alerts_disabled', 404);
  if (
    !exact(body, ['assignmentId', 'epoch', 'batch']) ||
    typeof body.assignmentId !== 'string' ||
    !/^[\w-]{43}$/.test(body.assignmentId) ||
    !Number.isSafeInteger(body.epoch) ||
    body.epoch < 1 ||
    !id(body.batch?.branchId)
  )
    fail('invalid_stock_alert_publication');
  if (
    !device?.deviceId ||
    (device.branches?.length &&
      !device.branches.some((value) => String(value) === body.batch.branchId))
  )
    fail('branch_access_denied', 403);
  const branch = await db
    .collection('branches')
    .findOne({ _id: new ObjectId(body.batch.branchId) }, { maxTimeMS: 250 });
  if (!branch || !ObjectId.isValid(branch.license)) fail('branch_access_denied', 403);
  const batch = structuredClone(body.batch);
  validateBatch(batch, branch, now());
  const owners = db.collection('business_reporting_publishers');
  const queue = db.collection('business_stock_alert_batches');
  const filter = {
    _id: batch.branchId,
    license: branch.license,
    deviceId: device.deviceId,
    assignmentId: body.assignmentId,
    epoch: body.epoch,
  };
  const digest = digestOf(batch);
  const recordKey =
    batch.license + ':' + batch.branchId + ':' + body.assignmentId + ':' + batch.batchId;
  const receipt = { schemaVersion: 1, batchId: batch.batchId, digest, accepted: true };
  function verifySaved(saved, expectedDigest) {
    if (
      !saved ||
      saved.digest !== expectedDigest ||
      digestOf(saved.batch) !== expectedDigest ||
      saved.publisherAssignmentId !== body.assignmentId ||
      saved.publisherEpoch !== body.epoch ||
      saved.publisherDeviceId !== device.deviceId ||
      String(saved.license) !== batch.license ||
      saved.branchId !== batch.branchId ||
      saved.state !== 'accepted'
    )
      fail('stock_alert_batch_conflict', 409);
  }
  async function current() {
    const owner = await owners.findOne(filter, { maxTimeMS: 250 });
    if (!owner) fail('publisher_not_assigned', 403);
    return owner;
  }
  async function flush(owner) {
    const pending = owner.pendingStockAlerts;
    if (!pending) return;
    if (
      pending.assignmentId !== owner.assignmentId ||
      pending.epoch !== owner.epoch ||
      pending.deviceId !== owner.deviceId
    ) {
      await owners.updateOne(
        { ...filter, 'pendingStockAlerts.batch.batchId': pending.batch?.batchId },
        {
          $unset: { pendingStockAlerts: '' },
          $set: { lastStockAlertError: 'obsolete_stock_alert_reservation' },
        },
        { maxTimeMS: 500 }
      );
      return;
    }
    validateBatch(pending.batch, branch, now());
    if (
      pending.digest !== digestOf(pending.batch) ||
      !(pending.receivedAt instanceof Date) ||
      !Number.isFinite(pending.receivedAt.getTime())
    )
      fail('invalid_stock_alert_reservation', 409);
    const key =
      batch.license + ':' + batch.branchId + ':' + owner.assignmentId + ':' + pending.batch.batchId;
    await queue.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          license: branch.license,
          branchId: batch.branchId,
          publisherDeviceId: owner.deviceId,
          publisherAssignmentId: owner.assignmentId,
          publisherEpoch: owner.epoch,
          batch: pending.batch,
          digest: pending.digest,
          receivedAt: pending.receivedAt,
          expiredEventIds: pending.batch.events
            .filter(
              (event) => pending.receivedAt.getTime() - Date.parse(event.preparedAt) > 86400000
            )
            .map((event) => event.eventId),
          state: 'accepted',
        },
      },
      { upsert: true, maxTimeMS: 500 }
    );
    const saved = await queue.findOne({ _id: key }, { maxTimeMS: 250 });
    verifySaved(saved, pending.digest);
    await owners.updateOne(
      {
        ...filter,
        'pendingStockAlerts.batch.batchId': pending.batch.batchId,
        'pendingStockAlerts.digest': pending.digest,
      },
      { $unset: { pendingStockAlerts: '', lastStockAlertError: '' } },
      { maxTimeMS: 500 }
    );
  }
  let owner = await current();
  await flush(owner);
  owner = await current();
  const existing = await queue.findOne({ _id: recordKey }, { maxTimeMS: 250 });
  if (existing) {
    verifySaved(existing, digest);
    return receipt;
  }
  const reserved = await owners.findOneAndUpdate(
    { ...filter, pendingStockAlerts: { $exists: false } },
    {
      $set: {
        pendingStockAlerts: {
          assignmentId: owner.assignmentId,
          deviceId: owner.deviceId,
          epoch: owner.epoch,
          batch,
          digest,
          receivedAt: new Date(now()),
        },
      },
    },
    { returnDocument: 'after', maxTimeMS: 500 }
  );
  if (!reserved) fail('stock_alert_publication_busy', 409);
  await flush(reserved);
  await current();
  return receipt;
}
module.exports = { receiveCommunityStockAlerts };
