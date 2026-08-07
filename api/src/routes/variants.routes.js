const express = require('express');
const router = express.Router();
const variantsController = require('../controllers/variants.controller');
const { protect } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const {
  createVariantValidation,
  updateVariantValidation,
  getVariantByIdValidation,
  deleteVariantsValidation,
  bulkDeleteValidation,
  exportVariantsValidation,
  searchValidation,
  getPaginatedVariantsValidation,
  getVariantsAjaxListValidation,
  getByFieldValidation,
} = require('../middleware/variants.validation');

// Ensure every variant operation receives the same validated tenant scope.
router.use(protect);

// GET /api/variants - Get all variants
router.get('/', getPaginatedVariantsValidation, handleValidationErrors, variantsController.getAll);

// Legacy AJAX endpoint for autocomplete
router.get(
  '/getVariantsAjaxList',
  getVariantsAjaxListValidation,
  handleValidationErrors,
  variantsController.getVariantsAjaxList
);

// PHP: getVariantDetails() - Get variant details
router.get(
  '/getVariantDetails',
  getVariantByIdValidation,
  handleValidationErrors,
  variantsController.getVariantDetails
);

// PHP: exportVariants() - Export to Excel
router.post(
  '/exportVariants',
  exportVariantsValidation,
  handleValidationErrors,
  variantsController.exportVariants
);

// GET /api/variants/stats - Get variant statistics
router.get('/stats', variantsController.getStats);

// GET /api/variants/search - Search variants
router.get('/search', searchValidation, handleValidationErrors, variantsController.search);

// GET /api/variants/field/:field - Get variants by field
router.get(
  '/field/:field',
  getByFieldValidation,
  handleValidationErrors,
  variantsController.getByField
);

// DELETE /api/variants/bulk - Bulk delete variants (new-style API)
router.post(
  '/bulk-delete',
  bulkDeleteValidation,
  handleValidationErrors,
  variantsController.bulkDelete
);

// Legacy bulk delete endpoint: DELETE /variants/delete
// Frontend uses PosnicPro.deleteTableData / deleteTableRowData which calls
//   DELETE /variants/delete
// with body: { data: [id1, id2, ...] }
router.delete(
  '/delete',
  deleteVariantsValidation,
  handleValidationErrors,
  variantsController.legacyDelete
);

// GET /api/variants/:id - Get variant by ID
router.get('/:id', getVariantByIdValidation, handleValidationErrors, variantsController.getOne);

// POST /api/variants - Create new variant
router.post('/', createVariantValidation, handleValidationErrors, variantsController.create);

// PUT /api/variants/:id - Update variant
router.put('/:id', updateVariantValidation, handleValidationErrors, variantsController.update);

// DELETE /api/variants/:id - Delete variant
router.delete('/:id', getVariantByIdValidation, handleValidationErrors, variantsController.delete);

module.exports = router;
