const express = require('express');
const router = express.Router();
const easyTableController = require('../controllers/easy-tables.controller');
const { protect } = require('../middleware/auth');

// Easy-table queries accept a collection name and arbitrary filters, so they
// must always run with a validated tenant context.
router.use(protect);

// GET /api/easytable/data - Get table data with filtering and pagination
router.get('/data', easyTableController.getTableData);

// Note: The following routes are commented out as they don't have corresponding controller methods yet
// Uncomment and implement them in the controller when needed:
// router.get("/", easyTableController.getAll);
// router.get("/:id", easyTableController.getOne);
// router.post("/", easyTableController.create);
// router.put("/:id", easyTableController.update);
// router.delete("/:id", easyTableController.delete);

module.exports = router;
