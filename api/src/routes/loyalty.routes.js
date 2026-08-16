const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyalty.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(loyaltyController);
  return (req, res) => loyaltyController.error(res, 'Handler not implemented', 501);
};

// Every loyalty route needs an authenticated user: it sets req.user and the
// per-request tenant context (license, branch, currency) the engine reads.
router.use(protect);

// Branch loyalty rules - currency-agnostic, everything configurable.
router.get('/config', bindController(loyaltyController.getConfig));
router.put('/config', bindController(loyaltyController.saveConfig));
router.post('/config', bindController(loyaltyController.saveConfig)); // form-post friendly

// Till dry-run: what would this bill earn / what is a redemption worth.
router.post('/preview', bindController(loyaltyController.preview));

// Outstanding points liability, valued at this branch's redeem rate.
router.get('/report/liability', bindController(loyaltyController.liability));

// A customer's balance, tier and ledger.
router.get('/customer/:id', bindController(loyaltyController.summary));

module.exports = router;
