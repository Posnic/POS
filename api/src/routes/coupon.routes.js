const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { protect } = require('../middleware/auth');

const bindController = (handler) => {
  if (typeof handler === 'function') return handler.bind(couponController);
  return (req, res) => couponController.error(res, 'Handler not implemented', 501);
};

// Every coupon route needs an authenticated user (sets req.user + tenant context).
router.use(protect);

// Till: check a code against the live bill and customer. Must come before /:id.
router.post('/validate', bindController(couponController.validate));

// Admin CRUD.
router.get('/', bindController(couponController.list));
router.post('/', bindController(couponController.create));
router.put('/:id', bindController(couponController.update));
router.delete('/:id', bindController(couponController.remove));

module.exports = router;
