// src/validators/inventory.validator.js
const { body, param, query } = require('express-validator');

const inventoryValidations = {
  // GET /inventory
  list: [
    query('page').optional().isInt().withMessage('Page must be an integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('search').optional().trim(),
    query('category').optional().isMongoId().withMessage('Invalid category ID'),
    query('sortBy')
      .optional()
      .isIn(['name', 'price', 'stock_quantity', 'created_at'])
      .withMessage('Invalid sort field'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Sort order must be "asc" or "desc"'),
  ],

  // POST /inventory
  create: [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('sku').trim().notEmpty().withMessage('SKU is required'),
    body('barcode').optional().trim(),
    body('description').optional().trim(),
    body('category_id').isMongoId().withMessage('Invalid category ID'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('cost_price')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Cost price must be a positive number'),
    body('stock_quantity')
      .isInt({ min: 0 })
      .withMessage('Stock quantity must be a non-negative integer'),
    body('reorder_level')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Reorder level must be a non-negative integer'),
    body('unit').optional().trim(),
    body('supplier_id').optional().isMongoId().withMessage('Invalid supplier ID'),
  ],

  // PUT /inventory/:id
  update: [
    param('id').isMongoId().withMessage('Invalid inventory item ID'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('sku').optional().trim().notEmpty().withMessage('SKU cannot be empty'),
    body('barcode').optional().trim(),
    body('description').optional().trim(),
    body('category_id').optional().isMongoId().withMessage('Invalid category ID'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('cost_price')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Cost price must be a positive number'),
    body('stock_quantity')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Stock quantity must be a non-negative integer'),
    body('reorder_level')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Reorder level must be a non-negative integer'),
    body('unit').optional().trim(),
    body('supplier_id').optional().isMongoId().withMessage('Invalid supplier ID'),
  ],

  // PATCH /inventory/:id/stock
  updateStock: [
    param('id').isMongoId().withMessage('Invalid inventory item ID'),
    body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
    body('action')
      .optional()
      .isIn(['add', 'subtract'])
      .withMessage('Action must be either "add" or "subtract"'),
    body('notes').optional().trim(),
  ],
};

module.exports = inventoryValidations;
