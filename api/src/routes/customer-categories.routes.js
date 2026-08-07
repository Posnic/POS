// src/routes/customerCategory.routes.js
const express = require('express');
const router = express.Router();
const customerCategoryController = require('../controllers/customer-categories.controller');
const { protect } = require('../middleware/auth');
const {
  validateCreateCustomerCategory,
  validateUpdateCustomerCategory,
  validateCustomerCategoryId,
  validateBulkDelete,
  validateSearch,
  validateImport,
} = require('../middleware/customer-category.validation');

// Apply auth middleware to all routes
router.use(protect);

// GET /customercategory - Get all customer categories
router.get('/', validateSearch, customerCategoryController.getAll);

// POST /customercategory - Add new customer category
router.post('/', validateCreateCustomerCategory, customerCategoryController.add);

// GET /customercategory/getDataChanges - Get data changes for sync
router.get('/getDataChanges', customerCategoryController.getDataChanges);

// GET /customercategory/getCategoryDetails - Get category details
router.get('/getCategoryDetails', customerCategoryController.getCategoryDetails);

// GET /customercategory/getCustomerCategoryAjaxList - Get category list for autocomplete
router.get('/getCustomerCategoryAjaxList', customerCategoryController.getCustomerCategoryAjaxList);

// POST /customercategory/customercategoryImport - Import customer categories (PHP pattern)
router.post(
  '/customercategoryImport',
  validateImport,
  customerCategoryController.customercategoryImport
);

// POST /customercategory/importcustomercategory - Import customer categories (frontend pattern)
router.post(
  '/importcustomercategory',
  validateImport,
  customerCategoryController.customercategoryImport
);

// POST /customercategory/exportCustomerCategory - Export customer categories (PHP pattern)
router.post('/exportCustomerCategory', customerCategoryController.exportCustomerCategory);

// POST /customercategory/exportcustomerCategory - Export customer categories (frontend pattern: export + lowercase table)
router.post('/exportcustomerCategory', customerCategoryController.exportCustomerCategory);

// GET /customercategory/:id - Get single customer category
router.get('/:id', validateCustomerCategoryId, customerCategoryController.getOne);

// PUT /customercategory/:id - Update customer category
router.put('/:id', validateUpdateCustomerCategory, customerCategoryController.edit);

// DELETE /customercategory/delete - Delete customer categories (frontend uses /delete path)
router.delete('/delete', validateBulkDelete, customerCategoryController.delete);

// DELETE /customercategory - Delete customer categories (alternative base path)
router.delete('/', validateBulkDelete, customerCategoryController.delete);

module.exports = router;
