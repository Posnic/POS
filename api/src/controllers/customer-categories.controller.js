// src/controllers/customer-categories.controller.js
const asyncHandler = require('express-async-handler');
const { ObjectId } = require('mongodb');
const CustomerCategoryService = require('../services/customer-category.service');
const CustomerCategoryModel = require('../models/customer-category.model');
const BaseController = require('./base.controller');
const BaseModel = require('../models/base.model');

class CustomerCategoryController extends BaseController {
  constructor() {
    super();
    this.service = new CustomerCategoryService();
    this.model = new CustomerCategoryModel();
  }

  setRequestContext(req) {
    const user = req.user || {};
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

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
    const loggedUserName = user.name || user.username || user.email || '';
    const branchName =
      req.tenantContext?.branchName || user.branch_name || user.branch?.branch_name || '';

    if (branchId) {
      BaseModel.currentBranch =
        branchId instanceof ObjectId ? branchId : new ObjectId(String(branchId));
    }

    if (licenseId) {
      BaseModel.license =
        licenseId instanceof ObjectId ? licenseId : new ObjectId(String(licenseId));
    }

    if (loggedUserId) {
      BaseModel.loggedUser =
        loggedUserId instanceof ObjectId ? loggedUserId : new ObjectId(String(loggedUserId));
    }

    if (loggedUserName) {
      BaseModel.loggedUserName = loggedUserName;
    }

    if (branchName) {
      BaseModel.currentBranchName = branchName;
    }
  }

  async ensureContext(req) {
    this.setRequestContext(req);
    return;
  }

  /**
   * Convert MongoDB ObjectIds to strings
   */
  mongoIDFilter(data) {
    if (!data) return data;

    const process = (item) => {
      if (!item || typeof item !== 'object') return item;

      // Preserve Date and BSON types (e.g. ObjectId) so they are not
      // converted into empty plain objects when spreading.
      if (item instanceof Date) return item;
      if (item._bsontype) return item;

      const processed = Array.isArray(item) ? [...item] : { ...item };
      if (processed._id) {
        if (processed._id instanceof ObjectId) {
          processed._id = processed._id.toHexString();
        } else if (typeof processed._id === 'object') {
          const raw = processed._id;
          const hexRegex = /^[a-fA-F0-9]{24}$/;
          const candidateSource =
            (typeof raw.$oid === 'string' && raw.$oid) ||
            (typeof raw._id === 'string' && raw._id) ||
            (typeof raw.id === 'string' && raw.id) ||
            (typeof raw.oid === 'string' && raw.oid) ||
            null;

          if (candidateSource && hexRegex.test(candidateSource)) {
            processed._id = candidateSource;
          } else if (raw && typeof raw.toString === 'function') {
            const maybe = raw.toString();
            if (typeof maybe === 'string' && hexRegex.test(maybe)) {
              processed._id = maybe;
            }
          }
        }
      }
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

  resolveIdCandidate(value) {
    if (!value) return null;

    const hexRegex = /^[a-fA-F0-9]{24}$/;

    const tryString = (str) => {
      if (!str) return null;
      const trimmed = String(str).trim();
      if (hexRegex.test(trimmed)) {
        return trimmed;
      }

      const match = trimmed.match(/[a-fA-F0-9]{24}/);
      if (match) {
        return match[0];
      }

      try {
        const parsed = JSON.parse(trimmed);
        return this.resolveIdCandidate(parsed);
      } catch (e) {}

      return null;
    };

    if (typeof value === 'string') {
      return tryString(value);
    }

    if (Array.isArray(value) && value.length > 0) {
      return this.resolveIdCandidate(value[0]);
    }

    if (typeof value === 'object') {
      const nested = value.id || value._id || value.$oid || value.oid;
      if (nested) {
        return this.resolveIdCandidate(nested);
      }
    }

    return null;
  }

  /**
   * GET /customercategory
   * Get all customer categories with pagination
   */
  getAll = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.category?.read;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;

    let additionalFilters = {};
    if (req.query.filters) {
      try {
        additionalFilters = JSON.parse(req.query.filters);
      } catch (e) {
        return res.status(400).json({
          type: 'error',
          message: 'Incorrect format of filter',
          data: null,
        });
      }
    }

    const filters = {
      ...additionalFilters,
      branch_id: BaseModel.currentBranch,
    };

    const options = { limit, page, sort: { created_date: -1 } };

    const result = await this.service.getAllCustomerCategories(filters, options);

    if (result.status) {
      const responseData = {
        list: this.mongoIDFilter(result.data.data || []),
        total: result.data.total || 0,
        per_page: result.data.limit || limit,
        current_page: result.data.page || page,
        total_pages: result.data.totalPages || 0,
      };
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: responseData,
      });
    } else {
      return res.status(400).json({
        type: 'error',
        message: result.message,
        data: null,
      });
    }
  });

  /**
   * POST /customercategory
   * Add new customer category
   */
  add = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.category?.write;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    const rawId = req.params.id || req.query.id || '';
    const id = this.resolveIdCandidate(rawId) || '';

    const categoryData = {
      name: (req.body.name || '').trim(),
      description: (req.body.description || '').trim(),
      branch_id: BaseModel.currentBranch,
      branch_name: BaseModel.currentBranchName,
      created_by: BaseModel.loggedUserName,
      created_by_id: BaseModel.loggedUser,
      license: BaseModel.license,
    };

    let result;
    if (id) {
      // Update existing category
      result = await this.service.updateCustomerCategory(id, categoryData);
    } else {
      // Create new category
      result = await this.service.createCustomerCategory(categoryData);
    }

    if (result.status) {
      const filtered = this.mongoIDFilter(result.data);
      const idValue =
        filtered && typeof filtered === 'object' && filtered._id ? filtered._id : filtered;
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: idValue,
      });
    } else {
      return res.status(400).json({
        type: 'error',
        message: result.message,
        data: null,
      });
    }
  });

  /**
   * PUT /customercategory/:id
   * Edit customer category
   */
  edit = asyncHandler(async (req, res) => {
    const rawId = req.params.id || req.query.id;
    const id = this.resolveIdCandidate(rawId);

    if (!id) {
      return res.status(400).json({
        type: 'error',
        message: 'Wrong request',
        data: null,
      });
    }

    req.params.id = id;
    return this.add(req, res);
  });

  /**
   * GET /customercategory/:id
   * Get single customer category by ID
   * @param {string} access - 'yes' to check access, 'no' to skip (for getCategoryDetails)
   */
  getOne = asyncHandler(async (req, res, access = 'yes') => {
    await this.ensureContext(req);

    const rawId = req.params.id || req.query.id;
    const id = this.resolveIdCandidate(rawId);

    if (!id) {
      return res.status(400).json({
        type: 'error',
        message: 'Category Id is mandatory',
        data: null,
      });
    }

    // Check user access - skip if access is 'no'
    const userAccess = access === 'yes' ? req.user?.access?.category?.read : true;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    const result = await this.service.getCustomerCategoryById(id);

    if (result.status) {
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: this.mongoIDFilter(result.data),
      });
    } else {
      return res.status(404).json({
        type: 'error',
        message: result.message,
        data: null,
      });
    }
  });

  /**
   * GET /customercategory/getCategoryDetails
   * Get category details without access check
   */
  getCategoryDetails = asyncHandler(async (req, res) => {
    const rawId = req.params.id || req.query.id;
    const id = this.resolveIdCandidate(rawId);

    if (!id) {
      return res.status(400).json({
        type: 'error',
        message: 'Category Id Not Found',
        data: null,
      });
    }

    // Call getOne with access='no' to skip access check
    return this.getOne(req, res, 'no');
  });

  /**
   * DELETE /customercategory
   * Delete customer categories
   */
  delete = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const ids = req.body.data;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({
        type: 'error',
        message: 'UID is missing',
        data: null,
      });
    }

    // Check user access
    const userAccess = req.user?.access?.category?.delete;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    const result = await this.service.deleteCustomerCategories(ids);

    if (result.status) {
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: result.data,
      });
    } else {
      return res.status(400).json({
        type: 'error',
        message: result.message,
        data: null,
      });
    }
  });

  /**
   * GET /customercategory/getDataChanges
   * Get data changes for synchronization
   */
  getDataChanges = asyncHandler(async (req, res) => {
    const from = req.query.from || '';

    try {
      const response = await this.model.getDataChanges('customercategory', from);

      if (response.status === true) {
        return res.status(200).json({
          type: 'success',
          message: 'Changes Retrieved',
          data: response.data,
        });
      } else {
        return res.status(200).json({
          type: 'error',
          message: 'Not valid Input',
          data: response.data,
        });
      }
    } catch (error) {
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * POST /customercategory/customercategoryImport
   * Import customer categories from CSV/Excel
   */
  customercategoryImport = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.category?.write;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    const rows = req.body.result || req.body.data || [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        type: 'error',
        message: 'No data to import',
        data: null,
      });
    }

    // Prepare categories with branch context
    const categoriesData = rows.map((row) => ({
      ...row,
      branch_id: BaseModel.currentBranch,
      branch_name: BaseModel.currentBranchName,
      created_by: BaseModel.loggedUserName,
      created_by_id: BaseModel.loggedUser,
      license: BaseModel.license,
    }));

    const result = await this.service.bulkImport(categoriesData);

    if (result.status) {
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: result.data,
      });
    } else {
      return res.status(400).json({
        type: 'error',
        message: result.message,
        data: result.data,
      });
    }
  });

  /**
   * POST /customercategory/exportCustomerCategory
   * Export customer categories
   */
  exportCustomerCategory = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Check user access
    const userAccess = req.user?.access?.category?.read;
    if (userAccess !== true) {
      return res.status(403).json({
        type: 'error',
        message: 'Unauthorized',
        data: null,
      });
    }

    try {
      // Parse body - frontend sends JSON string or already parsed
      let ids = [];
      if (typeof req.body === 'string') {
        // Body is a JSON string, parse it
        try {
          ids = JSON.parse(req.body);
        } catch (e) {
          console.error('❌ Failed to parse body as JSON:', e.message);
        }
      } else if (Array.isArray(req.body)) {
        // Body is already an array
        ids = req.body;
      } else if (req.body && req.body.data) {
        // Body has nested data property
        ids = Array.isArray(req.body.data) ? req.body.data : [];
      } else if (req.body && typeof req.body === 'object') {
        // Body is an object with numeric keys (express converts array to object)
        // Example: { '0': 'id1', '1': 'id2' } -> ['id1', 'id2']
        ids = Object.values(req.body);
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          type: 'error',
          message: 'No IDs provided for export',
          data: null,
        });
      }

      const response = await this.model.exportCustomerCategoriesOrder(ids);

      if (response.status === true) {
        return res.status(200).json({
          type: 'success',
          message: 'customerCategory Exported Successfully',
          data: response.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: 'customerCategory Exported Unsuccessfully',
          data: response.data,
        });
      }
    } catch (error) {
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * GET /customercategory/getCustomerCategoryAjaxList
   * Get customer category list for autocomplete
   */
  getCustomerCategoryAjaxList = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const query = req.query.query || '';

    try {
      const response = await this.model.getSelectCustomerCategoryAjaxList(query);

      if (response.status === true) {
        return res.status(200).json({
          query: query,
          suggestions: response.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: response.message,
          data: response.data,
        });
      }
    } catch (error) {
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });
}

module.exports = new CustomerCategoryController();
