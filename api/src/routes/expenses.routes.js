const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expenses.controller');
const { protect } = require('../middleware/auth');
const { validateExpense, validateId } = require('../middleware/validation');
require('mongodb');

// Apply authentication middleware to all routes
router.use(protect);

// GET /api/expenses - Get all expenses with pagination
router.get('/', (req, res) => expensesController.getAll(req, res));

// Legacy report route that frontend still requests under /expenses
router.get('/expensesReportTable', (req, res) => expensesController.expensesReportTable(req, res));

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', (req, res) => expensesController.getDataChanges(req, res));

// PHP: expensesImport() - Bulk import
router.post('/expensesImport', (req, res) => expensesController.expensesImport(req, res));

// PHP: exportExpenses() - Excel export
router.post('/exportExpenses', (req, res) => expensesController.exportExpenses(req, res));

// PHP: getExpenseDetails() - Get expense details
router.get('/getExpenseDetails', (req, res) => expensesController.getExpenseDetails(req, res));

// GET /api/expenses/summary - Get expense summary
router.get('/summary', (req, res) => expensesController.getSummary(req, res));

// GET /api/expenses/category/:category - Get expenses by category
router.get('/category/:category', (req, res) => expensesController.getByCategory(req, res));

// GET /api/expenses/type/:type - Get expenses by type
router.get('/type/:type', (req, res) => expensesController.getByType(req, res));

// GET /api/expenses/:id - Get expense by ID (with ObjectId validation)
router.get('/:id', validateId, (req, res) => expensesController.getOne(req, res));

// POST /api/expenses - Create new expense
router.post('/', validateExpense, (req, res) => expensesController.create(req, res));

// PUT /api/expenses/:id - Update expense
router.put('/:id', validateId, validateExpense, (req, res) => expensesController.update(req, res));

// DELETE /api/expenses/delete - Legacy bulk delete endpoint used by frontend
router.delete('/delete', (req, res) => expensesController.delete(req, res));

// DELETE /api/expenses - Bulk delete (alternate form, kept for API consistency)
router.delete('/', (req, res) => expensesController.delete(req, res));

module.exports = router;
