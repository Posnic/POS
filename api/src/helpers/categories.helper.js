/**
 * Category Helper Functions
 * Utility functions for category-related operations
 */

const { VALIDATION_PATTERNS } = require('../constants/categories.constants');

/**
 * Validate category name format
 * @param {String} name - Category name
 * @returns {Boolean} - Valid or not
 */
const isValidCategoryName = (name) => {
  if (!name) return false;
  return VALIDATION_PATTERNS.NAME.test(name);
};

/**
 * Sanitize category data
 * Remove unwanted fields and trim strings
 * @param {Object} data - Category data
 * @returns {Object} - Sanitized data
 */
const sanitizeCategoryData = (data) => {
  const sanitized = { ...data };

  // Remove system fields that shouldn't be updated directly
  delete sanitized._id;
  delete sanitized.created_date;
  delete sanitized.created_by;
  delete sanitized.created_by_id;
  delete sanitized.is_deleted;
  delete sanitized.__v;

  // Trim string fields
  if (sanitized.name) sanitized.name = sanitized.name.trim();
  if (sanitized.description) sanitized.description = sanitized.description.trim();
  if (sanitized.image) sanitized.image = sanitized.image.trim();

  // Ensure numeric fields are numbers
  if (sanitized.discount_amount !== undefined) {
    sanitized.discount_amount = parseFloat(sanitized.discount_amount) || 0;
  }
  if (sanitized.discount_percentage !== undefined) {
    sanitized.discount_percentage = parseFloat(sanitized.discount_percentage) || 0;
  }
  if (sanitized.sort_order !== undefined) {
    sanitized.sort_order = parseInt(sanitized.sort_order) || 0;
  }

  return sanitized;
};

/**
 * Format category for response
 * @param {Object} category - Category document
 * @returns {Object} - Formatted category
 */
const formatCategoryResponse = (category) => {
  if (!category) return null;

  return {
    _id: category._id?.toString?.() || category._id,
    name: category.name,
    description: category.description || '',
    image: category.image || 'category.svg',
    discount_amount: category.discount_amount || 0,
    discount_percentage: category.discount_percentage || 0,
    is_active: category.is_active !== undefined ? category.is_active : true,
    sort_order: category.sort_order || 0,
    branch_id: category.branch_id,
    branch_name: category.branch_name || '',
    created_date: category.created_date,
    updated_date: category.updated_date,
  };
};

/**
 * Normalize boolean value
 * @param {*} value - Value to normalize
 * @returns {Boolean} - Boolean value
 */
const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes';
  }
  if (typeof value === 'number') return value === 1;
  return false;
};

/**
 * Validate category data for creation
 * @param {Object} data - Category data
 * @returns {Object} - { valid: Boolean, errors: Array }
 */
const validateCategoryData = (data) => {
  const errors = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push('Category name is required');
  }

  if (data.name && !isValidCategoryName(data.name)) {
    errors.push('Category name contains invalid characters');
  }

  if (data.discount_amount !== undefined && data.discount_amount < 0) {
    errors.push('Discount amount must be a positive number');
  }

  if (data.discount_percentage !== undefined) {
    const percentage = parseFloat(data.discount_percentage);
    if (percentage < 0 || percentage > 100) {
      errors.push('Discount percentage must be between 0 and 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Calculate effective discount
 * @param {Number} price - Original price
 * @param {Number} discountAmount - Discount amount
 * @param {Number} discountPercentage - Discount percentage
 * @returns {Object} - { discountedPrice, totalDiscount }
 */
const calculateDiscount = (price, discountAmount = 0, discountPercentage = 0) => {
  let totalDiscount = discountAmount;

  if (discountPercentage > 0) {
    totalDiscount += (price * discountPercentage) / 100;
  }

  const discountedPrice = Math.max(0, price - totalDiscount);

  return {
    discountedPrice,
    totalDiscount,
  };
};

/**
 * Check if category name is unique
 * @param {String} name - Category name
 * @param {String} branchId - Branch ID
 * @param {String} excludeId - Category ID to exclude (for updates)
 * @param {Function} findByName - Repository function to find by name
 * @returns {Promise<Boolean>} - True if unique
 */
const isCategoryNameUnique = async (name, branchId, excludeId, findByName) => {
  const existing = await findByName(name, branchId);

  if (!existing) return true;

  if (excludeId && existing._id.toString() === excludeId.toString()) {
    return true;
  }

  return false;
};

module.exports = {
  isValidCategoryName,
  sanitizeCategoryData,
  formatCategoryResponse,
  normalizeBoolean,
  validateCategoryData,
  calculateDiscount,
  isCategoryNameUnique,
};
