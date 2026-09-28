'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { createBusinessAccess } = require('./business-access');
const { nextDaily, validateSchedule, deferQuiet } = require('./business-notification-time');
const { readBusinessOverview } = require('./business-reports');
const languages = new Set('en ta hi ml kn te si ne ar fr es pt id th de sw nl it'.split(' '));
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const indexPromises = new WeakMap();
async function ready(db) {
  if (!indexPromises.has(db)) {
    const promise = Promise.all([
      db.collection('business_notification_preferences').createIndex({ enabled: 1, nextRunAt: 1 }),
      db.collection('business_inbox').createIndex({ accountId: 1, license: 1, _id: -1 }),
      db.collection('business_inbox').createIndex({ eventKey: 1 }, { unique: true }),
      db.collection('business_inbox').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexPromises.delete(db);
      throw error;
    });
    indexPromises.set(db, promise);
  }
  await indexPromises.get(db);
}
function branchFor(context, branchId) {
  const branch = context.branches.find((branch) => branch.id === branchId);
  if (
    !branch ||
    !context.capabilities.includes('notifications.self.manage') ||
    !context.capabilities.includes('overview.read')
  )
    fail('access_denied', 403);
  return branch;
}
const key = (context, branchId) => context.accountId + ':' + branchId;
const defaultQuiet = () => ({ enabled: false, start: '22:00', end: '07:00' });
function publicPreference(branch, row) {
  return {
    branchId: branch.id,
    timezone: branch.timezone,
    revision: row?.revision ?? 0,
    enabled: row?.enabled ?? false,
    time: row?.time ?? '23:00',
    quiet: row?.quiet ?? defaultQuiet(),
    locale: row?.locale ?? 'en',
              channel: 'inApp',
              pushPending: true,
    nextSendAt: row?.enabled ? row.nextRunAt.toISOString() : null,
  };
}
async function getPreference(db, context, branchId) {
  const branch = branchFor(context, branchId);
  const row = await db
    .collection('business_notification_preferences')
    .findOne({ _id: key(context, branchId), license: new ObjectId(context.businessId) });
  return publicPreference(branch, row);
}
async function savePreference(db, context, branchId, input, { now = Date.now } = {}) {
  const branch = branchFor(context, branchId);
  if (
    !input ||
    Object.keys(input).sort().join(',') !== 'enabled,expectedRevision,locale,quiet,time' ||
    typeof input.enabled !== 'boolean' ||
    !languages.has(input.locale) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    !input.quiet ||
    Object.keys(input.quiet).sort().join(',') !== 'enabled,end,start'
  )
    fail('invalid_preference');
  const schedule = { time: input.time, quiet: input.quiet, timezone: branch.timezone };
  try {
    validateSchedule(schedule);
  } catch {
    fail('invalid_preference');
  }
  await ready(db);
  const planned = nextDaily(schedule, new Date(now())),
    license = new ObjectId(context.businessId);
  let row;
  try {
    row = await db.collection('business_notification_preferences').findOneAndUpdate(
      {
        _id: key(context, branchId),
        ...(input.expectedRevision
          ? { license, revision: input.expectedRevision }
          : { revision: { $exists: false } }),
      },
      {
        $set: {
          license,
          accountId: context.accountId,
          branchId,
          enabled: input.enabled,
          time: input.time,
          quiet: input.quiet,
          locale: input.locale,
          timezone: branch.timezone,
          revision: input.expectedRevision + 1,
          nextRunAt: planned.deliverAt,
          businessDate: planned.businessDate,
          scheduledAt: planned.scheduledAt,
          updatedAt: new Date(now()),
        },
        $unset: { leaseId: '', leaseUntil: '' },
      },
      { upsert: input.expectedRevision === 0, returnDocument: 'after' }
    );
  } catch (error) {
    if (error.code === 11000) fail('preference_changed', 409);
    throw error;
  }
  if (!row) fail('preference_changed', 409);
  return publicPreference(branch, row);
}
async function listInbox(db, context, { before, now = Date.now } = {}) {
  if (!context.capabilities.includes('overview.read')) return { entries: [], next: null };
  if (before !== undefined && (typeof before !== 'string' || !/^[a-f\d]{24}$/.test(before)))
    fail('invalid_cursor');
  await ready(db);
  const rows = await db
    .collection('business_inbox')
    .find({
      accountId: context.accountId,
      license: new ObjectId(context.businessId),
      branchId: { $in: context.branches.map((branch) => branch.id) },
      expiresAt: { $gt: new Date(now()) },
      ...(before ? { _id: { $lt: new ObjectId(before) } } : {}),
    })
    .sort({ _id: -1 })
    .limit(51)
    .maxTimeMS(250)
    .toArray();
  return {
    entries: rows.slice(0, 50).map((row) => ({
      id: String(row._id),
      branchId: row.branchId,
      kind: row.kind,
      businessDate: row.businessDate,
      createdAt: row.createdAt.toISOString(),
      read: !!row.readAt,
      summary: row.summary ?? null,
    })),
    next: rows.length > 50 ? String(rows[49]._id) : null,
  };
}
async function markRead(db, context, id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id)) fail('invalid_request');
  if (!context.capabilities.includes('overview.read')) fail('access_denied', 403);
  const result = await db.collection('business_inbox').updateOne(
    {
      _id: new ObjectId(id),
      accountId: context.accountId,
      license: new ObjectId(context.businessId),
      branchId: { $in: context.branches.map((branch) => branch.id) },
    },
    { $set: { readAt: new Date() } }
  );
  if (!result.matchedCount) fail('entry_unavailable', 404);
  return { read: true };
}
async function drainDue(
  db,
  { now = Date.now, limit = 25, readSummary = readBusinessOverview } = {}
) {
  await ready(db);
  // Separate unique event identity makes a crash after insertion safe to retry.
  const preferences = db.collection('business_notification_preferences'),
    access = createBusinessAccess(db, { now });
  const started = now();
  let processed = 0;
  for (let index = 0; index < Math.min(25, Math.max(1, limit)); index++) {
    if (now() - started > 3000) break;
    const at = new Date(now()),
      leaseId = crypto.randomUUID();
    const job = await preferences.findOneAndUpdate(
      {
        enabled: true,
        nextRunAt: { $lte: at },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: at } }],
      },
      { $set: { leaseId, leaseUntil: new Date(now() + 30000) } },
      { sort: { nextRunAt: 1 }, returnDocument: 'after', maxTimeMS: 1000 }
    );
    if (!job) break;
    const lease = { _id: job._id, revision: job.revision, leaseId };
    try {
      const user = await db
        .collection('users')
        .findOne({ _id: new ObjectId(job.accountId), license: job.license });
      let context;
      try {
        context = await access.contextFor(user);
        branchFor(context, job.branchId);
      } catch (error) {
        // A temporary database failure must not silently unsubscribe the owner.
        if (![401, 403].includes(error.status)) throw error;
        await preferences.updateOne(lease, {
          $set: { enabled: false, disabledReason: 'access_changed' },
          $unset: { leaseId: '', leaseUntil: '' },
        });
        continue;
      }
      const branch = context.branches.find((branch) => branch.id === job.branchId);
      const schedule = { time: job.time, quiet: job.quiet, timezone: branch.timezone };
      const next = nextDaily(schedule, at);
      if (job.timezone !== branch.timezone || now() - job.nextRunAt.getTime() > 86400000) {
        await preferences.updateOne(lease, {
          $set: {
            timezone: branch.timezone,
            nextRunAt: next.deliverAt,
            scheduledAt: next.scheduledAt,
            businessDate: next.businessDate,
            lastSkippedAt: at,
          },
          $unset: { leaseId: '', leaseUntil: '' },
        });
        continue;
      }
      const quietUntil = deferQuiet(at, schedule);
      if (quietUntil > at) {
        await preferences.updateOne(lease, {
          $set: { nextRunAt: quietUntil },
          $unset: { leaseId: '', leaseUntil: '' },
        });
        continue;
      }
      let summary = null;
      try {
        summary = await readSummary(
          db,
          context,
          { branchId: job.branchId, businessDate: job.businessDate },
          { now }
        );
      } catch (error) {
        if (error.code !== 'summary_unavailable') throw error;
      }
      if (!(await preferences.findOne({ ...lease, enabled: true }))) continue;
      const eventKey = key(context, job.branchId) + ':daily:' + job.businessDate;
      await db.collection('business_inbox').updateOne(
        { eventKey },
        {
          $setOnInsert: {
            accountId: context.accountId,
            license: job.license,
            branchId: job.branchId,
            kind: summary ? 'daily_summary' : 'daily_unavailable',
            businessDate: job.businessDate,
            summary,
            createdAt: at,
            expiresAt: new Date(now() + 90 * 86400000),
            locale: job.locale,
            channel: 'inApp',
          },
        },
        { upsert: true }
      );
      await preferences.updateOne(lease, {
        $set: {
          nextRunAt: next.deliverAt,
          scheduledAt: next.scheduledAt,
          businessDate: next.businessDate,
          lastDeliveredAt: at,
        },
        $unset: { leaseId: '', leaseUntil: '' },
      });
      processed++;
    } catch {
      await preferences
        .updateOne(lease, {
          $set: { leaseUntil: new Date(now() + 60000), error: 'delivery_unavailable' },
        })
        .catch(() => {});
    }
  }
  return { processed };
}
async function prepareUpcoming(db, { now = Date.now, readSummary = readBusinessOverview } = {}) {
  await ready(db);
  const at = new Date(now()),
    preferences = db.collection('business_notification_preferences');
  const jobs = await preferences
    .find({
      enabled: true,
      nextRunAt: { $gt: at, $lte: new Date(now() + 10 * 60000) },
      $or: [
        { preparationRequestedAt: { $exists: false } },
        { preparationRequestedAt: { $lt: new Date(now() - 5 * 60000) } },
      ],
    })
    .sort({ nextRunAt: 1 })
    .limit(5)
    .maxTimeMS(250)
    .toArray();
  const access = createBusinessAccess(db, { now });
  for (const job of jobs) {
    const claimed = await preferences.updateOne(
      {
        _id: job._id,
        enabled: true,
        revision: job.revision,
        preparationRequestedAt: job.preparationRequestedAt ?? { $exists: false },
      },
      { $set: { preparationRequestedAt: at } }
    );
    if (!claimed.modifiedCount) continue;
    try {
      const user = await db
        .collection('users')
        .findOne({ _id: new ObjectId(job.accountId), license: job.license });
      const context = await access.contextFor(user);
      branchFor(context, job.branchId);
      // This only signals the desktop and reads prepared data. No cloud sale scan.
      await readSummary(
        db,
        context,
        { branchId: job.branchId, businessDate: job.businessDate },
        { now }
      );
    } catch {
      /* A missing summary is expected until the desktop publishes it. */
    }
  }
}
module.exports = { getPreference, savePreference, listInbox, markRead, drainDue, prepareUpcoming };
