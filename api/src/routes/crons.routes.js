const express = require('express');
const router = express.Router();
const cronsController = require('../controllers/crons.controller');
const { protect } = require('../middleware/auth');

// Bind controller methods
const bindController = (handler) => handler.bind(cronsController);

// Apply authentication middleware
router.use(protect);

// PHP: cronCreateFile() - Test cron file creation
router.post('/cronCreateFile', bindController(cronsController.cronCreateFile));

// Get all cron jobs
router.get('/', bindController(cronsController.getAllCronJobs));

// Create new cron job
router.post('/', bindController(cronsController.createCronJob));

// Update cron job
router.put('/:name', bindController(cronsController.updateCronJob));

// Delete cron job
router.delete('/:name', bindController(cronsController.deleteCronJob));

// Start cron job
router.post('/:name/start', bindController(cronsController.startCronJob));

// Stop cron job
router.post('/:name/stop', bindController(cronsController.stopCronJob));

// Execute cron job immediately
router.post('/:name/execute', bindController(cronsController.executeCronJob));

// Get cron job logs
router.get('/:name/logs', bindController(cronsController.getCronLogs));

module.exports = router;
