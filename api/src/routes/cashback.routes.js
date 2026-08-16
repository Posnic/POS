const express = require('express');
const router = express.Router();
const cashbackController = require('../controllers/cashback.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(cashbackController);
  return (req, res) => cashbackController.error(res, 'Handler not implemented', 501);
};

// Every cashback route needs an authenticated user (sets req.user + tenant context).
router.use(protect);

router.get('/settings', bindController(cashbackController.getSettings));
router.put('/settings', bindController(cashbackController.saveSettings));
router.post('/settings', bindController(cashbackController.saveSettings));
router.get('/recent', bindController(cashbackController.recent));

module.exports = router;
