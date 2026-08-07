// src/services/stock-logs.service.js
// Service layer for Stock Logs module.
// Delegates to StockLogsRepository so controllers do not access the DB layer directly.

const StockLogsRepository = require('../repositories/stock-log.repository');

class StockLogsService {
  // Keep a single optional argument for backward compatibility, but
  // ignore it and always construct a repository internally.
  constructor(/* legacyModel */) {
    this.repository = new StockLogsRepository();
  }

  /**
   * Get paginated stock logs with filters.
   * Pure business method: no HTTP, just delegates to repository.
   */
  async getStockLogs(filters = {}, options = {}) {
    return this.repository.getStockLogs(filters, options);
  }

  /**
   * Get a single stock log by ID.
   */
  async getStockLogDetail(id) {
    return this.repository.getStockLogDetail(id);
  }

  /**
   * Create a new stock log entry.
   */
  async createStockLog(logData) {
    return this.repository.createStockLog(logData);
  }

  /**
   * Soft delete stock logs by IDs.
   */
  async deleteStockLogs(ids) {
    return this.repository.deleteStockLogs(ids);
  }

  /**
   * Export stock logs based on filters.
   */
  async exportStockLogs(filters = {}) {
    return this.repository.exportStockLogs(filters);
  }

  /**
   * Update item name in all stock logs for a specific item.
   * Mirrors PHP StockModel.updateItemNameStockModel
   */
  async updateItemNameInStockLogs(itemId, newItemName) {
    return this.repository.updateItemNameInStockLogs(itemId, newItemName);
  }

  /**
   * Cleanup old soft-deleted records.
   * Permanently deletes records that have been soft-deleted for more than specified days.
   */
  async cleanupOldDeletedLogs(daysOld = 90) {
    return this.repository.cleanupOldDeletedLogs(daysOld);
  }
}

module.exports = StockLogsService;
