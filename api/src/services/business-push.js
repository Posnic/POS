'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { createBusinessAccess, hash } = require('./business-access');
const { createExpoTransport, tokenPattern } = require('./business-push-transport');
const { deferQuiet } = require('./business-notification-time');
const indexes = new WeakMap();
const pushMessages = require('./business-push-messages.json');
const supportedLanguages = Object.freeze(Object.keys(pushMessages));
function configuration() {
  const projectId = process.env.POSNIC_BUSINESS_EXPO_PROJECT_ID;
  const accessToken = process.env.POSNIC_BUSINESS_EXPO_ACCESS_TOKEN;
  const enabled =
    process.env.POSNIC_BUSINESS_PUSH_ENABLED === '1' &&
    /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(projectId || '') &&
    !!accessToken;
  return { enabled, projectId: enabled ? projectId : null, accessToken };
}
function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}
async function ready(db) {
  if (!indexes.has(db))
    indexes.set(
      db,
      Promise.all([
        db.collection('business_push_devices').createIndex({ sessionId: 1 }, { unique: true }),
        db
          .collection('business_push_devices')
          .createIndex({ accountId: 1, license: 1, expiresAt: 1 }),
        db
          .collection('business_push_devices')
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('business_push_deliveries').createIndex({ state: 1, nextAttemptAt: 1 }),
        db
          .collection('business_push_deliveries')
          .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('business_inbox').createIndex({ pushPending: 1, createdAt: 1 }),
      ]).catch((error) => {
        indexes.delete(db);
        throw error;
      })
    );
  await indexes.get(db);
}
async function deviceStatus(
  db,
  identity,
  { config = configuration(), includeLanguages = false } = {}
) {
  const row = await db.collection('business_push_devices').findOne({
    sessionId: identity.session._id,
    accountId: String(identity.user._id),
    license: identity.user.license,
  });
  return {
    available: config.enabled,
    projectId: config.projectId,
    enabled: config.enabled && !!row,
    ...(includeLanguages
      ? { supportedLanguages, locale: supportedLanguages.includes(row?.locale) ? row.locale : 'en' }
      : {}),
  };
}
async function registerDevice(
  db,
  identity,
  input,
  { config = configuration(), now = Date.now } = {}
) {
  if (!config.enabled) fail('push_unavailable', 503);
  if (
    !input ||
    !['platform,projectId,token', 'locale,platform,projectId,token'].includes(
      Object.keys(input).sort().join(',')
    ) ||
    (Object.hasOwn(input, 'locale') &&
      (typeof input.locale !== 'string' || !supportedLanguages.includes(input.locale))) ||
    !['android', 'ios'].includes(input.platform) ||
    input.projectId !== config.projectId ||
    typeof input.token !== 'string' ||
    !tokenPattern.test(input.token)
  )
    fail('invalid_request');
  await ready(db);
  const devices = db.collection('business_push_devices'),
    id = hash(input.token),
    sessionId = identity.session._id,
    accountId = String(identity.user._id),
    license = identity.user.license;
  const previous = await devices.findOne({ _id: id });
  if (previous && previous.accountId !== accountId) fail('device_already_registered', 409);
  // A rotated provider token replaces only this authenticated Business session.
  await devices.deleteMany({ sessionId, _id: { $ne: id }, accountId, license });
  try {
    await devices.updateOne(
      { _id: id, accountId, license },
      {
        $set: {
          sessionId,
          token: input.token,
          platform: input.platform,
          locale:
            input.locale || (previous?.sessionId === sessionId ? previous.locale : null) || 'en',
          projectId: input.projectId,
          generation: previous?.sessionId === sessionId ? previous.generation : crypto.randomUUID(),
          expiresAt: identity.session.expiresAt,
          registeredAt: previous?.sessionId === sessionId ? previous.registeredAt : new Date(now()),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code === 11000) fail('device_changed', 409);
    throw error;
  }
  return { enabled: true };
}
async function unregisterDevice(db, identity) {
  await db.collection('business_push_devices').deleteMany({
    sessionId: identity.session._id,
    accountId: String(identity.user._id),
    license: identity.user.license,
  });
  return { enabled: false };
}
async function currentScope(db, accountId, license, branchId, now, event = {}) {
  if (event.kind === 'stock_low') {
    const state = await require('./business-stock-recipient').recipientState(
      db,
      {
        accountId,
        businessId: String(license),
        branchId,
      },
      now,
      { observeOnly: true }
    );
    if (
      state.status !== 'eligible' ||
      event.readAt ||
      !(
        await require('./business-stock-inbox').visibleStockEvents(db, state.context, [event], now)
      ).has(String(event._id))
    )
      fail('access_denied', 403);
    return { ...state, preference: { ...state.preference, time: '23:00' } };
  }
  if (['register_summary', 'register_unavailable'].includes(event.kind))
    return require('./business-register-notifications').registerPushScope(
      db,
      accountId,
      license,
      branchId,
      event,
      now
    );
  if (event.kind === 'approval_requested')
    return require('./business-approval-notifications').approvalAlertScope(
      db,
      accountId,
      license,
      branchId,
      event.requestId,
      now
    );
  if (event.kind && !['daily_summary', 'daily_unavailable'].includes(event.kind))
    fail('access_denied', 403);
  const access = createBusinessAccess(db, { now });
  const user = await db.collection('users').findOne({ _id: new ObjectId(accountId), license });
  const context = await access.contextFor(user);
  if (
    !context.capabilities.includes('overview.read') ||
    !context.branches.some((branch) => branch.id === branchId)
  )
    fail('access_denied', 403);
  const preference = await db.collection('business_notification_preferences').findOne({
    _id: accountId + ':' + branchId,
    license,
    enabled: true,
    mode: { $ne: 'register-close' },
  });
  if (!preference) fail('access_denied', 403);
  const branch = context.branches.find((branch) => branch.id === branchId);
  return { context, preference, branch };
}
async function drainPush(
  db,
  {
    config = configuration(),
    transport = createExpoTransport({ accessToken: config.accessToken }),
    now = Date.now,
    stockPageLimit = 10,
  } = {}
) {
  if (!config.enabled) return;
  if (!Number.isInteger(stockPageLimit) || stockPageLimit < 1 || stockPageLimit > 10)
    fail('invalid_stock_push_budget');
  await ready(db);
  const inbox = db.collection('business_inbox'),
    devices = db.collection('business_push_devices'),
    deliveries = db.collection('business_push_deliveries');
  const at = new Date(now()),
    leaseUntil = new Date(now() + 30000);
  // Materialization can replay after a crash: every event/device pair has one row.
  for (let i = 0; i < 5; i++) {
    const leaseId = crypto.randomUUID();
    const event = await inbox.findOneAndUpdate(
      {
        pushPending: true,
        createdAt: { $gt: new Date(now() - 3600000) },
        $or: [{ pushLeaseUntil: { $exists: false } }, { pushLeaseUntil: { $lt: at } }],
      },
      { $set: { pushLeaseId: leaseId, pushLeaseUntil: leaseUntil } },
      { sort: { createdAt: 1 }, returnDocument: 'after', maxTimeMS: 1000 }
    );
    if (!event) break;
    try {
      if (now() - event.createdAt.getTime() < 3600000) {
        await currentScope(db, event.accountId, event.license, event.branchId, now, event);
        const recipients = await devices
          .find({
            accountId: event.accountId,
            license: event.license,
            projectId: config.projectId,
            expiresAt: { $gt: at },
            registeredAt: { $lte: event.createdAt },
          })
          .limit(100)
          .maxTimeMS(250)
          .toArray();
        for (const device of recipients)
          await deliveries.updateOne(
            { _id: String(event._id) + ':' + device._id },
            {
              $setOnInsert: {
                eventId: String(event._id),
                deviceId: device._id,
                sessionId: device.sessionId,
                deviceGeneration: device.generation,
                accountId: event.accountId,
                license: event.license,
                branchId: event.branchId,
                kind: event.kind,
                requestId: event.requestId ?? null,
                state: 'pending',
                attempts: 0,
                nextAttemptAt: at,
                staleAt: new Date(
                  Math.min(
                    event.createdAt.getTime() + 3600000,
                    event.kind === 'approval_requested' ? event.expiresAt.getTime() : Infinity
                  )
                ),
                expiresAt: new Date(now() + 7 * 86400000),
              },
            },
            { upsert: true }
          );
      }
      await inbox.updateOne(
        { _id: event._id, pushLeaseId: leaseId },
        { $set: { pushPending: false }, $unset: { pushLeaseId: '', pushLeaseUntil: '' } }
      );
    } catch (error) {
      if ([401, 403].includes(error.status))
        await inbox.updateOne(
          { _id: event._id, pushLeaseId: leaseId },
          { $set: { pushPending: false }, $unset: { pushLeaseId: '', pushLeaseUntil: '' } }
        );
    }
  }
  for (let i = 0; i < 2; i++) {
    const at = new Date(now()),
      leaseUntil = new Date(now() + 30000),
      leaseId = crypto.randomUUID();
    const job = await deliveries.findOneAndUpdate(
      {
        state: { $in: ['pending', 'receipt'] },
        nextAttemptAt: { $lte: at },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: at } }],
      },
      { $set: { leaseId, leaseUntil } },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after', maxTimeMS: 1000 }
    );
    if (!job) break;
    const lease = () => ({ _id: job._id, leaseId, leaseUntil: { $gt: new Date(now()) } });
    try {
      if (job.state === 'receipt') {
        const result = await transport.receipt(job.ticketId);
        const expired = now() - job.acceptedAt.getTime() > 23 * 3600000;
        await deliveries.updateOne(lease(), {
          $set: {
            state: result || (expired ? 'receipt_unavailable' : 'receipt'),
            nextAttemptAt: new Date(now() + 15 * 60000),
          },
          $unset: { leaseId: '', leaseUntil: '' },
        });
        continue;
      }
      if (job.staleAt <= at) fail('push_expired', 410);
      const device = await devices.findOne({
        _id: job.deviceId,
        sessionId: job.sessionId,
        accountId: job.accountId,
        license: job.license,
        expiresAt: { $gt: at },
        projectId: config.projectId,
        generation: job.deviceGeneration,
      });
      if (!device) fail('access_denied', 403);
      const identity = await createBusinessAccess(db, { now }).sessionIdentity(device.sessionId);
      if (
        String(identity.user._id) !== job.accountId ||
        String(identity.user.license) !== String(job.license)
      )
        fail('access_denied', 403);
      let scope, stockValidationCursor;
      if (job.kind === 'stock_low') {
        let result,
          cursor = job.stockCursor;
        const started = now();
        for (let page = 0; page < Math.min(10, Math.max(1, stockPageLimit)); page++) {
          if (!(await deliveries.findOne(lease(), { projection: { _id: 1 }, maxTimeMS: 250 })))
            return;
          result = await require('./business-stock-push-scope').stockPushScope(
            db,
            {
              accountId: job.accountId,
              businessId: String(job.license),
              branchId: job.branchId,
            },
            job.eventId,
            { now, cursor }
          );
          if (result.status !== 'pending') break;
          cursor = result.cursor;
          const saved = await deliveries.updateOne(lease(), { $set: { stockCursor: cursor } });
          if (!saved.matchedCount) return;
          if (now() - started >= 3000) break;
        }
        if (['denied', 'disabled', 'suppressed'].includes(result.status))
          fail('push_stock_suppressed', 410);
        if (result.status !== 'eligible') {
          const nextAttemptAt =
            result.status === 'deferred'
              ? result.retryAt
              : new Date(now() + (result.status === 'pending' ? 1 : 15000));
          if (!(nextAttemptAt instanceof Date) || nextAttemptAt >= job.staleAt)
            fail('push_expired', 410);
          await deliveries.updateOne(lease(), {
            $set: {
              nextAttemptAt,
              error: 'push_stock_' + result.status,
              ...(result.status === 'pending' ? { stockCursor: result.cursor } : {}),
            },
            $unset: {
              leaseId: '',
              leaseUntil: '',
              ...(result.status !== 'pending' ? { stockCursor: '' } : {}),
            },
          });
          continue;
        }
        scope = result;
        stockValidationCursor = cursor;
      } else scope = await currentScope(db, job.accountId, job.license, job.branchId, now, job);
      const quietUntil = deferQuiet(at, {
        time: scope.preference.time,
        quiet: scope.preference.quiet,
        timezone: scope.branch.timezone,
      });
      if (quietUntil > at) {
        if (quietUntil >= job.staleAt) fail('push_expired', 410);
        await deliveries.updateOne(lease(), {
          $set: { nextAttemptAt: quietUntil },
          $unset: { leaseId: '', leaseUntil: '' },
        });
        continue;
      }
      if (job.kind === 'stock_low') {
        const currentDevice = await devices.findOne(
          {
            _id: device._id,
            sessionId: device.sessionId,
            generation: device.generation,
            projectId: config.projectId,
            expiresAt: { $gt: new Date(now()) },
          },
          { maxTimeMS: 250 }
        );
        if (!currentDevice) fail('access_denied', 403);
        await createBusinessAccess(db, { now }).sessionIdentity(device.sessionId);
        const confirmed = await require('./business-stock-push-scope').stockPushScope(
          db,
          {
            accountId: job.accountId,
            businessId: String(job.license),
            branchId: job.branchId,
          },
          job.eventId,
          { now, cursor: stockValidationCursor }
        );
        if (['denied', 'disabled', 'suppressed'].includes(confirmed.status))
          fail('push_stock_suppressed', 410);
        if (confirmed.status !== 'eligible')
          throw Object.assign(new Error('push_stock_changed'), {
            code: 'push_stock_changed',
            retryable: true,
          });
      }
      // The provider request times out after ten seconds. Do not start it when
      // this lease cannot cover that window, or after another worker replaced it.
      if (
        !(await deliveries.findOne(
          { ...lease(), leaseUntil: { $gt: new Date(now() + 11000) } },
          { projection: { _id: 1 }, maxTimeMS: 250 }
        ))
      )
        continue;
      const ticketId = await transport.send(device.token, job.eventId, device.locale || 'en');
      await deliveries.updateOne(lease(), {
        $set: {
          state: 'receipt',
          ticketId,
          acceptedAt: new Date(now()),
          nextAttemptAt: new Date(now() + 15 * 60000),
        },
        $unset: { leaseId: '', leaseUntil: '', stockCursor: '' },
      });
    } catch (error) {
      if (error.code === 'push_device_removed')
        await devices.deleteOne({
          _id: job.deviceId,
          sessionId: job.sessionId,
          generation: job.deviceGeneration,
        });
      const terminal = [401, 403, 410].includes(error.status) || error.retryable === false;
      const retry = !terminal && job.attempts < 6;
      await deliveries.updateOne(lease(), {
        $set: {
          state: retry ? job.state : 'stopped',
          error:
            typeof error.code === 'string' && error.code.startsWith('push_')
              ? error.code
              : 'access_or_service_unavailable',
          nextAttemptAt: new Date(now() + Math.min(900000, 30000 * 2 ** job.attempts)),
        },
        $inc: { attempts: 1 },
        $unset: {
          leaseId: '',
          leaseUntil: '',
          ...(error.code === 'push_stock_changed' ? { stockCursor: '' } : {}),
        },
      });
    }
  }
}
module.exports = { configuration, deviceStatus, registerDevice, unregisterDevice, drainPush };
