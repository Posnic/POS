'use strict';
const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const access = require('../services/captain-access');
const { protect } = require('../middleware/auth');
const wrap = (fn) => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(e.status || 500).json({
      error: { code: e.code || 'SERVER_ERROR', message: e.status ? e.message : 'Please retry.' },
    });
  }
};
const limit = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
router.post('/enrolment-proof', limit, wrap(access.proof));
router.post('/pair', limit, wrap(access.pair));
router.post('/refresh', limit, wrap(access.refresh));
router.post('/route-proof', rateLimit({ windowMs: 60000, limit: 180 }), wrap(access.routeProof));
router.use(protect);
const profile = require('../services/captain-profile');
router.get('/profile', wrap(profile.get));
const branchDetails = require('../services/captain-branch-details');
router.get('/branch-details', wrap(branchDetails.get));
router.post('/branch-details', limit, wrap(branchDetails.update));
const tables = require('../services/captain-tables');
router.get('/tables', wrap(tables.list));
router.post('/tables', limit, wrap(tables.update));
router.post('/tables/state', limit, wrap(tables.state));
router.post('/tables/close', limit, wrap(tables.close));

router.post('/profile', limit, wrap(profile.update));
router.post('/password', rateLimit({ windowMs: 15 * 60000, limit: 8 }), wrap(profile.password));

router.get('/kitchen-ready', wrap(require('../services/kitchen-board').captainList));
router.post(
  '/kitchen-ready',
  rateLimit({ windowMs: 60000, limit: 180 }),
  wrap(require('../services/kitchen-board').captainAction)
);
router.post(
  '/kitchen-audio/:action',
  rateLimit({ windowMs: 60000, limit: 40 }),
  wrap(async (req) => {
    const { allowed, context } = require('../utils/branch-access');
    if (!allowed(req.user, 'sales')) access.fail('FORBIDDEN', 'Order access is required.', 403);
    const c = await context(req);
    if (c.branch.module_captain_enable === false)
      access.fail('DISABLED', 'Captain is disabled.', 403);
    if (!['start', 'cancel', 'voice'].includes(req.params.action))
      access.fail('INVALID_ACTION', 'Unknown audio action.', 400);
    if (!process.listenerCount('posnic:kitchen-audio'))
      access.fail('UNAVAILABLE', 'Connect to the local POS with Kitchen Sound enabled.', 503);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error('Kitchen audio did not respond. Please retry.'), {
              status: 503,
            })
          ),
        10000
      );
      process.emit(
        'posnic:kitchen-audio',
        {
          action: req.params.action,
          branchId: String(c.branchId),
          owner: String(c.license) + ':' + String(req.user._id),
          id: req.body.id,
          data: req.body.data,
        },
        (error, value) => {
          clearTimeout(timer);
          if (error) reject(Object.assign(error, { status: 409 }));
          else resolve(value);
        }
      );
    });
  })
);
router.post(
  '/pair-codes',
  wrap(async (req) => {
    const result = await access.createCode(req);
    const { pairingTargets, localAddresses } = require('../utils/pairing');
    const targets = pairingTargets(
      { host: req.headers.host, port: req.socket?.localPort || process.env.PORT || 5555 },
      localAddresses()
    ).targets;
    result.targets = await Promise.all(
      targets.map(async (target) => ({
        ...target,
        qr: await require('qrcode').toDataURL(
          JSON.stringify({
            app: 'captain',
            server: target.url,
            code: result.code,
            enrolmentId: result.enrolmentId,
          }),
          { width: 240, margin: 1 }
        ),
      }))
    );
    return result;
  })
);
router.get(
  '/settings',
  wrap(async (req) => {
    const { allowed, context } = require('../utils/branch-access');
    if (!allowed(req.user, 'settings'))
      access.fail('MANAGER_REQUIRED', 'Manager access is required.');
    const c = await context(req);
    const users = await req.db
      .collection('users')
      .find({ license: c.license, activate: true }, { projection: { password: 0 } })
      .toArray();
    return {
      fallbackUrl: c.branch.captain_fallback_url || '',
      branch: c.branch.branch_name,
      staff: users
        .filter(
          (u) =>
            access.canOrder(u) &&
            (String(u.branch_id) === String(c.branchId) ||
              u.branch_access?.some((b) => String(b.branch_id) === String(c.branchId)))
        )
        .map((u) => ({ id: String(u._id), name: u.username || u.name || '' })),
    };
  })
);
router.post(
  '/connection-settings',
  wrap(async (req) => {
    const { allowed, context } = require('../utils/branch-access');
    if (!allowed(req.user, 'settings'))
      access.fail('MANAGER_REQUIRED', 'Manager access is required.');
    const c = await context(req);
    let url = String(req.body.fallbackUrl || '').trim();
    if (url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        access.fail('INVALID_ADDRESS', 'Enter a full HTTPS server address.', 400);
      }
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        access.fail(
          'INVALID_ADDRESS',
          'Use an HTTPS server address without credentials, query or fragment.',
          400
        );
      url = parsed.href.replace(/\/$/, '');
      if (!url.endsWith('/api')) url += '/api';
    }
    await req.db
      .collection('branches')
      .updateOne({ _id: c.branchId, license: c.license }, { $set: { captain_fallback_url: url } });
    return { saved: true };
  })
);
router.get(
  '/session',
  wrap(async (req) => ({ user: req.user._id, branchId: req.tenantContext.branchId }))
);
router.post(
  '/logout',
  wrap(async (req) => {
    if (req.captainSession)
      await req.db
        .collection('captain_sessions')
        .updateOne(
          { _id: new (require('mongodb').ObjectId)(req.captainSession) },
          { $set: { revoked: true } }
        );
    return { signedOut: true };
  })
);

const payments = require('../services/captain-payments');
const paymentLimit = rateLimit({
  windowMs: 60000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
});
router.get(
  '/payment-options',
  paymentLimit,
  wrap(async (req) => (await payments.scope(req, false)).options)
);
router.post('/payments/table', paymentLimit, wrap(payments.prepare));
router.post('/payments/record', paymentLimit, wrap(payments.record));
router.post('/payments/release', paymentLimit, wrap(payments.release));
router.get(
  '/payment-settings',
  paymentLimit,
  wrap(async (req) => {
    if (!require('../utils/branch-access').allowed(req.user, 'settings'))
      access.fail('MANAGER_REQUIRED', 'Settings permission is required.');
    return payments.settings((await require('../utils/branch-access').context(req)).branch);
  })
);
router.post(
  '/payment-settings',
  paymentLimit,
  wrap(async (req) => {
    if (!require('../utils/branch-access').allowed(req.user, 'settings'))
      access.fail('MANAGER_REQUIRED', 'Settings permission is required.');
    const c = await require('../utils/branch-access').context(req);
    const value = payments.validateSettings(req.body || {});
    await req.db
      .collection('branches')
      .updateOne(
        { _id: c.branchId, license: c.license },
        { $set: { captain_payments: value, updated_date: new Date() } }
      );
    return { saved: true, ...value };
  })
);

module.exports = router;
