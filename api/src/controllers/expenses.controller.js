const BaseController = require('./base.controller');
const ExpenseService = require('../services/expense.service');
const ExpenseModel = require('../models/expense.model');
const BaseModel = require('../models/base.model');
const Branch = require('../models/branch.model');
const { ObjectId } = require('mongodb');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');

/**
 * Expense Controller (Refactored)
 * Follows layered architecture: Route → Controller → Service → Repository → Model
 *
 * Responsibilities:
 * - Handle HTTP requests/responses
 * - Validate input
 * - Call service layer for business logic
 * - Format responses
 *
 * Note: Keeps ExpenseModel for legacy methods (reports, import/export, sync)
 */
class ExpensesController extends BaseController {
  constructor() {
    super();
    this.service = new ExpenseService();
    this.model = new ExpenseModel(); // For legacy methods
  }

  /**
   * Set request context (branch, license, user)
   * Propagate to BaseModel static fields for repository access
   */
  async setRequestContext(req) {
    const user = req.user || {};
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

    // Prioritize session branch_id for current logged-in branch
    const branchParam =
      req.tenantContext?.branchId ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      req.query?.branch_id ||
      req.query?.branch ||
      req.body?.branch_id ||
      req.body?.branch ||
      user.branch_id ||
      user.branch?._id ||
      user.default_branch_id ||
      branchAccessEntry?.branch_id ||
      branchAccessEntry?._id ||
      null;

    const branchId = Array.isArray(branchParam) ? branchParam[0] : branchParam;
    const licenseId = req.tenantContext?.licenseId || user.license || user.license_id;
    const loggedUserId = user._id;
    const userName = user.name || user.username || user.email;
    let branchName =
      req.tenantContext?.branchName ||
      branchAccessEntry?.branch_name ||
      user.branch_name ||
      user.branch?.branch_name ||
      '';

    // Fetch branch_name from DB if empty - matches PHP behavior
    if (branchId && !branchName) {
      try {
        const branch = await (
          req.tenantContext
            ? Branch.findOne({ _id: branchId, license: req.tenantContext.licenseId })
            : Branch.findById(branchId)
        )
          .select('branch_name')
          .lean();
        if (branch?.branch_name) {
          branchName = branch.branch_name.trim();
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    // Store context for use in controller methods
    this.user = user;
    this.branch = branchId;
    this.license = licenseId;
    this.branchName = branchName;

    // Propagate to BaseModel for repository access
    if (branchId) {
      if (branchId instanceof ObjectId) {
        BaseModel.currentBranch = branchId;
      } else if (ObjectId.isValid(String(branchId))) {
        BaseModel.currentBranch = new ObjectId(String(branchId));
      }
    }

    if (licenseId) {
      if (licenseId instanceof ObjectId) {
        BaseModel.license = licenseId;
      } else if (ObjectId.isValid(String(licenseId))) {
        BaseModel.license = new ObjectId(String(licenseId));
      }
    }

    if (loggedUserId) {
      if (loggedUserId instanceof ObjectId) {
        BaseModel.loggedUser = loggedUserId;
      } else if (ObjectId.isValid(String(loggedUserId))) {
        BaseModel.loggedUser = new ObjectId(String(loggedUserId));
      }
    }

    if (userName) {
      BaseModel.loggedUserName = userName;
    }

    if (branchName) {
      BaseModel.currentBranchName = branchName;
    }
  }

  async ensureContext(req) {
    await this.setRequestContext(req);
  }

  /**
   * Get all expenses with pagination and filters
   * GET /expenses
   */
  getAll = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    if (!this.checkPermission('expense', 'read', req.user)) {
      return this.forbidden(res, 'You do not have permission to view expenses');
    }

    const { page = 1, limit = 10, ...filters } = req.query;

    // Parse filters if they're sent as JSON string
    let parsedFilters = {};
    if (filters.filters) {
      try {
        parsedFilters = JSON.parse(filters.filters);

        // Convert date strings to Date objects for MongoDB queries
        if (parsedFilters.updated_date) {
          if (parsedFilters.updated_date.$gte) {
            parsedFilters.updated_date.$gte = new Date(parsedFilters.updated_date.$gte.trim());
          }
          if (parsedFilters.updated_date.$lte) {
            parsedFilters.updated_date.$lte = new Date(parsedFilters.updated_date.$lte.trim());
          }
        }
        if (parsedFilters.created_date) {
          if (parsedFilters.created_date.$gte) {
            parsedFilters.created_date.$gte = new Date(parsedFilters.created_date.$gte.trim());
          }
          if (parsedFilters.created_date.$lte) {
            parsedFilters.created_date.$lte = new Date(parsedFilters.created_date.$lte.trim());
          }
        }
        if (parsedFilters.date) {
          if (parsedFilters.date.$gte) {
            parsedFilters.date.$gte = new Date(parsedFilters.date.$gte.trim());
          }
          if (parsedFilters.date.$lte) {
            parsedFilters.date.$lte = new Date(parsedFilters.date.$lte.trim());
          }
        }
      } catch (e) {
        return this.error(res, 'Invalid filters format', 400);
      }
    }

    // Add branch_id filter from current session/context
    if (this.branch) {
      parsedFilters.branch_id =
        this.branch instanceof ObjectId ? this.branch : new ObjectId(String(this.branch));
    }

    const parsedPage = parseInt(page, 10);
    const options = {
      page: parsedPage && parsedPage > 0 ? parsedPage : 1,
      limit: parseInt(limit, 10) || 10,
      sort: { _id: -1 },
    };

    const result = await this.service.getAllExpenses(parsedFilters, options);

    if (result.status) {
      return this.success(res, result.data, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Get a single expense by ID
   * GET /expenses/:id
   */
  getOne = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    if (!this.checkPermission('expense', 'read', req.user)) {
      return this.forbidden(res, 'You do not have permission to view this expense');
    }

    const { id } = req.params;
    const result = await this.service.getExpenseById(id);

    if (result.status && result.data) {
      return this.success(res, result.data, result.message);
    } else {
      return this.notFound(res, result.message);
    }
  });

  /**
   * Create a new expense
   * POST /expenses
   */
  create = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    if (!this.checkPermission('expense', 'create', req.user)) {
      return this.forbidden(res, 'You do not have permission to create expenses');
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.validationError(res, 'Validation failed', errors.array());
    }

    // Prepare expense data with branch and user context
    const expenseData = {
      ...req.body,
      branch_id: this.branch ? new ObjectId(this.branch) : null,
      branch_name: this.branchName || '',
      created_by: this.user?.username || this.user?.email || 'system',
      created_by_id: this.user?._id ? new ObjectId(this.user._id) : null,
    };

    const result = await this.service.createExpense(expenseData);

    if (result.status) {
      return this.created(res, result.message, result.data);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Update an existing expense
   * PUT /expenses/:id
   */
  update = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    if (!this.checkPermission('expense', 'update', req.user)) {
      return this.forbidden(res, 'You do not have permission to update expenses');
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.validationError(res, 'Validation failed', errors.array());
    }

    const { id } = req.params;

    // Prepare update data with user context
    const updateData = {
      ...req.body,
      updated_by: this.user?.username || this.user?.email || 'system',
      updated_by_id: this.user?._id ? new ObjectId(this.user._id) : null,
    };

    const result = await this.service.updateExpense(id, updateData);

    if (result.status) {
      return this.success(res, { id }, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Delete one or more expenses
   * DELETE /expenses
   */
  delete = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    if (!this.checkPermission('expense', 'delete', req.user)) {
      return this.forbidden(res, 'You do not have permission to delete expenses');
    }

    // Support multiple legacy payload formats: { data: [...] }, { ids: [...] }, or plain array
    const ids = req.body.data || req.body.ids || req.body;

    if (!ids || (Array.isArray(ids) && ids.length === 0)) {
      return this.error(res, 'No expense IDs provided for deletion', 400);
    }

    const idArray = Array.isArray(ids) ? ids : [ids];
    const result = await this.service.deleteExpenses(idArray);

    if (result.status) {
      return this.success(res, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Get expenses report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async expensesReportTable(req, res) {
    try {
      await this.ensureContext(req);

      // Set model context for legacy report method
      this.model.branchId = this.branch;
      this.model.licenseId = this.license;
      this.model.user = this.user;
      this.model.branchName = this.branchName;

      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle branch parameter - can be 'branch' or 'branch[]' (array notation)
      let branchIds = [];
      const branchParam = req.query['branch[]'] || req.query.branch;
      if (branchParam) {
        branchIds = Array.isArray(branchParam) ? branchParam : [branchParam];
      }

      const data = {
        branchid: branchIds,
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      // Call the model method to get report data
      const result = await this.model.expensesReportPage(data, options);
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in ExpensesController.expensesReportTable:', error);
      return this.error(res, 'Failed to retrieve expenses report: ' + error.message, 500);
    }
  }

  /**
   * Filter MongoDB ObjectIDs to strings (similar to PHP MongoIDFilter)
   * @param {Array} data - Array of documents to filter
   * @returns {Array} - Filtered array with ObjectIDs converted to strings
   */
  mongoIDFilter(data) {
    if (!Array.isArray(data)) return data;

    return data.map((item) => {
      const filtered = { ...item };
      Object.keys(filtered).forEach((key) => {
        if (filtered[key] && typeof filtered[key] === 'object') {
          if (filtered[key]._id) {
            filtered[key]._id = filtered[key]._id.toString();
          }
          if (filtered[key].toString && filtered[key].constructor.name === 'ObjectID') {
            filtered[key] = filtered[key].toString();
          }
        }
      });
      if (filtered._id) {
        filtered._id = filtered._id.toString();
      }
      return filtered;
    });
  }

  /**
   * Filter MongoDB dates to ISO strings (similar to PHP MongoDateFilter)
   * @param {Array} data - Array of documents to filter
   * @returns {Array} - Filtered array with dates converted to ISO strings
   */
  mongoDateFilter(data) {
    if (!Array.isArray(data)) return data;

    return data.map((item) => {
      const filtered = { ...item };
      Object.keys(filtered).forEach((key) => {
        if (filtered[key] instanceof Date) {
          filtered[key] = filtered[key].toISOString();
        }
      });
      return filtered;
    });
  }

  /**
   * PHP: getExpenseDetails()
   * Get detailed expense information
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  getExpenseDetails = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const id = req.query.id || req.params.id;

    if (!id) {
      return this.error(res, 'Expense Id Not Found', 400);
    }

    if (!this.checkPermission('expense', 'read', req.user)) {
      return this.forbidden(res, 'You do not have permission to view this expense');
    }

    const result = await this.service.getExpenseById(id);

    if (result.status && result.data) {
      return this.success(res, result.data, result.message);
    }

    return this.error(res, result.message, 404);
  });

  /**
   * PHP: getDataChanges()
   * Get data changes for synchronization
   */
  async getDataChanges(req, res) {
    try {
      await this.ensureContext(req);

      // Set model context for legacy sync method
      this.model.branchId = this.branch;
      this.model.licenseId = this.license;
      this.model.user = this.user;
      this.model.branchName = this.branchName;

      const from = req.query.from || '';
      const result = await this.model.getDataChanges('expenses', from);

      if (result.status === true) {
        return this.success(res, result.data, 'Changes Retrieved');
      }

      // PHP returns type:error but HTTP 200 even on invalid input
      return this.error(res, 'Not valid Input', 200, result.data);
    } catch (error) {
      console.error('Error in getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: expensesImport()
   * Bulk import expenses from CSV/Excel
   */
  async expensesImport(req, res) {
    try {
      if (!this.checkPermission('expense', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const result = req.body.result || req.body.expenses || [];

      if (!Array.isArray(result) || result.length === 0) {
        return this.error(res, 'No expenses to import', 400);
      }

      // Ensure model has correct branch/license/user context
      await this.ensureContext(req);

      // Set model context for legacy import method
      this.model.branchId = this.branch;
      this.model.licenseId = this.license;
      this.model.user = this.user;
      this.model.branchName = this.branchName;

      const importResult = await this.model.importExpensesModel(result);

      if (importResult.status === true) {
        return this.success(res, importResult.data, importResult.message);
      } else {
        return this.error(res, importResult.message, 404, importResult.data);
      }
    } catch (error) {
      console.error('Error in expensesImport:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportExpenses()
   * Export expenses for CSV (frontend builds CSV from JSON)
   */
  async exportExpenses(req, res) {
    try {
      await this.ensureContext(req);

      if (!this.checkPermission('expense', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Normalize legacy export payload formats (array, wrapped, or encoded)
      const normalizeExportIds = (raw) => {
        if (!raw) return [];

        if (Array.isArray(raw)) return raw;

        if (typeof raw === 'object' && raw !== null) {
          if (Array.isArray(raw.data)) return raw.data;
          if (Array.isArray(raw.ids)) return raw.ids;

          const keys = Object.keys(raw);
          if (keys.length === 1) {
            const onlyKey = keys[0];
            try {
              const parsed = JSON.parse(onlyKey);
              if (Array.isArray(parsed)) return parsed;
            } catch (e) {
              // fall through
            }
          }

          const values = Object.values(raw);
          if (values.length > 0 && values.every((v) => typeof v === 'string')) {
            return values;
          }
        }

        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            return [parsed];
          } catch (e) {
            return [raw];
          }
        }

        return [raw];
      };

      const idsArray = normalizeExportIds(req.body);

      if (!idsArray || idsArray.length === 0) {
        return this.error(res, 'No expense IDs provided', 400);
      }

      // Set model context for legacy export method
      this.model.branchId = this.branch;
      this.model.licenseId = this.license;
      this.model.user = this.user;
      this.model.branchName = this.branchName;

      const result = await this.model.exportExpensesOrder(idsArray);

      if (result.status === true) {
        // Frontend expects JSON list for CSV conversion
        return this.success(res, result.data, 'Expenses Exported Successfully');
      }

      return this.error(res, 'Expenses Not Exported', 404, result.data);
    } catch (error) {
      console.error('Error in exportExpenses:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get expense summary
   */
  async getSummary(req, res) {
    try {
      if (!this.checkPermission('expense', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { startDate, endDate } = req.query;
      const filter = {
        branch_id: req.tenantContext?.branchId,
        branch_name: req.tenantContext?.branchName,
        license: req.tenantContext?.licenseId,
      };

      if (startDate && endDate) {
        filter.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      /*
       * this.model, not Expense.
       *
       * There is no Expense in this file - the import is ExpenseModel, and this
       * line has been throwing ReferenceError on every call since it was
       * written. this.model is the ExpenseModel instance built in the
       * constructor, and BaseModel gives it aggregate().
       */
      const summary = await this.model.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total_expenses: { $sum: '$amount' },
            total_count: { $sum: 1 },
            avg_expense: { $avg: '$amount' },
          },
        },
      ]);

      const data = summary[0] || {
        total_expenses: 0,
        total_count: 0,
        avg_expense: 0,
      };

      return this.success(res, data, 'Expense summary retrieved successfully');
    } catch (error) {
      console.error('Error in getSummary:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get expenses by category
   */
  async getByCategory(req, res) {
    try {
      if (!this.checkPermission('expense', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { category } = req.params;

      /* Same as above: Expense does not exist here. BaseModel.find passes its
         options to the driver, which takes sort and limit; .lean() has no
         meaning there because the driver returns plain objects already. */
      const expenses = await this.model.find(
        {
          category,
          branch_id: req.tenantContext?.branchId,
          branch_name: req.tenantContext?.branchName,
          license: req.tenantContext?.licenseId,
        },
        { sort: { date: -1 }, limit: 100 }
      );

      return this.success(res, expenses, 'Expenses retrieved successfully');
    } catch (error) {
      console.error('Error in getByCategory:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get expenses by type (credit/debit)
   */
  async getByType(req, res) {
    try {
      if (!this.checkPermission('expense', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { type } = req.params;

      if (!['credit', 'debit'].includes(type)) {
        return this.error(res, 'Invalid expense type', 400);
      }

      const expenses = await this.model.find(
        {
          type,
          branch_id: req.tenantContext?.branchId,
          branch_name: req.tenantContext?.branchName,
          license: req.tenantContext?.licenseId,
        },
        { sort: { date: -1 }, limit: 100 }
      );

      return this.success(res, expenses, 'Expenses retrieved successfully');
    } catch (error) {
      console.error('Error in getByType:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new ExpensesController();
