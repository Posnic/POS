const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const authorizationsController = require('../controllers/authorizations.controller');
const { protect } = require('../middleware/auth');

const bind = (handler) => (req, res, next) =>
  handler.call(authorizationsController, req, res, next);

router.use(protect);

router.post('/set-manager-pin', bind(authorizationsController.setManagerPin));
router.post(
  '/verify-pin',
  rateLimit({ windowMs: 60000, limit: 5, standardHeaders: true, legacyHeaders: false }),
  bind(authorizationsController.verifyPin)
);
router.post('/set-rfid', bind(authorizationsController.setRfid));
router.post('/verify-card', bind(authorizationsController.verifyCard));

module.exports = router;
