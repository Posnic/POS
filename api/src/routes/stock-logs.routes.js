const express = require('express');
const router = express.Router();
const stockLogController = require('../controllers/stock-logs.controller');
const { protect } = require('../middleware/auth');
const {
  validateCreateStockLog,
  validateUpdateItemName,
  validateCleanupLogs,
} = require('../middleware/stock-logs.validation');

const bindController = (handler, controller = stockLogController) => {
  if (typeof handler !== 'function') {
    throw new TypeError('Invalid controller handler supplied to router');
  }
  return (req, res, next) => handler.call(controller, req, res, next);
};

// Authentication attaches the validated branch, branch name, and license used
// by the controller/service/repository request context.
router.use(protect);

// GET /api/stocklogs - Get all stock logs with pagination and filtering
router.get('/', bindController(stockLogController.getAll));

// PHP: exportStocklogs() - Export stock logs (must be before /:id route)
router.post('/exportStocklogs', bindController(stockLogController.exportStocklogs));

// POST /api/stocklogs/cleanup - Cleanup old soft-deleted logs (must be before /:id route)
router.post(
  '/cleanup',
  validateCleanupLogs,
  bindController(stockLogController.cleanupOldDeletedLogs)
);

// GET /api/stocklogs/export - Export stock logs to CSV
router.get('/export', bindController(stockLogController.export));

// PUT /api/stocklogs/item/:itemId/update-name - Update item name in all stock logs (mirrors PHP updateItemNameStockModel)
router.put(
  '/item/:itemId/update-name',
  validateUpdateItemName,
  bindController(stockLogController.updateItemName)
);

// GET /api/stocklogs/:id - Get stock log by ID
router.get('/:id', bindController(stockLogController.getOne));

// POST /api/stocklogs - Create a new stock log
router.post('/', validateCreateStockLog, bindController(stockLogController.create));

// DELETE /api/stocklogs - Delete stock logs
router.delete('/', bindController(stockLogController.delete));

module.exports = router;
