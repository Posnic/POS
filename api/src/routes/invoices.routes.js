'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/invoices.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

// Invoices (INVOICING_MODULE_DESIGN) - the bill; the SALE holds the money.
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/summary', controller.summary);
router.post('/from-quote/:quoteId', controller.fromQuote);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.post('/:id/transition', controller.transition);
router.post('/:id/payment', controller.payment);
router.post('/:id/share', controller.share);
router.delete('/:id', controller.remove);

module.exports = router;
