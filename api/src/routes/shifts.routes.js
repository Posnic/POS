const express = require('express');

const router = express.Router();
const shiftsController = require('../controllers/shifts.controller');
const { protect } = require('../middleware/auth');

const bind = (handler) => (req, res, next) => handler.call(shiftsController, req, res, next);

router.use(protect);

router.get('/current', bind(shiftsController.current));
router.post('/clock-in', bind(shiftsController.clockIn));
router.post('/clock-out', bind(shiftsController.clockOut));
router.get('/', bind(shiftsController.list));

module.exports = router;
