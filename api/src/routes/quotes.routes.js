'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/quotes.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

// Quotes (LS2) - a priced offer, never stock, never payment.
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.post('/:id/transition', controller.transition);
router.post('/:id/share', controller.share);
router.delete('/:id', controller.remove);

module.exports = router;
