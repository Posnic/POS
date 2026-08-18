const baseService = require('../services/base.service');
const { resolveAccess } = require('../utils/access-resolver');

/**
 * Base controller class that provides common controller functionality
 */
class BaseController {
  constructor(model = null) {
    this.model = model;
  }

  setModel(model) {
    this.model = model;
    return this;
  }

  getModel() {
    return this.model;
  }

  /**
   * Check if user has permission for a specific action
   * @param {string} resource - The resource being accessed
   * @param {string} action - The action being performed (create, read, update, delete)
   * @param {Object} user - The user object from the request
   * @returns {boolean} - True if user has permission, false otherwise
   */
  checkPermission(resource, action, user) {
    if (!user) return false;

    const role = (user.usertype || user.role || '').toLowerCase();

    // The tenant's own top accounts bypass the matrix.
    if (['super_admin', 'owner', 'admin'].includes(role)) {
      return true;
    }

    // Effective access is resolved in one place (the seam for Phase 1 roles).
    const access = resolveAccess(user);

    /*
     * Phase 2 hardening: manager and api no longer bypass the matrix
     * unconditionally.
     *
     * - A manager keeps the legacy bypass only until their account has been
     *   migrated (the login backfill stamps access.pos and upgrades their
     *   matrix to the Store Manager preset) - after that, the matrix is the
     *   authority. This is the per-account "migrated" flag, so a deploy never
     *   strands a manager mid-shift.
     * - An api account is constrained as soon as it has a formed matrix - the
     *   API form has always configured one explicitly, so the matrix is the
     *   promise. A matrix-less legacy api account keeps the old behaviour.
     */
    if (role === 'manager' || role === 'store_manager') {
      if (!access || !access.pos) return true;
    } else if (role === 'api') {
      const formed = Object.keys(access || {}).some(
        (k) => !['pos', 'pos_manager_approval', 'plan'].includes(k)
      );
      if (!formed) return true;
    }
    const normalizedResource = String(resource || '').toLowerCase();
    const normalizedAction = String(action || 'read').toLowerCase();

    const resourceMap = {
      dashboard: 'dashboard',
      sales: 'sales',
      expense: 'expense',
      expenses: 'expense',
      easytable: 'report',
      pdf: 'report',
      report: 'report',
      invoices: 'sales',
      customers: 'customer',
      supplier: 'supplier',
      category: 'category',
      item: 'item',
      branch: 'branch',
      users: 'user',
    };

    const actionMap = {
      read: 'read',
      view: 'read',
      generate: 'read',
      create: 'write',
      write: 'write',
      update: 'write',
      delete: 'delete',
      remove: 'delete',
    };

    const moduleKey = resourceMap[normalizedResource] || normalizedResource;
    const actionKey = actionMap[normalizedAction] || normalizedAction;

    if (access && moduleKey && actionKey && access[moduleKey]) {
      const moduleAcl = access[moduleKey];
      if (Object.prototype.hasOwnProperty.call(moduleAcl, actionKey)) {
        return !!moduleAcl[actionKey];
      }

      if (['read', 'view'].includes(normalizedAction) && moduleAcl.read === true) {
        return true;
      }
      if (['create', 'write', 'update'].includes(normalizedAction) && moduleAcl.write === true) {
        return true;
      }
      if (['delete', 'remove'].includes(normalizedAction) && moduleAcl.delete === true) {
        return true;
      }
    }

    /*
     * Reads are deny-by-default once a user has a formed matrix: a known
     * module missing from it is a module they were not given. Two carve-outs
     * keep old behaviour where deny would be wrong: a legacy account with no
     * matrix at all (an old session must never be bricked by a deploy), and a
     * resource outside the matrix's module set (e.g. 'setting'), which has
     * never been grantable and always read fail-open.
     */
    if (actionKey === 'read') {
      const MATRIX_MODULES = [
        'dashboard',
        'sales',
        'receiving',
        'customer',
        'supplier',
        'category',
        'item',
        'expense',
        'branch',
        'report',
        'user',
      ];
      if (!MATRIX_MODULES.includes(moduleKey)) return true;
      const formedModules = Object.keys(access || {}).filter(
        (k) => !['pos', 'pos_manager_approval', 'plan'].includes(k)
      );
      if (formedModules.length === 0) return true;
    }

    return false;
  }

  /**
   * Send success response (PHP-compatible format)
   * @param {Object} res - Express response object
   * @param {*} data - Data to send in response
   * @param {string} message - Optional success message
   * @param {number} statusCode - HTTP status code (default: 200)
   */
  success(res, data = null, message = 'Operation successful', statusCode = 200) {
    if (typeof res?.success === 'function') {
      return res.success(message, data, statusCode);
    }

    // PHP-compatible response format
    return res.status(statusCode).json({
      type: 'success', // PHP dispatcher.php always adds 'type'
      status: true, // Keep 'status' for backward compatibility
      message,
      data,
    });
  }

  /**
   * Convenience helper for 201 Created responses.
   * Some controllers (e.g. expenses_controller) call this.created(res, message, data).
   */
  created(res, message = 'Created successfully', data = null, statusCode = 201) {
    return this.success(res, data, message, statusCode);
  }

  /**
   * Legacy alias for success responses used by migrated controllers.
   * Mirrors the original PHP BaseController API.
   */
  sendResponse(res, data = null, message = 'Operation successful', statusCode = 200) {
    return this.success(res, data, message, statusCode);
  }

  /**
   * Send error response (PHP-compatible format)
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code (default: 400)
   * @param {*} errors - Optional error details
   */
  error(res, message = 'An error occurred', statusCode = 400, errors = null) {
    if (typeof res?.error === 'function') {
      return res.error(message, errors, statusCode);
    }

    // PHP-compatible response format
    const payload = {
      type: 'error', // Changed from 'status' to match PHP
      status: false,
      message,
      data: errors || null, // Always include data field
      // Note: 'code' field removed to match PHP exactly
    };

    return res.status(statusCode).json(payload);
  }

  /**
   * Helper for validation error responses (mirrors PHP style).
   * Used by controllers that manually run express-validator.
   */
  validationError(res, message = 'Validation failed', errors = []) {
    return this.error(res, message, 422, errors);
  }

  /**
   * Wrapper for error responses that mirrors the older BaseController API.
   */
  sendError(res, message = 'An error occurred', statusCode = 400, errors = null) {
    return this.error(res, message, statusCode, errors);
  }

  /**
   * Send not found response
   * @param {Object} res - Express response object
   * @param {string} message - Optional custom message
   */
  notFound(res, message = 'Resource not found') {
    this.error(res, message, 404);
  }

  /**
   * Send unauthorized response
   * @param {Object} res - Express response object
   * @param {string} message - Optional custom message
   */
  unauthorized(res, message = 'Unauthorized') {
    this.error(res, message, 401);
  }

  /**
   * Send forbidden response
   * @param {Object} res - Express response object
   * @param {string} message - Optional custom message
   */
  forbidden(res, message = 'Forbidden') {
    this.error(res, message, 403);
  }

  /**
   * Convert MongoDB ObjectIDs to strings in nested objects/arrays
   * @param {Object|Array} data - Data to process
   * @returns {Object|Array} Processed data with ObjectIDs converted to strings
   */
  mongoIDFilter(data) {
    if (!data) return data;

    const process = (item) => {
      if (!item || typeof item !== 'object') return item;

      // Preserve Date and ObjectId instances — spreading them creates empty {}
      if (item instanceof Date) return item;
      if (item._bsontype) return item;

      // Create a new object to avoid modifying read-only properties
      const processed = Array.isArray(item) ? [...item] : { ...item };

      // Convert _id to string if it's an ObjectId
      if (processed._id && typeof processed._id === 'object' && processed._id.toString) {
        processed._id = processed._id.toString();
      }

      // Recursively process nested objects
      for (const key in processed) {
        if (Object.prototype.hasOwnProperty.call(processed, key) && key !== '_id') {
          if (typeof processed[key] === 'object' && processed[key] !== null) {
            processed[key] = process(processed[key]);
          }
        }
      }

      return processed;
    };

    return Array.isArray(data) ? data.map(process) : process(data);
  }

  /**
   * Convert MongoDB date fields to formatted string_date
   * Mirrors PHP MongoDateFilter behavior
   * @param {Object|Array} data - Data to process
   * @returns {Object|Array} Processed data with string_date field added
   */
  mongoDateFilter(data) {
    if (!data) return data;

    const { formatDate } = require('../utils/helpers');

    const process = (item) => {
      if (!item || typeof item !== 'object') return item;

      const processed = { ...item };

      // Use fallback logic for date field (matches PHP behavior)
      const dateSource =
        processed.updated_date ||
        processed.updatedAt ||
        processed.date ||
        processed.created_date ||
        processed.createdAt ||
        null;

      processed.string_date = dateSource ? formatDate(dateSource) : '';

      return processed;
    };

    return Array.isArray(data) ? data.map(process) : process(data);
  }

  /**
   * Format report response with proper pagination (no NaN values)
   * @param {Object} res - Express response object
   * @param {Object} result - Result from model (with status, list, pagination)
   * @param {Object} options - Original request options (limit, page)
   * @returns {Object} Formatted response
   */
  formatReportResponse(res, result, options = {}) {
    const limit = options.limit || 5;
    const page = options.page || 1;

    if (result.status === true || result.status === undefined) {
      // Apply MongoDB ID filter
      const filteredList = this.mongoIDFilter(result.list || result.data?.list || []);

      // Get pagination from result or create safe defaults
      const pagination = result.pagination || result.data?.pagination || {};
      const total = pagination.total || 0;
      const safePages = Math.max(Math.ceil(total / limit), 1);
      const currentPage = pagination.page || page;

      return this.success(
        res,
        {
          list: filteredList,
          total: total,
          total_pages: safePages,
          current_page: currentPage,
          per_page: limit,
        },
        filteredList.length > 0 ? result.message || 'success' : 'No records found'
      );
    } else {
      // Even on error, return empty list with proper structure
      return this.success(
        res,
        {
          list: [],
          total: 0,
          total_pages: 1,
          current_page: page,
          per_page: limit,
        },
        'No records found'
      );
    }
  }

  /**
   * Get autocomplete suggestions for report fields with branch filter
   * Endpoint: GET /base/autoSuggestionReportTableField
   */
  async autoSuggestionReportTableField(req, res) {
    try {
      const query = req.query?.query || '';
      const field = req.query?.field || 'name';
      const collection = req.query?.module || req.query?.collection || '';

      const branchParam = req.query?.branch || req.query?.['branch[]'] || [];

      const branchIds = req.tenantContext?.branchId
        ? [String(req.tenantContext.branchId)]
        : Array.isArray(branchParam)
          ? branchParam
          : branchParam
            ? [branchParam]
            : [];

      const result = await baseService.getReportAutoSuggestions(
        query,
        field,
        collection,
        branchIds,
        req.user
      );

      if (result.status === true) {
        return res.status(200).json({
          query,
          suggestions: result.data,
        });
      }

      return this.error(res, 'Not Found', 404, result.data);
    } catch (error) {
      return this.error(res, error?.message || 'Auto suggestion report table field failed', 500);
    }
  }

  /**
   * Get autocomplete suggestions for table fields
   * Endpoint: GET /base/autoSuggestionTableField
   */
  async autoSuggestionTableField(req, res) {
    try {
      const query = req.query?.query || '';
      const field = req.query?.field || 'name';
      const collection = req.query?.module || req.query?.collection || '';

      const result = await baseService.getAutoSuggestions(field, collection, query, req.user);

      if (result.status === true) {
        return res.status(200).json({
          query,
          suggestions: result.data,
        });
      }

      return this.error(res, 'Not Found', 404, result.data);
    } catch (error) {
      return this.error(res, error?.message || 'Auto suggestion table field failed', 500);
    }
  }

  /**
   * Get default suggestions for customers/suppliers
   * PHP: base.php -> getDefaultSuggest()
   * Endpoint: GET /base/getDefaultSuggest
   */
  async getDefaultSuggest(req, res) {
    try {
      const query = req.query?.query || '';
      const collection = req.query?.module || '';

      if (!collection) {
        return this.error(res, 'Module parameter is required', 400);
      }

      const result = await baseService.getDefaultSuggestions(collection, query, req.user);

      if (result.status === true) {
        return res.status(200).json({
          query,
          suggestions: result.data,
        });
      }

      return this.error(res, 'Not Found', 404, result.data);
    } catch (error) {
      return this.error(res, error?.message || 'Default suggestion failed', 500);
    }
  }
}

module.exports = BaseController;
