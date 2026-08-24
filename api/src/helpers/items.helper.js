/**
 * Item Helper Functions
 * Utility functions for item-related operations
 */

const { FIELD_LIMITS, ERROR_MESSAGES } = require('../constants/items.constants');
const gtin = require('../utils/gtin');

/**
 * Sanitize item data before persistence
 * - Remove system fields
 * - Trim common string fields
 *
 * @param {Object} data
 * @returns {Object}
 */
const sanitizeItemData = (data = {}) => {
  const sanitized = { ...data };

  // Remove system / immutable fields
  delete sanitized._id;
  delete sanitized.id;
  delete sanitized.license;
  delete sanitized.created_date;
  delete sanitized.updated_date;
  delete sanitized.createdAt;
  delete sanitized.updatedAt;
  delete sanitized.created_by;
  delete sanitized.created_by_id;
  delete sanitized.updated_by;
  delete sanitized.updated_by_id;
  delete sanitized.is_deleted;

  // Trim common string fields
  const stringFields = [
    'name',
    'itemid',
    'barcode_id',
    'sku',
    'description',
    'category_name',
    'supplier_name',
    'unit',
  ];

  stringFields.forEach((field) => {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitized[field].trim();
    }
  });

  /*
   * The GTIN is derived here, not trusted.
   *
   * This is the one funnel every create and every edit passes through, so it is
   * the only place the rule can be enforced once: a gtin is stored only when it
   * validates, and gtin14 - the zero-padded comparison form - is computed from
   * it rather than accepted from the caller.
   *
   * Anything that fails validation clears BOTH fields rather than being left
   * alone. Leaving the old value would mean a shop that corrected a mistyped
   * barcode still has the wrong global identifier attached, which is precisely
   * the error a shared database cannot recover from.
   *
   * barcode_id is deliberately NOT used as a source. It may hold an in-store
   * code, a supplier reference, or free text, and promoting that to a global
   * identifier is how a public database gets poisoned.
   */
  if (Object.prototype.hasOwnProperty.call(sanitized, 'gtin')) {
    const parsed = gtin.parse(sanitized.gtin);
    sanitized.gtin = parsed ? parsed.gtin : '';
    sanitized.gtin14 = parsed ? parsed.gtin14 : '';
  } else {
    /* Never let a caller set the comparison form directly - it is derived. */
    delete sanitized.gtin14;
  }

  return sanitized;
};

/**
 * Basic item payload validation used by the service layer.
 *
 * This is intentionally minimal to avoid breaking existing flows:
 * - For create, name is required.
 * - For update, name is optional but length is enforced when provided.
 *
 * @param {Object} data
 * @param {Object} options
 * @param {boolean} options.requireName - Whether to enforce name presence
 * @returns {{ valid: boolean, errors: string[] }}
 */
const validateItemData = (data = {}, { requireName = false } = {}) => {
  const errors = [];

  const rawName = typeof data.name === 'string' ? data.name.trim() : '';
  const hasName = rawName.length > 0;

  if (requireName && !hasName) {
    errors.push(ERROR_MESSAGES.ITEM_NAME_REQUIRED);
  }

  if (hasName) {
    if (typeof FIELD_LIMITS.NAME_MAX === 'number' && rawName.length > FIELD_LIMITS.NAME_MAX) {
      errors.push(`Item name must be at most ${FIELD_LIMITS.NAME_MAX} characters long`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

module.exports = {
  sanitizeItemData,
  validateItemData,
};
