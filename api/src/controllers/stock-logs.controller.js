// src/controllers/stock_log_controller.js
const BaseController = require('./base.controller');
const BaseModel = require('../models/base.model');
const branchesService = require('../services/branch.service');
const StockLogsService = require('../services/stock-log.service');
const { validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
} = require('../constants/stock-logs.constants');

class StockLogController extends BaseController {
  constructor() {
    super();
    this.service = new StockLogsService();
  }

  /**
   * Set BaseModel context (branch, license, user) for operations that
   * need accurate audit/backup information. Mirrors the inline logic
   * previously used in delete(), but routes branch lookups through the
   * branches service instead of the Branch model directly.
   */
  async setRequestContext(req) {
    const user = req.user || {};

    const sessionBranchId =
      req.tenantContext?.branchId ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      user.branch_id ||
      user.branch?._id;

    if (sessionBranchId) {
      BaseModel.currentBranch = ObjectId.isValid(sessionBranchId)
        ? new ObjectId(sessionBranchId)
        : sessionBranchId;
    }

    let branchName =
      req.tenantContext?.branchName || user.branch_name || user.branch?.branch_name || '';

    // Fetch branch_name from DB via branchesService if empty
    if (sessionBranchId && !branchName) {
      try {
        const branch = await branchesService.getBranchById(sessionBranchId, {
          lean: true,
        });
        if (branch?.branch_name) {
          branchName = branch.branch_name.trim();
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    if (branchName) {
      BaseModel.currentBranchName = branchName;
    }

    if (req.tenantContext?.licenseId || user.license || user.license_id) {
      const license = req.tenantContext?.licenseId || user.license || user.license_id;
      BaseModel.license = ObjectId.isValid(license) ? new ObjectId(license) : license;
    }

    if (user._id) {
      BaseModel.loggedUser = ObjectId.isValid(user._id) ? new ObjectId(user._id) : user._id;
      BaseModel.loggedUserName = user.name || user.username || user.email || '';
    }
  }

  /**
   * Get all stock logs with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAll(req, res) {
    try {
      // Set BaseModel context for branch and license filtering
      await this.setRequestContext(req);

      const { page = 1, limit = 10, filters = '{}' } = req.query;
      let parsedFilters = {};

      try {
        parsedFilters = JSON.parse(filters);
      } catch (error) {
        return this.sendError(
          res,
          ERROR_MESSAGES.INVALID_FILTERS_FORMAT,
          HTTP_STATUS.BAD_REQUEST,
          {}
        );
      }

      const parsedPage = parseInt(page);
      const result = await this.service.getStockLogs(parsedFilters, {
        page: parsedPage && parsedPage > 0 ? parsedPage : 1,
        limit: parseInt(limit) || 10,
      });

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.NOT_FOUND, {});
      }

      // Apply MongoDateFilter to add string_date field (mirrors PHP base.php MongoDateFilter)
      if (result.data && result.data.list) {
        result.data.list = this.mongoDateFilter(result.data.list);

        // Convert date fields to MongoDB extended JSON format to match PHP
        result.data.list = result.data.list.map((item) => {
          const processedItem = { ...item };

          // Convert string dates to Date objects first, then to MongoDB format
          if (processedItem.date) {
            const dateObj = new Date(processedItem.date);
            if (!isNaN(dateObj.getTime())) {
              processedItem.date = {
                $date: {
                  $numberLong: dateObj.getTime().toString(),
                },
              };
            }
          }

          if (processedItem.created_date) {
            // Handle formatted string like "04/13/2026 09:16 am"
            const dateStr = processedItem.created_date;
            let dateObj;

            // Try parsing the formatted string
            if (typeof dateStr === 'string') {
              // Convert "04/13/2026 09:16 am" to Date object
              const parts = dateStr.match(
                /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(am|pm)/i
              );
              if (parts) {
                const [, month, day, year, hours, minutes, period] = parts;
                let hour24 = parseInt(hours);
                if (period.toLowerCase() === 'pm' && hour24 !== 12) {
                  hour24 += 12;
                } else if (period.toLowerCase() === 'am' && hour24 === 12) {
                  hour24 = 0;
                }
                dateObj = new Date(
                  parseInt(year),
                  parseInt(month) - 1,
                  parseInt(day),
                  hour24,
                  parseInt(minutes)
                );
              } else {
                dateObj = new Date(dateStr);
              }
            } else {
              dateObj = new Date(dateStr);
            }

            if (!isNaN(dateObj.getTime())) {
              processedItem.created_date = {
                $date: {
                  $numberLong: dateObj.getTime().toString(),
                },
              };
            }
          }

          if (processedItem.updated_date) {
            // Handle formatted string like "04/13/2026 09:16 am"
            const dateStr = processedItem.updated_date;
            let dateObj;

            // Try parsing the formatted string
            if (typeof dateStr === 'string') {
              // Convert "04/13/2026 09:16 am" to Date object
              const parts = dateStr.match(
                /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(am|pm)/i
              );
              if (parts) {
                const [, month, day, year, hours, minutes, period] = parts;
                let hour24 = parseInt(hours);
                if (period.toLowerCase() === 'pm' && hour24 !== 12) {
                  hour24 += 12;
                } else if (period.toLowerCase() === 'am' && hour24 === 12) {
                  hour24 = 0;
                }
                dateObj = new Date(
                  parseInt(year),
                  parseInt(month) - 1,
                  parseInt(day),
                  hour24,
                  parseInt(minutes)
                );
              } else {
                dateObj = new Date(dateStr);
              }
            } else {
              dateObj = new Date(dateStr);
            }

            if (!isNaN(dateObj.getTime())) {
              processedItem.updated_date = {
                $date: {
                  $numberLong: dateObj.getTime().toString(),
                },
              };
            }
          }

          return processedItem;
        });
      }

      this.sendResponse(res, result.data, 'success');
    } catch (error) {
      console.error('Error in StockLogController.getAll:', error);
      this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOGS,
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * Get stock log by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const result = await this.service.getStockLogDetail(id);

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.NOT_FOUND, {});
      }

      this.sendResponse(res, result.data, 'success');
    } catch (error) {
      console.error('Error in StockLogController.getOne:', error);
      this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_STOCK_LOG,
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * Create a new stock log
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async create(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return this.sendError(
          res,
          ERROR_MESSAGES.VALIDATION_FAILED,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          errors.array()
        );
      }

      const logData = req.body;
      const result = await this.service.createStockLog(logData);

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.BAD_REQUEST, {});
      }

      this.sendResponse(res, result.data, result.message, HTTP_STATUS.CREATED);
    } catch (error) {
      console.error('Error in StockLogController.create:', error);
      this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_CREATE_STOCK_LOG,
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * Delete stock logs
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async delete(req, res) {
    try {
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return this.sendError(
          res,
          ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED,
          HTTP_STATUS.BAD_REQUEST,
          {}
        );
      }
      // Set BaseModel context for backup and license scoping
      await this.setRequestContext(req);

      const result = await this.service.deleteStockLogs(ids);

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.BAD_REQUEST, {});
      }

      this.sendResponse(res, result.data, 'success');
    } catch (error) {
      console.error('Error in StockLogController.delete:', error);
      this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_DELETE_STOCK_LOGS,
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * Export stock logs
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async export(req, res) {
    try {
      // Frontend sends JSON.stringify(selectedTableRow) which is an array: ["id1", "id2", "id3"]
      // Express body-parser with application/json parses this into req.body as an array
      let ids = [];

      if (Array.isArray(req.body)) {
        // Direct array from POST body
        ids = req.body;
      } else if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        // Object with numeric keys like {"0":"id1","1":"id2"} - convert to array
        ids = Object.values(req.body);
      } else if (req.body && Array.isArray(req.body.data)) {
        // Wrapped in data property
        ids = req.body.data;
      } else if (typeof req.body === 'string') {
        // In case body-parser didn't parse it
        try {
          ids = JSON.parse(req.body);
        } catch (error) {
          console.error('Failed to parse req.body as JSON:', error);
        }
      }

      let parsedFilters = {};

      // If specific IDs are selected, filter by those IDs
      if (Array.isArray(ids) && ids.length > 0) {
        // Convert string IDs to ObjectId
        const objectIds = ids
          .map((id) => {
            try {
              return new ObjectId(id);
            } catch (error) {
              console.error(`Invalid ObjectId: ${id}`);
              return null;
            }
          })
          .filter((id) => id !== null);

        if (objectIds.length > 0) {
          parsedFilters = {
            _id: { $in: objectIds },
          };
        }
      }

      const result = await this.service.exportStockLogs(parsedFilters);

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.BAD_REQUEST, {});
      }

      // Return JSON response like PHP version
      this.sendResponse(res, result.data, SUCCESS_MESSAGES.STOCK_EXPORTED);
    } catch (error) {
      console.error('Error in StockLogController.export:', error);
      this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_EXPORT_STOCK_LOGS,
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * PHP: exportStocklogs()
   * Alias for export() to match PHP method name exactly
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async exportStocklogs(req, res) {
    return this.export(req, res);
  }

  /**
   * Update item name in all stock logs for a specific item
   * Mirrors PHP StockModel.updateItemNameStockModel
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateItemName(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return this.sendError(
          res,
          ERROR_MESSAGES.VALIDATION_FAILED,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          errors.array()
        );
      }

      const { itemId } = req.params;
      const { item_name } = req.body;

      const result = await this.service.updateItemNameInStockLogs(itemId, item_name);

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.BAD_REQUEST, {});
      }

      this.sendResponse(res, result.data, 'success');
    } catch (error) {
      console.error('Error in StockLogController.updateItemName:', error);
      this.sendError(
        res,
        'Failed to update item name in stock logs',
        HTTP_STATUS.INTERNAL_ERROR,
        {}
      );
    }
  }

  /**
   * Cleanup old soft-deleted stock logs
   * Permanently deletes records older than specified days
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async cleanupOldDeletedLogs(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return this.sendError(
          res,
          ERROR_MESSAGES.VALIDATION_FAILED,
          HTTP_STATUS.UNPROCESSABLE_ENTITY,
          errors.array()
        );
      }

      const { daysOld = 90 } = req.body;

      const result = await this.service.cleanupOldDeletedLogs(parseInt(daysOld, 10));

      if (!result.status) {
        return this.sendError(res, result.message, HTTP_STATUS.BAD_REQUEST, {});
      }

      this.sendResponse(res, result.data, 'success');
    } catch (error) {
      console.error('Error in StockLogController.cleanupOldDeletedLogs:', error);
      this.sendError(res, 'Failed to cleanup old deleted logs', HTTP_STATUS.INTERNAL_ERROR, {});
    }
  }
}

module.exports = new StockLogController();
