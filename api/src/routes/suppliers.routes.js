const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const suppliersController = require('../controllers/suppliers.controller');
const { protect } = require('../middleware/auth');
const {
  validateCreateSupplier,
  validateUpdateSupplier,
  validateBulkDelete,
  validateSearch,
  validateImport,
} = require('../middleware/suppliers.validation');

const bindController = (handler) => {
  if (typeof handler !== 'function') {
    throw new TypeError('Invalid suppliers controller handler');
  }
  return (req, res, next) => handler.call(suppliersController, req, res, next);
};

// Apply authentication middleware to all routes
router.use(protect);

// GET /suppliers - List suppliers with pagination/search
router.get('/', validateSearch, bindController(suppliersController.getAll));

// GET /suppliers/getSuppliersAjaxList - Autocomplete for suppliers
router.get(
  '/getSuppliersAjaxList',
  validateSearch,
  bindController(suppliersController.getSuppliersAjaxList)
);

// GET /suppliers/supplierGraphicalReports - Graphical reports
router.get(
  '/supplierGraphicalReports',
  bindController(suppliersController.supplierGraphicalReports)
);

// GET /suppliers/getDataChanges - Data sync
router.get('/getDataChanges', bindController(suppliersController.getDataChanges));

// GET /suppliers/getSupplierDetails - Get supplier details (no access check)
router.get('/getSupplierDetails', bindController(suppliersController.getSupplierDetails));

// POST /suppliers/suppliersImport - Bulk import
router.post(
  '/suppliersImport',
  validateImport,
  bindController(suppliersController.suppliersImport)
);

// POST /suppliers/exportSuppliers - Export suppliers
router.post('/exportSuppliers', bindController(suppliersController.exportSuppliers));

// POST /suppliers - Add new supplier
router.post('/', validateCreateSupplier, bindController(suppliersController.add));

// DELETE /suppliers - Delete suppliers (Node-native)
router.delete('/', validateBulkDelete, bindController(suppliersController.delete));

// DELETE /suppliers/delete - Legacy PHP-compatible bulk delete endpoint
// Frontend calls this URL via PosnicPro.deleteTableSelectedRowData
router.delete('/delete', validateBulkDelete, bindController(suppliersController.delete));

// Validate ObjectId middleware
const ensureValidSupplierId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    return next('route');
  }
  next();
};

// GET /suppliers/:id - Get single supplier
router.get('/:id', ensureValidSupplierId, bindController(suppliersController.getOne));

// PUT /suppliers/:id - Update supplier
router.put(
  '/:id',
  ensureValidSupplierId,
  validateUpdateSupplier,
  bindController(suppliersController.edit)
);

module.exports = router;
