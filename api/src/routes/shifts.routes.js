const express = require('express');

const router = express.Router();
const shiftsController = require('../controllers/shifts.controller');
const { protect } = require('../middleware/auth');

const bind = (handler) => (req, res, next) => handler.call(shiftsController, req, res, next);

router.use(protect);

router.get('/current', bind(shiftsController.current));
router.post('/clock-in', bind(shiftsController.clockIn));
router.post('/clock-out', bind(shiftsController.clockOut));
router.post('/clock-by-card', bind(shiftsController.clockByCard));
router.get('/report', bind(shiftsController.report));
router.post('/set-rate', bind(shiftsController.setRate));
router.post('/set-targets', bind(shiftsController.setTargets));
router.get('/schedule', bind(shiftsController.listSchedule));
router.post('/schedule', bind(shiftsController.addSchedule));
router.delete('/schedule/:id', bind(shiftsController.deleteSchedule));
router.put('/:id', bind(shiftsController.editShift));
router.get('/', bind(shiftsController.list));

module.exports = router;
