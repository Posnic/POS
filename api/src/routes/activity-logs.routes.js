const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activity-logs.controller');
const { protect } = require('../middleware/auth');

// Apply middleware if needed
// const { authenticate, authorize } = require('../middleware/auth');

// GET /api/activitylog - Get all activity logs with filtering and pagination
router.use(protect);
router.get('/sales', activityLogController.getSalesAuditLogs);
router.get('/', activityLogController.getActivityLogs);

// Commenting out routes that don't have corresponding controller methods yet
// These can be uncommented once the methods are implemented in the controller
/*
// GET /api/activitylog/:id - Get a single activity log by ID
router.get('/:id', (req, res) => {
  res.status(501).json({ status: 'error', message: 'Not implemented yet' });
});

// POST /api/activitylog - Create a new activity log
router.post('/', (req, res) => {
  res.status(501).json({ status: 'error', message: 'Not implemented yet' });
});

// PUT /api/activitylog/:id - Update an activity log
router.put('/:id', (req, res) => {
  res.status(501).json({ status: 'error', message: 'Not implemented yet' });
});

// DELETE /api/activitylog/:id - Delete an activity log
router.delete('/:id', (req, res) => {
  res.status(501).json({ status: 'error', message: 'Not implemented yet' });
});
*/

module.exports = router;
