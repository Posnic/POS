/**
 * Register Helper Functions
 * Utility helpers for register-related operations.
 */

const { formatDate } = require('../utils/helpers');

/**
 * Format date to match legacy register date formatting for registers.
 * Thin wrapper around shared utils/helpers.js formatDate to keep
 * a single source of date-formatting logic.
 *
 * @param {Date|string|number|Object} date
 * @returns {string}
 */
const formatRegisterDate = (date) => {
  return formatDate(date);
};

/**
 * Apply Mongo register date filter (matches PHP MongoRegisterDateFilter)
 * Adds string_date based on updated_date field.
 *
 * @param {Array<Object>} data
 * @returns {Array<Object>} filtered array with string_date field
 */
const mongoRegisterDateFilter = (data) => {
  if (!data || !Array.isArray(data)) return data;

  const results = [];
  data.forEach((details) => {
    const timestamp = details.updated_date;
    const result = {
      string_date: formatRegisterDate(timestamp),
      ...details,
    };
    results.push(result);
  });
  return results;
};

module.exports = {
  formatRegisterDate,
  mongoRegisterDateFilter,
};
