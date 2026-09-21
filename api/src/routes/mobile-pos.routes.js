'use strict';
const express = require('express');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { rateLimit } = require('express-rate-limit');
const { protect, signLegacyToken, handsetLifetimeSeconds } = require('../middleware/auth');
const handsets = require('../utils/handsets');
const mobile = require('../services/mobile-pos');
const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await fn(req));
  } catch (e) {
    if (!e.status) console.error('Mobile POS:', e);
    res.status(e.status || 500).json({
      error: {
        message: e.status ? e.message : 'The server could not complete this action. Please retry.',
      },
    });
  }
};
const limiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/enrolment-proof',
  rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }),
  wrap(async (req) => {
    const { enrolmentId, nonce } = req.body || {};
    if (
      typeof enrolmentId !== 'string' ||
      !/^[\w-]{36}$/.test(enrolmentId) ||
      typeof nonce !== 'string' ||
      !/^[\w-]{43}$/.test(nonce)
    )
      mobile.fail('Invalid request.', 400);
    const grant = await req.db
      .collection('mobile_pair_codes')
      .findOne({ enrolmentId, expires: { $gt: new Date() } });
    if (!grant) mobile.fail('Waiting for till authorization.', 404);
    return { proof: crypto.createHmac('sha256', grant._id).update(nonce).digest('hex') };
  })
);

router.post(
  '/pair',
  limiter,
  wrap(async (req) => {
    const raw = String(req.body?.code || '')
      .replace(/[ -]/g, '')
      .toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(raw) || !handsets.deviceIdOf(req.body?.device))
      mobile.fail('Enter a valid pairing code.', 401);
    const codes = req.db.collection('mobile_pair_codes');
    const candidate = await codes.findOne({ _id: mobile.hash(raw), expires: { $gt: new Date() } });
    if (
      candidate?.deviceId &&
      (candidate.deviceId !== handsets.deviceIdOf(req.body.device) ||
        typeof req.body.codeVerifier !== 'string' ||
        !/^[\w-]{43}$/.test(req.body.codeVerifier) ||
        crypto.createHash('sha256').update(req.body.codeVerifier).digest('base64url') !==
          candidate.codeChallenge)
    )
      mobile.fail('This authorization belongs to another device.', 401);
    const code = await codes.findOneAndUpdate(
      {
        _id: mobile.hash(raw),
        expires: { $gt: new Date() },
        usedAt: { $exists: false },
      },
      { $set: { usedAt: new Date() } },
      { returnDocument: 'before' }
    );
    if (!code) mobile.fail('Pairing code expired or already used.', 401);
    const user = await req.db
      .collection('users')
      .findOne({ _id: code.userId, license: code.license, activate: true });
    const branch = await req.db
      .collection('branches')
      .findOne({ _id: code.branchId, license: code.license });
    if (!user || !branch || !mobile.settings(branch).enabled || !mobile.allowed(user, 'sales'))
      mobile.fail('This account cannot connect.', 403);
    if (!require('../utils/auth-version').current(user, code))
      mobile.fail('Pairing code is no longer valid. Generate a new code.', 401);
    if (
      !user.branch_access?.some((b) => String(b.branch_id) === String(code.branchId)) &&
      String(user.branch_id) !== String(code.branchId)
    )
      mobile.fail('Branch access was removed.', 403);
    req.handsetDevice = await handsets.remember(req.db, {
      device: req.body.device,
      user,
      ip: req.ip,
      branchId: code.branchId,
    });
    return { token: signLegacyToken(user, req, code.branchId, handsetLifetimeSeconds()) };
  })
);
router.use(protect);
router.get('/bootstrap', wrap(mobile.bootstrap));
router.post('/sales', wrap(mobile.ingest));
router.get(
  '/settings',
  wrap(async (req) => {
    if (!mobile.allowed(req.user, 'settings') && !mobile.allowed(req.user, 'plan', 'read'))
      mobile.fail('Settings access is required.', 403);
    const c = await mobile.context(req, false);
    const { localAddresses, pairingTargets } = require('../utils/pairing');
    const addresses = await Promise.all(
      pairingTargets(
        { host: req.headers.host, port: process.env.PORT || 5555 },
        localAddresses()
      ).targets.map(async (a) => ({
        ...a,
        qr: await require('qrcode').toDataURL(a.url, { width: 180, margin: 1 }),
      }))
    );
    const attention = await req.db
      .collection('mobile_sales')
      .find(
        {
          license: c.license,
          branchId: c.branchId,
          $or: [{ state: 'pending' }, { 'issues.0': { $exists: true } }],
        },
        { projection: { _id: 1, state: 1, issues: 1, 'sale.receipt': 1 } }
      )
      .limit(100)
      .toArray();
    return {
      branch: c.branch.branch_name,
      ...c.config,
      addresses,
      attention,
      devices: (await handsets.list(req.db)).filter(
        (d) => !d.branch_id || String(d.branch_id) === String(c.branchId)
      ),
    };
  })
);
router.post(
  '/recover',
  wrap(async (req) => {
    if (!mobile.allowed(req.user, 'settings'))
      mobile.fail('Settings write permission is required.', 403);
    const c = await mobile.context(req, false);
    const pending = await req.db
      .collection('mobile_sales')
      .find({ license: c.license, branchId: c.branchId, state: 'pending' })
      .limit(50)
      .toArray();
    for (const intent of pending)
      await mobile.finish(req.db, intent, { ...c, userId: intent.userId });
    return { recovered: pending.length };
  })
);
router.post(
  '/settings',
  wrap(async (req) => {
    if (!mobile.allowed(req.user, 'settings'))
      mobile.fail('Settings write permission is required.', 403);
    const c = await mobile.context(req, false),
      s = req.body || {};
    if (
      !Number.isInteger(s.offlineHours) ||
      s.offlineHours < 1 ||
      s.offlineHours > 72 ||
      !Number.isInteger(s.quickTaxBps) ||
      s.quickTaxBps < 0 ||
      s.quickTaxBps > 10000
    )
      mobile.fail('Choose an offline period of 1 to 72 hours and a valid tax rate.');
    const config = {
      offlineHours: s.offlineHours,
      quickSale: s.quickSale === true,
      quickTaxBps: s.quickTaxBps,
      quickTaxInclusive: s.quickTaxInclusive === true,
      tillId: String(s.tillId || '')
        .trim()
        .slice(0, 128),
    };
    await req.db.collection('branches').updateOne(
      { _id: c.branchId, license: c.license },
      {
        $set: {
          ...Object.fromEntries(
            Object.entries(config).map(([key, value]) => ['mobile_pos.' + key, value])
          ),
          updated_date: new Date(),
        },
      }
    );
    return { saved: true };
  })
);
router.post(
  '/pair-codes',
  wrap(async (req) => {
    if (!mobile.allowed(req.user, 'settings') || !mobile.allowed(req.user, 'sales'))
      mobile.fail('Manager access is required.', 403);
    const c = await mobile.context(req);
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expires = new Date(Date.now() + 5 * 60000);
    await req.db
      .collection('mobile_pair_codes')
      .createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    await req.db.collection('mobile_pair_codes').insertOne({
      _id: mobile.hash(code),
      userId: c.userId,
      authVersion: require('../utils/auth-version').version(req.user),
      branchId: c.branchId,
      license: c.license,
      expires,
    });
    return {
      code: code.match(/.{4}/g).join('-'),
      expires,
      staffName: req.user.username || req.user.name || '',
    };
  })
);
router.post(
  '/devices/revoke',
  wrap(async (req) => {
    if (!mobile.allowed(req.user, 'settings'))
      mobile.fail('Settings write permission is required.', 403);
    const c = await mobile.context(req, false);
    const device = String(req.body.device || '');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(device)) mobile.fail('Invalid device.');
    const row = await req.db.collection('handsets').findOne({ device_id: device });
    if (!row || (row.branch_id && String(row.branch_id) !== String(c.branchId)))
      mobile.fail('Device not found in this branch.', 404);
    await handsets.setRevoked(req.db, device, true, req.user.username);
    return { revoked: true };
  })
);
router.post(
  '/print-jobs',
  wrap(async (req) => {
    const c = await mobile.context(req);
    if (!mobile.allowed(req.user, 'sales') || !req.handsetDevice)
      mobile.fail('This device cannot print.', 403);
    const { id, saleId, document } = req.body || {};
    if (typeof id !== 'string' || id.length > 120 || !['receipt', 'test'].includes(document))
      mobile.fail('Invalid print request.');
    let payload;
    if (document === 'receipt') {
      if (id !== 'receipt:' + saleId) mobile.fail('Invalid receipt identity.');
      const key = mobile.hash(
        [String(c.license), String(c.branchId), req.handsetDevice, saleId].join(':')
      );
      const intent = await req.db
        .collection('mobile_sales')
        .findOne({ _id: key, state: 'complete' });
      if (!intent) mobile.fail('Sync this sale before sending its receipt to the till.', 409);
      const sale = await req.db
        .collection('sales')
        .findOne({ _id: intent.serverId, license: c.license, branch_id: c.branchId });
      payload = require('../helpers/bill-payload').buildBillPayload(sale, c.branch);
      payload.payments = [
        {
          label: sale.payment_mode === 'Upi' ? 'UPI (staff confirmed)' : 'Cash',
          amount:
            intent.sale.payment.method === 'cash'
              ? intent.sale.payment.received / 100
              : intent.sale.total / 100,
        },
      ];
      if (intent.sale.payment.method === 'cash') payload.change = intent.sale.payment.change / 100;
    } else
      payload = {
        storeName: c.branch.branch_name || 'Posnic',
        billNo: 'TEST (NOT A SALE)',
        items: [{ name: 'MOBILE POS TEST PRINT', qty: 1, rate: 0, amount: 0 }],
        total: 0,
      };
    const jobId = new ObjectId(
      mobile.hash(String(c.branchId) + ':' + req.handsetDevice + ':' + id).slice(0, 24)
    );
    const Model = require('../models/print-job.model');
    await Model.updateOne(
      { _id: jobId },
      {
        $setOnInsert: {
          branch_id: c.branchId,
          till_id: c.config.tillId || null,
          kind: 'bill',
          payload,
          label: 'Mobile POS receipt',
          status: 'queued',
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
    require('../helpers/print-pace').announceJob(c.branchId);
    require('../helpers/bill-notify').notifyBillRequested({ branchId: c.branchId, count: 1 });
    return { id: String(jobId), status: 'queued' };
  })
);
module.exports = router;
