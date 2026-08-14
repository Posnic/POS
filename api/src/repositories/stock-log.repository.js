// src/repositories/stock-logs.repository.js
// Repository layer for Stock Logs module.
// Handles all database operations for the stocklogs collection.

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../constants/stock-logs.constants');
const { applyDateRangeFilters } = require('../helpers/stock-logs.helper');

class StockLogsRepository extends BaseModel {
  constructor() {
    super('stocklogs');
  }

  /**
   * Get paginated stock logs with filters (mirrors StockLogModel.getStockLogs)
   * @param {Object} filters
   * @param {Object} options
   * @returns {Promise<{status:boolean,data:any,message:string}>}
   */
  async getStockLogs(filters = {}, options = {}) {
    try {
      const { page = 1, limit = 10, sort = { _id: -1 } } = options;

      // Build the query with soft-delete filtering; apply license and branch when set
      const query = {
        ...filters,
        is_deleted: { $ne: true },
      };

      if (BaseModel.license) {
        query.license = BaseModel.license;
      }

      if (BaseModel.currentBranch) {
        query.branch_id = BaseModel.currentBranch;
      }

      // Apply date range filters for all date fields (created_date, updated_date, etc.)
      applyDateRangeFilters(query, filters);

      // Get paginated results using BaseModel.page helper.
      // Signature: page(collectionName, limitCheck, filter, options, fields)
      const result = await this.page(
        this.collectionName,
        {}, // no plan/limit check for stock logs
        query,
        {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          sort,
        }
      );

      if (!result.status) {
        throw new Error(result.message || ERROR_MESSAGES.FAILED_TO_FETCH_STOCK_LOGS);
      }

      return {
        status: true,
        data: result.data,
        message: SUCCESS_MESSAGES.STOCK_LOGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.getStockLogs:', error);
      return {
        status: false,
        data: null,
        message: error.message || ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOGS,
      };
    }
  }

  /**
   * Get stock log details by ID (mirrors StockLogModel.getStockLogDetail)
   * @param {string} id
   */
  async getStockLogDetail(id) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const query = {
        _id: new ObjectId(id),
        is_deleted: { $ne: true },
      };

      if (BaseModel.license) {
        query.license = BaseModel.license;
      }

      const log = await collection.findOne(query);

      if (!log) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.STOCK_LOG_NOT_FOUND,
        };
      }

      return {
        status: true,
        data: BaseModel.simplifyFields(log),
        message: SUCCESS_MESSAGES.STOCK_LOG_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.getStockLogDetail:', error);
      return {
        status: false,
        data: null,
        message: error.message || ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOG,
      };
    }
  }

  /**
   * Create a new stock log entry (mirrors StockLogModel.createStockLog)
   * @param {Object} logData
   */
  async createStockLog(logData) {
    try {
      const collection = await this.getCollection(this.collectionName);

      // PHP uses passed stocklog status (true/false), not hardcoded true
      const stockLogStatus = logData.stocklog !== undefined ? logData.stocklog : true;

      // PHP conditionally sets opening_balance and closing_balance based on stockLogStatus
      const openingBalance = stockLogStatus === true ? logData.opening_balance : 'N/A';
      const closingBalance = stockLogStatus === true ? logData.closing_balance : 'N/A';

      // PHP uses passed date for created_date and updated_date, not current time
      const logDate = logData.date || new Date();

      // Build new log entry matching PHP insertOne exactly (no is_deleted field!)
      // PHP stock_model.php:90-109 - explicit field list
      const newLog = {
        branch_id: logData.branch_id || BaseModel.currentBranch,
        view_item_id: logData.view_item_id,
        item_barcode_id: logData.item_barcode_id,
        item_name: logData.item_name,
        item_quantity: logData.item_quantity,
        process: logData.process,
        reference: logData.reference,
        // Optional free-text reason (e.g. from a bulk stock update). Empty for
        // the many callers that do not set one, so the field is always present.
        note: logData.note || '',
        date: logDate,
        created_date: logDate,
        updated_date: logDate,
        action: logData.action,
        stocklog: stockLogStatus,
        opening_balance: openingBalance,
        closing_balance: closingBalance,
        count: logData.count,
        changed_by: logData.changed_by,
        changed_by_userid: logData.changed_by_userid,
        license: BaseModel.license,
      };

      // Convert string IDs to ObjectId safely (check if already ObjectId)
      if (newLog.view_item_id && !(newLog.view_item_id instanceof ObjectId)) {
        newLog.view_item_id = new ObjectId(newLog.view_item_id);
      }
      if (newLog.changed_by_userid && !(newLog.changed_by_userid instanceof ObjectId)) {
        newLog.changed_by_userid = new ObjectId(newLog.changed_by_userid);
      }
      if (newLog.branch_id && !(newLog.branch_id instanceof ObjectId)) {
        newLog.branch_id = new ObjectId(newLog.branch_id);
      }

      console.log('[STOCK LOG] Creating stock log:', {
        process: newLog.process,
        item_name: newLog.item_name,
        action: newLog.action,
        branch_id: newLog.branch_id?.toString(),
        view_item_id: newLog.view_item_id?.toString(),
      });

      const result = await collection.insertOne(newLog);

      console.log('[STOCK LOG] Stock log created successfully:', result.insertedId.toString());

      return {
        status: true,
        data: { _id: result.insertedId, ...newLog },
        message: SUCCESS_MESSAGES.STOCK_LOG_CREATED,
      };
    } catch (error) {
      console.error('[STOCK LOG ERROR] Failed to create stock log:', error);
      console.error('[STOCK LOG ERROR] Input data:', logData);
      return {
        status: false,
        data: null,
        message: error.message || ERROR_MESSAGES.FAILED_TO_CREATE_STOCK_LOG,
      };
    }
  }

  /**
   * Soft delete stock logs (mirrors StockLogModel.deleteStockLogs)
   * @param {Array<string>} ids
   */
  async deleteStockLogs(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED,
        };
      }

      const collection = await this.getCollection(this.collectionName);
      const objectIds = ids.map((id) => new ObjectId(id));
      const now = new Date();

      // First get the logs to be deleted for backup
      const logsToDelete = await collection
        .find({
          _id: { $in: objectIds },
          license: BaseModel.license,
        })
        .toArray();

      // Create backup before soft delete
      await Promise.all(
        logsToDelete.map((log) =>
          BaseModel.deletedDocumentBackup(this.collectionName, {
            document_id: log._id,
            deleted_by: BaseModel.loggedUser,
            deleted_at: now,
            data: log,
          })
        )
      );

      // Perform soft delete
      const result = await collection.updateMany(
        {
          _id: { $in: objectIds },
          license: BaseModel.license,
        },
        {
          $set: {
            is_deleted: true,
            deleted_at: now,
            deleted_by: BaseModel.loggedUser,
          },
        }
      );

      if (result.matchedCount === 0) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.NO_MATCHING_STOCK_LOGS,
        };
      }

      return {
        status: true,
        data: { deletedCount: result.modifiedCount },
        message: SUCCESS_MESSAGES.STOCK_LOGS_DELETED,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.deleteStockLogs:', error);
      return {
        status: false,
        data: null,
        message: error.message || ERROR_MESSAGES.FAILED_TO_DELETE_STOCK_LOGS,
      };
    }
  }

  /**
   * Export stock logs (mirrors StockLogModel.exportStockLogs)
   * @param {Object} filters
   */
  async exportStockLogs(filters = {}) {
    try {
      const query = {
        ...filters,
        license: BaseModel.license,
        is_deleted: { $ne: true },
      };

      // Apply date range filters for all date fields (created_date, updated_date, etc.)
      applyDateRangeFilters(query, filters);

      const collection = await this.getCollection(this.collectionName);
      const logs = await collection.find(query).sort({ created_date: -1 }).toArray();

      // Format data for export
      const exportData = logs.map((log) => ({
        Date: log.date ? new Date(log.date).toLocaleString() : '',
        'Item Name': log.item_name || '',
        Barcode: log.item_barcode_id || '',
        Quantity: log.item_quantity || '',
        Process: log.process || '',
        Reference: log.reference || '',
        Action: log.action || '',
        'Changed By': log.changed_by || '',
        'Opening Balance': log.opening_balance || '',
        'Closing Balance': log.closing_balance || '',
      }));

      return {
        status: true,
        data: exportData,
        message: SUCCESS_MESSAGES.STOCK_LOGS_EXPORTED,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.exportStockLogs:', error);
      return {
        status: false,
        data: null,
        message: error.message || ERROR_MESSAGES.FAILED_TO_EXPORT_STOCK_LOGS,
      };
    }
  }

  /**
   * Update item name in all stock logs (mirrors PHP StockModel.updateItemNameStockModel)
   * @param {string} itemId - Item ID
   * @param {string} newItemName - New item name
   */
  async updateItemNameInStockLogs(itemId, newItemName) {
    try {
      if (!itemId || !newItemName) {
        return {
          status: false,
          data: null,
          message: 'Item ID and new item name are required',
        };
      }

      const collection = await this.getCollection(this.collectionName);
      const result = await collection.updateMany(
        {
          view_item_id: new ObjectId(itemId),
          license: BaseModel.license,
        },
        {
          $set: {
            item_name: newItemName,
            updated_date: new Date(),
          },
        }
      );

      return {
        status: true,
        data: { modifiedCount: result.modifiedCount },
        message: `Item name updated in ${result.modifiedCount} stock log(s)`,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.updateItemNameInStockLogs:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to update item name in stock logs',
      };
    }
  }

  /**
   * Cleanup old soft-deleted records (older than specified days)
   * @param {number} daysOld - Number of days old (default: 90)
   */
  async cleanupOldDeletedLogs(daysOld = 90) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Find logs to be permanently deleted
      const logsToDelete = await collection
        .find({
          is_deleted: true,
          deleted_at: { $lte: cutoffDate },
          license: BaseModel.license,
        })
        .toArray();

      if (logsToDelete.length === 0) {
        return {
          status: true,
          data: { deletedCount: 0 },
          message: 'No old deleted logs to cleanup',
        };
      }

      // Permanently delete old soft-deleted records
      const result = await collection.deleteMany({
        is_deleted: true,
        deleted_at: { $lte: cutoffDate },
        license: BaseModel.license,
      });

      return {
        status: true,
        data: { deletedCount: result.deletedCount },
        message: `Permanently deleted ${result.deletedCount} old stock log(s)`,
      };
    } catch (error) {
      console.error('Error in StockLogsRepository.cleanupOldDeletedLogs:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to cleanup old deleted logs',
      };
    }
  }
}

module.exports = StockLogsRepository;
