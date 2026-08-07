// src/helpers/stock-logs.helper.js
// Helper utilities for Stock Logs module

/**
 * Apply created_date range filter to a MongoDB query object.
 * Mirrors the inline behaviour used in StockLogModel for
 * getStockLogs and exportStockLogs.
 *
 * @param {Object} query
 * @param {Object} filters
 * @returns {Object}
 */
const applyCreatedDateRangeFilter = (query, filters = {}) => {
  if (!filters.created_date) {
    return query;
  }

  if (filters.created_date.$gte) {
    query.created_date = {
      ...query.created_date,
      $gte: new Date(filters.created_date.$gte),
    };
  }

  if (filters.created_date.$lte) {
    query.created_date = {
      ...query.created_date,
      $lte: new Date(filters.created_date.$lte),
    };
  }

  return query;
};

/**
 * Apply date range filters for any date field to a MongoDB query object.
 * Supports created_date, updated_date, date, deleted_at, etc.
 * Mirrors PHP's assignFilterObjects behavior for date fields.
 *
 * @param {Object} query - MongoDB query object to modify
 * @param {Object} filters - Filter object containing date range filters
 * @returns {Object} - Modified query object
 */
const applyDateRangeFilters = (query, filters = {}) => {
  const dateFields = ['created_date', 'updated_date', 'date', 'deleted_at'];

  dateFields.forEach((field) => {
    if (filters[field]) {
      if (filters[field].$gte) {
        // Parse date string manually to avoid timezone issues
        const gteDateStr = filters[field].$gte.trim();
        // Extract date parts from "YYYY/MM/DD 12:00 AM" format
        const dateMatch = gteDateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          const gteDate = new Date(
            Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0)
          );
          query[field] = {
            ...query[field],
            $gte: gteDate,
          };
        }
      }

      if (filters[field].$lte) {
        // Parse date string manually to avoid timezone issues
        const lteDateStr = filters[field].$lte.trim();
        // Extract date parts from "YYYY/MM/DD 11:59 PM" format
        const dateMatch = lteDateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          const lteDate = new Date(
            Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 23, 59, 59, 999)
          );
          query[field] = {
            ...query[field],
            $lte: lteDate,
          };
        }
      }

      if (filters[field].$gt) {
        const gtDateStr = filters[field].$gt.trim();
        const dateMatch = gtDateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          const gtDate = new Date(
            Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0)
          );
          query[field] = {
            ...query[field],
            $gt: gtDate,
          };
        }
      }

      if (filters[field].$lt) {
        const ltDateStr = filters[field].$lt.trim();
        const dateMatch = ltDateStr.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          const ltDate = new Date(
            Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 23, 59, 59, 999)
          );
          query[field] = {
            ...query[field],
            $lt: ltDate,
          };
        }
      }
    }
  });

  return query;
};

module.exports = {
  applyCreatedDateRangeFilter,
  applyDateRangeFilters,
};
