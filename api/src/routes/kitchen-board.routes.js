'use strict';
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const service = require('../services/kitchen-board');

const wrap = (fn) => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await fn(req));
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ message: e.status ? e.message : 'Kitchen is unavailable. Please retry.' });
  }
};
const devices = require('../services/kitchen-devices');
const { rateLimit } = require('express-rate-limit');
router.post('/devices/pair', rateLimit({ windowMs: 60000, limit: 20 }), wrap(devices.pair));
router.post('/settings', protect, wrap(service.saveSettings));
router.post('/devices/code', protect, wrap(devices.create));
router.get('/devices', protect, wrap(devices.list));
router.post('/devices/revoke', protect, wrap(devices.revoke));
const authenticateKitchen = async (req, res, next) => {
  if (!req.headers['x-kitchen-device']) return protect(req, res, next);
  try {
    await devices.authenticate(req);
    next();
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : 'Kitchen access unavailable.' });
  }
};
router.get('/', authenticateKitchen, wrap(service.list));
router.post('/transition', authenticateKitchen, wrap(service.transition));
module.exports = router;
