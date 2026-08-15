const express = require('express');
const router = express.Router();
const creditController = require('../controllers/credit.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(creditController);
  return (req, res) => creditController.error(res, 'Handler not implemented', 501);
};

// Every credit route needs an authenticated user (sets req.user + tenant context).
router.use(protect);

router.get('/settings', bindController(creditController.getSettings));
router.put('/settings', bindController(creditController.saveSettings));
router.post('/settings', bindController(creditController.saveSettings));

router.get('/outstanding', bindController(creditController.outstanding));
router.get('/check-limit', bindController(creditController.checkLimit));

router.post('/run-reminders', bindController(creditController.runReminders));
router.post('/reminder/:customerId', bindController(creditController.sendReminder));

module.exports = router;
