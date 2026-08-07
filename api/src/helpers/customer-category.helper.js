/**
 * Customer Category Helper Functions
 * Utility functions for customer category operations
 */

/**
 * Validate customer category name
 * @param {string} name - Category name
 * @returns {boolean} - True if valid
 */
const isValidCategoryName = (name) => {
  if (!name || typeof name !== 'string') {
    return false;
  }
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 100;
};

/**
 * Sanitize customer category data
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

  return sanitized;
};

/**
 * Format customer category for response
 * @param {Object} category - Category document
 * @returns {Object} - Formatted category
 */
const formatCategoryResponse = (category) => {
  if (!category) return null;

  return {
    _id: category._id?.toString?.() || category._id,
    name: category.name,
    description: category.description || '',
    branch_id: category.branch_id?.toString?.() || category.branch_id,
    branch_name: category.branch_name || '',
    created_date: category.created_date,
    updated_date: category.updated_date,
    created_by: category.created_by || '',
    created_by_id: category.created_by_id?.toString?.() || category.created_by_id,
  };
};

/**
 * Validate customer category data
 * @param {Object} data - Category data to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
const validateCategoryData = (data) => {
  const errors = [];

  if (!data.name || !isValidCategoryName(data.name)) {
    errors.push('Invalid category name');
  }

  if (data.description && data.description.length > 500) {
    errors.push('Description cannot exceed 500 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Check if category name is unique in branch
 * @param {string} name - Category name
 * @param {string} branchId - Branch ID
 * @param {string} excludeId - Category ID to exclude (for updates)
 * @param {Function} findByNameFn - Repository findByName function
 * @returns {Promise<boolean>} - True if unique
 */
const isCategoryNameUnique = async (name, branchId, excludeId, findByNameFn) => {
  const existing = await findByNameFn(name, branchId);

  if (!existing) {
    return true;
  }

  if (excludeId && existing._id.toString() === excludeId.toString()) {
    return true;
  }

  return false;
};

/**
 * Prepare category data for import
 * @param {Array} rows - Import data rows
 * @param {Object} context - Branch and user context
 * @returns {Array} - Prepared category data
 */
const prepareCategoryImportData = (rows, context) => {
  return rows.map((row) => ({
    name: (row.name || '').trim(),
    description: (row.description || '').trim(),
    branch_id: context.branch_id,
    branch_name: context.branch_name,
    created_by: context.created_by,
    created_by_id: context.created_by_id,
    license: context.license,
  }));
};

module.exports = {
  isValidCategoryName,
  sanitizeCategoryData,
  formatCategoryResponse,
  validateCategoryData,
  isCategoryNameUnique,
  prepareCategoryImportData,
};
