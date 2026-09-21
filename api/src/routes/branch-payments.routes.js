'use strict';
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const branchAccess = require('../utils/branch-access');
const payments = require('../services/branch-payments');
router.use(protect);
router.use(async (req, res, next) => {
  try {
    if (!branchAccess.allowed(req.user, 'settings'))
      branchAccess.fail('Settings write permission is required.', 403);
    req.paymentContext = await branchAccess.context(req);
    res.set('Cache-Control', 'no-store');
    next();
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ error: { message: e.status ? e.message : 'Could not load branch payments.' } });
  }
});
router.get('/', (req, res) =>
  res.json({
    branch: req.paymentContext.branch.branch_name,
    ...payments.read(req.paymentContext.branch),
  })
);
router.post('/', async (req, res) => {
  try {
    const c = req.paymentContext;
    const payment_settings = payments.validate(req.body || {});
    await req.db.collection('branches').updateOne(
      { _id: c.branchId, license: c.license },
      {
        $set: { payment_settings, updated_date: new Date() },
        $unset: { 'mobile_pos.upiAccounts': '', 'mobile_pos.defaultUpiAccountId': '' },
      }
    );
    res.json({ saved: true });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ error: { message: e.status ? e.message : 'Could not save branch payments.' } });
  }
});
module.exports = router;
