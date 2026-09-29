'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { createBusinessAccess } = require('./business-access');
const { readRegisterSummary } = require('./business-register-reports');
const { deferQuiet } = require('./business-notification-time');
const { CLOSE_GRACE_MS, readRegisterClose } = require('./business-register-close');
const indexes = new WeakMap();
async function ready(db) {
  if (!indexes.has(db)) {
    const promise = Promise.all([
      db.collection('business_inbox').createIndex({ eventKey: 1 }, { unique: true }),
      db.collection('business_inbox').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db
        .collection('business_notification_preferences')
        .createIndex({ mode: 1, enabled: 1, closeScanAt: 1 }),
      db.collection('cashregister').createIndex({
        license: 1,
        branch_id: 1,
        register_status: 1,
        register_closedate: 1,
        _id: 1,
      }),
    ]).catch((error) => {
      indexes.delete(db);
      throw error;
    });
    indexes.set(db, promise);
  }
  await indexes.get(db);
}
/** Repeated bounded metadata sweeps catch delayed imports. A cursor is a scan
 * checkpoint, never evidence of notification delivery or financial completeness. */
async function prepareRegisterCloses(
  db,
  { now = Date.now, limit = 5, readSummary = readRegisterSummary } = {}
) {
  await ready(db);
  const preferences = db.collection('business_notification_preferences');
  const access = createBusinessAccess(db, { now });
  const started = now();
  let requested = 0;
  for (let n = 0; n < Math.min(5, Math.max(1, limit)); n++) {
    if (now() - started >= 3000) break;
    const at = new Date(now()),
      leaseId = crypto.randomUUID();
    const job = await preferences.findOneAndUpdate(
      {
        mode: 'register-close',
        scheduleVersion: 2,
        enabled: true,
        $and: [
          { $or: [{ closeScanAt: { $exists: false } }, { closeScanAt: { $lte: at } }] },
          { $or: [{ closeLeaseUntil: { $exists: false } }, { closeLeaseUntil: { $lte: at } }] },
        ],
      },
      { $set: { closeLeaseId: leaseId, closeLeaseUntil: new Date(now() + 30000) } },
      { sort: { closeScanAt: 1, _id: 1 }, returnDocument: 'after', maxTimeMS: 250 }
    );
    if (!job) break;
    const lease = {
      _id: job._id,
      revision: job.revision,
      closeLeaseId: leaseId,
      enabled: true,
      mode: 'register-close',
    };
    try {
      const user = await db
        .collection('users')
        .findOne({ _id: new ObjectId(job.accountId), license: job.license }, { maxTimeMS: 250 });
      const context = await access.contextFor(user);
      if (
        !context.capabilities.includes('overview.read') ||
        !context.capabilities.includes('notifications.self.manage') ||
        !context.branches.some((b) => b.id === job.branchId)
      )
        throw Object.assign(new Error('access_changed'), { status: 403 });
      if (!(job.closeNotBefore instanceof Date) || !Number.isFinite(job.closeNotBefore.getTime()))
        throw new Error('invalid_activation');
      const from = new Date(Math.max(job.closeNotBefore.getTime(), now() - 86400000));
      const query = {
        license: job.license,
        branch_id: new ObjectId(job.branchId),
        register_status: 'Closed',
        register_closedate: { $gte: from, $lte: new Date(now() - CLOSE_GRACE_MS) },
      };
      if (job.closeCursor?.at instanceof Date && ObjectId.isValid(job.closeCursor.id)) {
        query.$or = [
          { register_closedate: { $gt: job.closeCursor.at } },
          {
            register_closedate: job.closeCursor.at,
            _id: { $gt: new ObjectId(job.closeCursor.id) },
          },
        ];
      }
      const rows = await db
        .collection('cashregister')
        .find(query, { projection: { _id: 1, register_closedate: 1 } })
        .sort({ register_closedate: 1, _id: 1 })
        .limit(10)
        .maxTimeMS(250)
        .toArray();
      let cursor = job.closeCursor;
      for (const row of rows) {
        if (now() - started >= 3000) break;
        // A changed preference invalidates the claimed page before another request.
        if (!(await preferences.findOne(lease, { projection: { _id: 1 }, maxTimeMS: 250 }))) break;
        let summary = null,
          eligible = true;
        try {
          summary = await readSummary(
            db,
            context,
            { branchId: job.branchId, sessionId: String(row._id) },
            { now }
          );
          requested++;
        } catch (error) {
          if (error.code === 'summary_unavailable') requested++;
          else if (
            !['close_unavailable', 'close_grace_pending', 'date_out_of_range'].includes(error.code)
          )
            throw error;
          else eligible = false;
        }
        if (eligible) await materializeClose(db, job, lease, String(row._id), summary, { now });
        cursor = { at: row.register_closedate, id: String(row._id) };
        await preferences.updateOne(lease, { $set: { closeCursor: cursor } });
      }
      const exhausted =
        rows.length < 10 && (!rows.length || cursor?.id === String(rows.at(-1)._id));
      await preferences.updateOne(lease, {
        $set: { closeScanAt: new Date(now() + 60000) },
        $unset: {
          closeLeaseId: '',
          closeLeaseUntil: '',
          closeScanError: '',
          ...(exhausted ? { closeCursor: '' } : {}),
        },
      });
    } catch (error) {
      await preferences.updateOne(lease, {
        $set: {
          closeScanAt: new Date(now() + 60000),
          closeScanError: [401, 403].includes(error.status)
            ? 'access_changed'
            : 'preparation_unavailable',
          ...([401, 403].includes(error.status)
            ? { enabled: false, disabledReason: 'access_changed' }
            : {}),
        },
        $unset: { closeLeaseId: '', closeLeaseUntil: '' },
      });
    }
  }
  return { requested };
}
/** Persist an event before the scan checkpoint. Unique identity permits replay
 * after a crash; quiet periods are retried on the next bounded sweep. */
async function materializeClose(db, job, lease, sessionId, summary, { now = Date.now } = {}) {
  const user = await db
    .collection('users')
    .findOne({ _id: new ObjectId(job.accountId), license: job.license }, { maxTimeMS: 250 });
  const context = await createBusinessAccess(db, { now }).contextFor(user);
  const close = await readRegisterClose(db, context, job.branchId, sessionId, { now });
  if (
    !close ||
    Date.parse(close.closedAt) < job.closeNotBefore.getTime() ||
    now() - Date.parse(close.closedAt) > 86400000 ||
    now() < Date.parse(close.eligibleAt)
  )
    return;
  // Never attach a previously prepared amount to a changed source close.
  if (
    summary &&
    (summary.close?.closeRevision !== close.closeRevision ||
      summary.branchId !== job.branchId ||
      summary.businessId !== context.businessId)
  )
    return;
  // Allow twenty minutes after the sync grace for the assigned desktop to prepare.
  if (!summary && now() < Date.parse(close.eligibleAt) + 20 * 60000) return;
  const branch = context.branches.find((b) => b.id === job.branchId);
  const schedule = { time: job.time, quiet: job.quiet, timezone: branch.timezone };
  const at = new Date(now());
  if (deferQuiet(at, schedule) > at) return;
  if (
    !(await db
      .collection('business_notification_preferences')
      .findOne(lease, { projection: { _id: 1 }, maxTimeMS: 250 }))
  )
    return;
  const eventKey = [
    job.accountId,
    job.branchId,
    'register',
    job.revision,
    sessionId,
    close.closeRevision,
  ].join(':');
  await db.collection('business_inbox').updateOne(
    { eventKey },
    {
      $setOnInsert: {
        accountId: job.accountId,
        license: job.license,
        branchId: job.branchId,
        kind: summary ? 'register_summary' : 'register_unavailable',
        scheduleRevision: job.revision,
        sessionId,
        closeRevision: close.closeRevision,
        close,
        businessDate: close.businessDate,
        summary: summary ?? null,
        createdAt: at,
        expiresAt: new Date(now() + 90 * 86400000),
        locale: job.locale,
        channel: 'inApp',
        pushPending: false,
      },
    },
    { upsert: true }
  );
}
module.exports = { prepareRegisterCloses };
