'use strict';

const router = require('express').Router();
const controller = require('../controllers/inventory-counts.controller');
const { protect } = require('../middleware/auth');
router.use(protect);
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.get);
module.exports = router;
