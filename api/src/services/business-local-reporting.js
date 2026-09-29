'use strict';
const crypto = require('node:crypto');
const os = require('node:os');
const { ObjectId } = require('mongodb');
const { branchInfo } = require('./business-access');
const { isMultiTenant } = require('../db/tenant-context');
const { reportingJobKind, preparedSummaryKey } = require('./business-reporting-job');
const { registerCloseFact } = require('./business-register-close');

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
    const key = preparedSummaryKey(row._id, pending.summary);
    if (pending.summary.metricDefinitionVersion === 'register-session-v1') {
      const branch = await db
        .collection('branches')
        .findOne({ _id: new ObjectId(row._id), license: row.license }, { maxTimeMS: 250 });
      const source = await db.collection('cashregister').findOne(
        {
          _id: new ObjectId(pending.summary.close.sessionId),
          license: { $in: [row.license, String(row.license)] },
          branch_id: { $in: [new ObjectId(row._id), row._id] },
        },
        {
          projection: {
            _id: 1,
            license: 1,
            branch_id: 1,
            register_id: 1,
            register_name: 1,
            register_status: 1,
            register_opendate: 1,
            register_closedate: 1,
          },
          maxTimeMS: 250,
        }
      );
      let valid = false;
      if (branch) {
        try {
          const info = branchInfo(branch);
          const close = registerCloseFact(
            source,
            { ...info, license: String(row.license) },
            { now }
          );
          valid =
            close?.closeRevision === pending.summary.close.closeRevision &&
            close.businessDate === pending.summary.close.businessDate &&
            info.currency === pending.summary.currency &&
            info.currencyDigits === pending.summary.currencyDigits &&
            info.timezone === pending.summary.close.timezone;
        } catch {
          /* An invalid or reopened source cannot finish a reserved publication. */
        }
      }
      if (!valid) {
        await owners.updateOne(
          { _id: row._id, assignmentId: row.assignmentId, 'pending.sequence': pending.sequence },
          { $unset: { pending: '' }, $set: { lastPublicationError: 'close_changed' } }
        );
        return false;
      }
    }
    try {
      await db.collection('business_prepared_summaries').replaceOne(
        {
          _id: key,
          $or: [
            { publisherEpoch: { $lt: row.epoch } },
            { publisherEpoch: row.epoch, sequence: { $lte: pending.sequence } },
            { publisherEpoch: { $exists: false } },
          ],
        },
        {
          _id: key,
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
      {
        $unset: { pending: '', lastPublicationError: '' },
        $set: { lastPublishedAt: pending.receivedAt },
      }
    );
    return true;
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
        let summaryKind;
        try {
          summaryKind = reportingJobKind(request);
        } catch {
          continue;
        }
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
            summaryKind,
            includeItems: summaryKind === 'daily',
            ...(summaryKind === 'register-session'
              ? {
                  sessionId: request.sessionId,
                  closeRevision: request.closeRevision,
                  registerSummaryVersion: 1,
                }
              : {}),
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
        if (
          prior &&
          (prior.assignmentId !== owner.assignmentId ||
            (summaryKind === 'register-session' && prior.closeRevision !== request.closeRevision))
        )
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
        // Do not publish a stale staged result after the requested close changed.
        if (
          preparedSummaryKey(job.branchId, job.pendingSummary) !== job._id ||
          (job.summaryKind === 'register-session' &&
            job.pendingSummary.close.closeRevision !== job.closeRevision)
        )
          continue;
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
        const published = await finish(reserved);
        await local.updateOne(
          { _id: job._id, assignmentId: job.assignmentId, preparedAt: job.preparedAt },
          published
            ? {
                $unset: { pendingSummary: '', error: '' },
                $set: { lastPublishedAt: new Date(now()) },
              }
            : { $unset: { pendingSummary: '' }, $set: { error: 'close_changed' } }
        );
      }
    },
  };
}
module.exports = { createLocalReportingBridge };
