const express = require('express');

const router = express.Router();
const authorizationsController = require('../controllers/authorizations.controller');
const { protect } = require('../middleware/auth');

const bind = (handler) => (req, res, next) => handler.call(authorizationsController, req, res, next);

router.use(protect);

router.post('/set-manager-pin', bind(authorizationsController.setManagerPin));
router.post('/verify-pin', bind(authorizationsController.verifyPin));

module.exports = router;
