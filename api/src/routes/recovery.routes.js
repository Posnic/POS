'use strict';

const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { recoveryLimiter } = require('../middleware/auth-rate-limit');
const { demoGuard } = require('../config/demo-mode');
const BaseModel = require('../models/base.model');
const service = require('../services/recovery.service');
const { enabled } = require('../utils/recovery-codes');
const { clientIp } = require('../utils/client-ip');
const { authCookieOptions } = require('../utils/auth-cookie');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const recoveryOptions = (_req, res) =>
  res.json({
    type: 'success',
    data: {
      offline: enabled(),
      emailConfigured: Boolean(process.env.BREVO_API_KEY || process.env.SENDINBLUE_KEY),
    },
  });
router.get('/options', recoveryOptions);
router.use((_req, res, next) => {
  if (!enabled())
    return res
      .status(404)
      .json({ type: 'error', message: 'Offline recovery is unavailable here.' });
  next();
});

const audit = (req) => ({
  ip: clientIp(req),
  userAgent: req.headers['user-agent'],
  actor: req.user ? { id: String(req.user._id), name: req.user.email } : null,
});
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.statusCode) return next(error);
    res.status(error.statusCode).json({ type: 'error', message: error.message });
  }
};

const resetWithRecoveryCode = handle(async (req, res) => {
  const result = await service.reset(await BaseModel.getDb(), req.body, audit(req));
  if (req.session) await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('jwt', authCookieOptions());
  res.clearCookie('connect.sid', authCookieOptions());
  res.json({ type: 'success', ...result });
});
const recoveryCodeStatus = handle(async (req, res) => {
  res.json({
    type: 'success',
    data: await service.status(await BaseModel.getDb(), req.user._id),
  });
});
const generateRecoveryCodes = handle(async (req, res) => {
  const data = await service.generate(
    await BaseModel.getDb(),
    req.user._id,
    req.body.currentPassword,
    audit(req)
  );
  res.json({ type: 'success', data });
});

router.post('/reset', demoGuard, recoveryLimiter, resetWithRecoveryCode);
router.get('/codes', protect, recoveryCodeStatus);
router.post('/codes', protect, demoGuard, recoveryLimiter, generateRecoveryCodes);

module.exports = router;
