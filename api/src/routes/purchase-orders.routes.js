'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/purchase-orders.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

// Purchase orders (PO_LIFECYCLE_DESIGN.md) - the plan, never the stock.
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.post('/:id/transition', controller.transition);
router.delete('/:id', controller.remove);

module.exports = router;
