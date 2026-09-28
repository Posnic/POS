'use strict';
const crypto = require('node:crypto');
const os = require('node:os');
const { ObjectId } = require('mongodb');
const { branchInfo } = require('./business-access');
const { isMultiTenant } = require('../db/tenant-context');

/** Community mode is opt-in, desktop-only and never advertises a Cloud-agent
 * runtime. The same HTTPS Business API reads these prepared local snapshots. */
function createLocalReportingBridge(db, { now = Date.now } = {}) {
  if (
    process.env.POSNIC_DESKTOP !== '1' ||
    process.env.POSNIC_BUSINESS_LOCAL_REPORTING !== '1' ||
    isMultiTenant()
  )
    throw Object.assign(new Error('desktop_required'), { code: 'desktop_required' });
  const local = db.collection('business_reporting_local');
  const owners = db.collection('business_reporting_publishers');
  let deviceId,
    indexed = false;
  async function identity() {
    if (!deviceId) {
      await local.updateOne(
        { _id: 'community-installation' },
        { $setOnInsert: { deviceId: 'community-' + crypto.randomUUID() } },
        { upsert: true }
      );
      deviceId = (await local.findOne({ _id: 'community-installation' })).deviceId;
    }
    return deviceId;
  }
  async function finish(row) {
    if (!row.pending) return;
    const pending = row.pending;
    try {
      await db.collection('business_prepared_summaries').replaceOne(
        {
          _id: row._id + ':' + pending.summary.businessDate,
          $or: [
            { publisherEpoch: { $lt: row.epoch } },
            { publisherEpoch: row.epoch, sequence: { $lte: pending.sequence } },
            { publisherEpoch: { $exists: false } },
          ],
        },
        {
          _id: row._id + ':' + pending.summary.businessDate,
          branch_id: new ObjectId(row._id),
          license: row.license,
          publisherDeviceId: row.deviceId,
          publisherAssignmentId: row.assignmentId,
          publisherEpoch: row.epoch,
          sequence: pending.sequence,
          receivedAt: pending.receivedAt,
          summary: pending.summary,
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    await owners.updateOne(
      { _id: row._id, assignmentId: row.assignmentId, 'pending.sequence': pending.sequence },
      { $unset: { pending: '' }, $set: { lastPublishedAt: pending.receivedAt } }
    );
  }
  return {
    async enqueue() {
      const id = await identity();
      if (!indexed) {
        await db
          .collection('business_reporting_candidates')
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        await db
          .collection('business_reporting_candidates')
          .createIndex({ branchId: 1, license: 1, expiresAt: 1 });
        indexed = true;
      }
      // Switching to Community mode must stop the Cloud agent from claiming
      // this installation. Existing ownership is never stolen in either mode.
      await local.deleteOne({ _id: 'desktop-runtime' });
      const requests = await db
        .collection('business_reporting_requests')
        .find({ expiresAt: { $gt: new Date(now()) } })
        .sort({ requestedAt: -1 })
        .limit(100)
        .maxTimeMS(250)
        .toArray();
      for (const request of requests) {
        if (!/^[a-f\d]{24}$/.test(request.branchId || '') || !ObjectId.isValid(request.license))
          continue;
        const branch = await db
          .collection('branches')
          .findOne({ _id: new ObjectId(request.branchId), license: request.license });
        if (!branch) continue;
        const info = branchInfo(branch);
        await db.collection('business_reporting_candidates').updateOne(
          { _id: request.branchId + ':' + id },
          {
            $set: {
              branchId: request.branchId,
              license: branch.license,
              deviceId: id,
              name: os.hostname().slice(0, 80),
              lastSeenAt: new Date(now()),
              expiresAt: new Date(now() + 3 * 60000),
            },
          },
          { upsert: true }
        );
        try {
          await owners.updateOne(
            { _id: request.branchId },
            {
              $setOnInsert: {
                license: branch.license,
                deviceId: id,
                assignmentId: crypto.randomBytes(32).toString('base64url'),
                epoch: 1,
                lastSequence: 0,
                createdAt: new Date(now()),
              },
            },
            { upsert: true }
          );
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
        const owner = await owners.findOne({
          _id: request.branchId,
          license: branch.license,
          deviceId: id,
        });
        if (!owner) continue;
        await finish(owner);
        const prior = await local.findOne({ _id: request._id });
        const update = {
          $set: {
            kind: 'job',
            includeItems: true,
            publisherMode: 'community',
            branchId: request.branchId,
            license: String(branch.license),
            businessDate: request.businessDate,
            currency: info.currency,
            timezone: info.timezone,
            requestedAt: request.requestedAt,
            expiresAt: request.expiresAt,
            assignmentId: owner.assignmentId,
            epoch: owner.epoch,
          },
        };
        if (prior && prior.assignmentId !== owner.assignmentId)
          update.$unset = {
            pendingSummary: '',
            publication: '',
            preparedAt: '',
            leaseId: '',
            leaseUntil: '',
          };
        await local.updateOne({ _id: request._id }, update, { upsert: true });
      }
    },
    async publish() {
      const id = await identity();
      const jobs = await local
        .find({
          kind: 'job',
          pendingSummary: { $exists: true },
          expiresAt: { $gt: new Date(now()) },
        })
        .limit(4)
        .toArray();
      for (const job of jobs) {
        const filter = { _id: job.branchId, deviceId: id, assignmentId: job.assignmentId };
        const owner = await owners.findOne(filter);
        if (!owner) continue;
        await finish(owner);
        const fresh = await owners.findOne(filter);
        if (
          !fresh ||
          !Number.isSafeInteger(fresh.lastSequence) ||
          fresh.lastSequence >= Number.MAX_SAFE_INTEGER
        )
          continue;
        const pending = {
          sequence: fresh.lastSequence + 1,
          summary: job.pendingSummary,
          receivedAt: new Date(now()),
        };
        const reserved = await owners.findOneAndUpdate(
          { ...filter, lastSequence: fresh.lastSequence, pending: { $exists: false } },
          { $set: { pending, lastSequence: pending.sequence } },
          { returnDocument: 'after' }
        );
        if (!reserved) continue;
        await finish(reserved);
        await local.updateOne(
          { _id: job._id, assignmentId: job.assignmentId, preparedAt: job.preparedAt },
          { $unset: { pendingSummary: '', error: '' }, $set: { lastPublishedAt: new Date(now()) } }
        );
      }
    },
  };
}
module.exports = { createLocalReportingBridge };
