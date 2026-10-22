const express = require('express');
const router = express.Router();
const messagingController = require('../controllers/messaging.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(messagingController);
  return (req, res) => messagingController.error(res, 'Handler not implemented', 501);
};

// Authenticated; the controller further restricts every route to super admins,
// since these settings hold the shop's SMS provider secrets.
router.use(protect);
router.get('/permissions', (req, res) =>
  res.json({ type: 'success', data: require('../utils/messaging-access').matrix(req.user) })
);

router.post('/email/test', bindController(messagingController.testEmail));
router.get('/email', bindController(messagingController.emailSettings));
router.put('/email', bindController(messagingController.emailSettings));
router.get('/providers', bindController(messagingController.providers));
router.get('/settings', bindController(messagingController.getSettings));
router.get('/reports', bindController(messagingController.reportSchedules));
router.post('/reports', bindController(messagingController.saveReportSchedule));
router.post('/reports/:id/test', bindController(messagingController.testReport));
router.get('/history', bindController(messagingController.history));
router.put('/settings', bindController(messagingController.saveSettings));
router.post('/settings', bindController(messagingController.saveSettings));
router.post('/test', bindController(messagingController.test));

module.exports = router;
