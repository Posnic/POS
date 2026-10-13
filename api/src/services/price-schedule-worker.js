'use strict';
const { runWithTenant } = require('../db/tenant-context');
const scope = require('./price-scope');
const service = require('./price-sheet');
const { ObjectId } = require('mongodb');
const { resolveAccess } = require('../utils/access-resolver');
// Match the controller's item.write policy, including unmigrated legacy roles,
// without loading HTTP controllers (which initialize repositories) at startup.
function canWriteItems(user) {
  if (!user) return false;
  const role = String(user.usertype || user.role || '').toLowerCase();
  const access = resolveAccess(user);
  if (['owner', 'admin', 'super_admin'].includes(role)) return true;
  if (['manager', 'store_manager'].includes(role) && !access.pos) return true;
  if (
    role === 'api' &&
    !Object.keys(access).some((k) => !['pos', 'pos_manager_approval', 'plan'].includes(k))
  )
    return true;
  return !!access.item?.write;
}
async function drain(db, { startup = false } = {}) {
  const now = new Date();
  const jobs = await db
    .collection('price_sheet_jobs')
    .find({
      scheduled: true,
      status: { $in: ['scheduled', 'running'] },
      effectiveAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
    })
    .sort({ effectiveAt: 1 })
    .limit(100)
    .toArray();
  for (const job of jobs) {
    try {
      const user = ObjectId.isValid(job.userId)
        ? await db
            .collection(job.apiToken ? 'api_tokens' : 'users')
            .findOne({ _id: new ObjectId(job.userId), license: job.license })
        : null;
      if (
        !user ||
        user.activate === false ||
        user.disabled ||
        user.isActive === false ||
        (job.apiToken && user.active !== true) ||
        !canWriteItems(user)
      )
        throw new Error('Price update creator no longer has permission');
      const c = await scope.context(user, job.branch_id, job.license);
      scope.assertJob(c, job);
      if (job.status === 'scheduled') {
        const claim = await db.collection('price_sheet_jobs').updateOne(
          {
            _id: job._id,
            status: 'scheduled',
            revision: job.revision ?? null,
            effectiveAt: job.effectiveAt,
          },
          { $set: { status: 'running' } }
        );
        if (!claim.modifiedCount) continue;
      }
      for (let batch = 0; batch < (startup ? 1000 : 10); batch++) {
        const result = await service.processBatch(c, job._id, job.skipInvalid === true);
        if (result.job.status !== 'running') break;
      }
    } catch (error) {
      // An active lease belongs to another runner; never mark its job failed.
      if (/processing|lease changed/.test(error.message)) continue;
      await db.collection('price_sheet_jobs').updateOne(
        {
          _id: job._id,
          status: { $in: ['scheduled', 'running'] },
          $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }],
        },
        { $set: { status: 'attention', lastError: error.message, failedAt: new Date() } }
      );
    }
  }
  return jobs.length;
}
function start({ tenants }) {
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const seen = new Set();
      for (const tenant of tenants()) {
        if (!tenant.db || tenant.suspended || seen.has(tenant.db.databaseName)) continue;
        seen.add(tenant.db.databaseName);
        try {
          await runWithTenant(tenant, () => drain(tenant.db));
        } catch (error) {
          console.error('[price schedules]', tenant.db.databaseName, error.message);
        }
      }
    } catch (error) {
      console.error('[price schedules]', error.message);
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
module.exports = { start, drain };
