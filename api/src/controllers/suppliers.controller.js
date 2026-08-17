// src/controllers/suppliers.controller.js
const asyncHandler = require('express-async-handler');
const SupplierService = require('../services/supplier.service');
const { validationResult } = require('express-validator');
const BaseController = require('./base.controller');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { DEFAULTS } = require('../constants/suppliers.constants');
require('../helpers/suppliers.helper');

/**
 * Supplier Controller (Refactored)
 * Follows layered architecture: Route → Controller → Service → Repository → Model
 *
 * Responsibilities:
 * - Handle HTTP requests/responses
 * - Validate input
 * - Call service layer for business logic
 * - Format responses
 */
class SuppliersController extends BaseController {
  constructor() {
    super();
    this.service = new SupplierService();
  }

  setRequestContext(req) {
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
    const loggedUserName = user.name || user.username || user.email || '';
    const branchName =
      req.tenantContext?.branchName || user.branch_name || user.branch?.branch_name || '';

    // Propagate context to BaseModel static fields so shared helpers
    // (e.g. changeLog, aggregate, stock logs) operate under the correct
    // tenant/branch and user identity.
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

    // Set BaseModel.currentBranchName for deletedDocumentBackup to use
    if (branchName) {
      BaseModel.currentBranchName = branchName;
    }
  }

  async ensureContext(req) {
    this.setRequestContext(req);
    // Context is set via BaseModel static properties in setRequestContext
    return;
  }

  /**
   * Get all suppliers with pagination and filters
   * GET /suppliers
   */
  getAll = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.supplier?.read;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    // Parse query parameters
    const pageParam = parseInt(req.query.page, 10);
    const page = pageParam && pageParam > 0 ? pageParam : 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || req.query.q || '';

    // Parse filters if provided
    let additionalFilters = {};
    if (req.query.filters) {
      try {
        additionalFilters = JSON.parse(req.query.filters);
      } catch (e) {
        return this.sendError(res, 'Incorrect format of filter', 400);
      }
    }

    // Build filters
    const filters = {
      ...additionalFilters,
      search,
    };

    // Add branch filter from context
    const branchId = this.getBranchId(req);
    if (branchId) {
      filters.branch_id = branchId;
    }

    // Build options
    const options = {
      page,
      limit,
      sort: { created_date: -1 },
    };

    // Call service
    const result = await this.service.getAllSuppliers(filters, options);

    if (result.status) {
      // Format response to match frontend expectations
      const responseData = {
        list: result.data.data || [],
        total: result.data.total || 0,
        per_page: result.data.limit || limit,
        current_page: result.data.page || page,
        total_pages: result.data.totalPages || 0,
      };
      return this.sendResponse(res, responseData, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Create new supplier
   * POST /suppliers
   */
  add = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.supplier?.write;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    // Determine GST status based on type and number (matching PHP logic)
    const gstType = req.body.gst_type || '';
    const gstNumber = req.body.gstin_number || req.body.gst_number || '';
    const gstStatus =
      (gstType && gstType !== 'consumer') || gstNumber ? 'enable' : req.body.gst || DEFAULTS.GST;

    // Extract supplier data from request body
    const supplierData = {
      name: req.body.name,
      company_name: req.body.company_name || '',
      email: req.body.email || '',
      phone: req.body.phone || '',
      alternatePhone: req.body.alternatePhone || '',
      address: req.body.address || '',
      city: req.body.city || '',
      state: req.body.state || '',
      country: req.body.country || DEFAULTS.COUNTRY,
      pincode: req.body.pincode || '',
      // GST fields - auto-enable when gst_type is set or gst_number provided
      gst: gstStatus,
      gst_type: gstType,
      gst_number: gstNumber,
      notes: req.body.notes || '',
      balance: req.body.balance || DEFAULTS.BALANCE,
      credit_limit: req.body.credit_limit || DEFAULTS.CREDIT_LIMIT,
      payment_terms: req.body.payment_terms || DEFAULTS.PAYMENT_TERMS,
    };

    // Add branch information with ObjectId conversion

    const branchId =
      req.body.branch_id ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      req.user?.branch_id ||
      req.user?.branch?._id ||
      (req.user?.branch_access && req.user.branch_access[0]?.branch_id);

    let branchName =
      req.body.branch_name ||
      req.user?.branch_name ||
      req.user?.branch?.name ||
      req.user?.branch?.branch_name ||
      (req.user?.branch_access && req.user.branch_access[0]?.branch_name) ||
      '';


    // If branch_name is empty but we have branch_id, fetch from branches collection
    if (branchId && !branchName) {
      try {
        const branchesCollection = await BaseModel.prototype.getCollection.call(
          { collectionName: 'branches' },
          'branches'
        );
        const branchDoc = await branchesCollection.findOne({
          _id: new ObjectId(branchId),
          license: req.tenantContext?.licenseId,
        });
        if (branchDoc) {
          branchName = branchDoc.name || branchDoc.branch_name || '';
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    if (branchId) {
      supplierData.branch_id = new ObjectId(branchId);
      supplierData.branch_name = branchName;
    } else {
      console.warn('⚠️ Supplier Create - No branch_id found!');
    }

    // Add created by information with ObjectId conversion
    if (req.user) {
      const userIdentifier = req.user.username || req.user.email || req.user.name;
      supplierData.created_by = userIdentifier;
      if (req.user._id) {
        supplierData.created_by_id = new ObjectId(req.user._id);
      }
    }

    // Call service
    const result = await this.service.createSupplier(supplierData);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Update existing supplier
   * PUT /suppliers/:id
   */
  edit = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const id = req.params.id || req.query.id;
    if (!id) {
      return this.sendError(res, 'Supplier ID is required', 400);
    }

    // Check user access
    const userAccess = req.user?.access?.supplier?.write;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    // Extract update data
    const updateData = {
      ...req.body,
      updated_by: req.user?.name || req.user?.username || '',
      updated_by_id: req.user?._id,
    };

    // Map gstin_number to gst_number if present
    if (updateData.gstin_number) {
      updateData.gst_number = updateData.gstin_number;
      delete updateData.gstin_number;
    }

    // Auto-enable GST if gst_type or gst_number is provided
    if (updateData.gst_type || updateData.gst_number) {
      const gstType = updateData.gst_type || '';
      const gstNumber = updateData.gst_number || '';
      if ((gstType && gstType !== 'consumer') || gstNumber) {
        updateData.gst = 'enable';
      }
    }

    // Call service
    const result = await this.service.updateSupplier(id, updateData);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get single supplier by ID
   * GET /suppliers/:id
   */
  getOne = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const id = req.params.id || req.query.id;
    if (!id) {
      return this.sendError(res, 'Supplier ID is required', 400);
    }

    // Check user access
    const userAccess = req.user?.access?.supplier?.read;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Call service
    const result = await this.service.getSupplierById(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Get supplier details (legacy endpoint, no access check)
   * GET /suppliers/getSupplierDetails
   */
  getSupplierDetails = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const id = req.params.id || req.query.id;
    if (!id) {
      return this.sendError(res, 'Supplier ID is required', 400);
    }

    // Call service
    const result = await this.service.getSupplierById(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Delete suppliers by IDs
   * DELETE /suppliers
   */
  delete = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const ids = req.body.data || req.body.ids || req.body;
    if (!ids || (Array.isArray(ids) && ids.length === 0)) {
      return this.sendError(res, 'Supplier IDs are required', 400);
    }

    // Check user access
    const userAccess = req.user?.access?.supplier?.delete;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    const idsArray = Array.isArray(ids) ? ids : [ids];

    // Call service
    const result = await this.service.bulkDeleteSuppliers(idsArray);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Autocomplete search for suppliers
   * GET /suppliers/getSuppliersAjaxList
   */
  getSuppliersAjaxList = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const query = req.query.query || req.query.q || '';
    const branchId = this.getBranchId(req);

    // Build options
    const options = {
      page: 1,
      limit: 20,
      branchId,
    };

    // Call service
    const result = await this.service.searchSuppliers(query, options);

    if (result.status) {
      // Map _id to id for frontend autocomplete compatibility
      const suggestions = (result.data.data || []).map((supplier) => ({
        id: supplier._id.toString(),
        name: supplier.name || '',
        address: supplier.address || '',
        phone: supplier.phone || '',
        email: supplier.email || '',
        state: supplier.state || '',
        gst_type: supplier.gst_type || '',
        gst_number: supplier.gst_number || '',
        branch: supplier.branch_name || '',
      }));

      return res.status(200).json({
        query: query,
        suggestions: suggestions,
      });
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get supplier graphical report
   * GET /suppliers/supplierGraphicalReports
   */
  supplierGraphicalReports = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access for reports
    const userAccess = req.user?.access?.report?.read;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Handle both 'branch' and 'branch[]' query params
    const branches = req.query['branch[]'] || req.query.branch || [];
    const branchIds = Array.isArray(branches) ? branches : [branches];

    // Use legacy model for graphical reports
    const SupplierLegacyModel = require('../models/supplier-legacy.model');
    const legacyModel = new SupplierLegacyModel();

    // Set context on legacy model instance
    legacyModel.licenseId = BaseModel.license;
    legacyModel.branchId = BaseModel.currentBranch;
    legacyModel.loggedUserId = BaseModel.loggedUser;
    legacyModel.loggedUserName = BaseModel.loggedUserName;

    const value = {
      branchid: branchIds,
      starting_date: req.query.starting_date,
      ending_date: req.query.ending_date,
    };

    // Call legacy model method
    const result = await legacyModel.getSupplierGraphicalReports(value);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get data changes for synchronization
   * GET /suppliers/getDataChanges
   */
  getDataChanges = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    const from = req.query.from || '';
    if (!from) {
      return this.sendError(res, "'from' date parameter is required", 400);
    }

    // Call service
    const result = await this.service.getDataChanges(from);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Bulk import suppliers from CSV/Excel
   * POST /suppliers/suppliersImport
   */
  suppliersImport = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.supplier?.write;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    const suppliers = req.body.result || req.body.suppliers || [];

    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      return this.sendError(res, 'No suppliers to import', 400);
    }

    // Add branch context to each supplier
    const branchId = this.getBranchId(req);
    const branchName = this.getBranchName(req);

    // Fetch branch details for country/state/city (matching PHP implementation)
    let branchCountry = 'India';
    let branchState = '';
    let branchCity = '';

    try {
      const branchesCollection = await BaseModel.prototype.getCollection.call(
        { collectionName: 'branches' },
        'branches'
      );
      const branchDoc = await branchesCollection.findOne({
        _id: new ObjectId(branchId),
        license: req.tenantContext?.licenseId,
      });
      if (branchDoc) {
        branchCountry = branchDoc.country || 'India';
        branchState = branchDoc.state || '';
        branchCity = branchDoc.city || '';
      }
    } catch (error) {
      console.error('Error fetching branch details for import:', error);
    }

    const suppliersWithContext = suppliers.map((supplier) => ({
      ...supplier,
      branch_id: new ObjectId(branchId),
      branch_name: branchName,
      country: supplier.country || branchCountry,
      state: supplier.state || branchState,
      city: supplier.city || branchCity,
      gst: supplier.gst || 'disable',
      gst_type: supplier.gst_type || 'consumer',
      gst_number: supplier.gst_number || '',
      created_by: req.user?.name || req.user?.username || '',
      created_by_id: req.user?._id ? new ObjectId(req.user._id) : undefined,
    }));

    // Call service
    const result = await this.service.bulkImport(suppliersWithContext);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, result.data);
    }
  });

  /**
   * Normalize export ID payloads coming from the legacy frontend.
   * The UI may send:
   *   - a JSON array in the request body (application/json)
   *   - a raw JSON string (e.g. "[\"id1\",\"id2\"]")
   *   - a form-encoded body where the *key* itself is the JSON string
   *     produced by JSON.stringify(selectedTableRow).
   */
  normalizeExportIds(raw) {
    if (!raw) return [];

    // If the body itself is already an array of IDs
    if (Array.isArray(raw)) {
      return raw;
    }

    // If wrapped as { data: ... } or { ids: ... }
    if (typeof raw === 'object') {
      const candidate = raw.data !== undefined ? raw.data : raw.ids;
      if (candidate !== undefined) {
        return this.normalizeExportIds(candidate);
      }

      // Handle form-url-encoded edge case where the JSON array appears
      // as the *only* key of the object, e.g. { "[\"id1\",\"id2\"]": "" }
      const keys = Object.keys(raw || {});
      if (keys.length === 1) {
        const onlyKey = keys[0];
        try {
          const parsed = JSON.parse(onlyKey);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch (e) {
          // fall through to other handling
        }
      }

      // Fallback: body may be an object like {"0": "id1", "1": "id2"}
      // when arrays are encoded differently. In that case, treat all
      // string values as IDs.
      const values = Object.values(raw);
      if (values.length > 0 && values.every((v) => typeof v === 'string')) {
        return values;
      }
    }

    // Raw JSON string or single ID string
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        return [parsed];
      } catch (e) {
        return [raw];
      }
    }

    // Fallback: wrap whatever we have
    return [raw];
  }

  /**
   * Export suppliers by IDs
   * POST /suppliers/exportSuppliers
   */
  exportSuppliers = asyncHandler(async (req, res) => {
    await this.ensureContext(req);

    // Check user access
    const userAccess = req.user?.access?.supplier?.read;
    if (userAccess === false) {
      return this.sendError(res, 'Unauthorized', 403);
    }

    // Normalize various legacy payload formats into a clean ID array
    const idsArray = this.normalizeExportIds(req.body);

    if (!idsArray || idsArray.length === 0) {
      return this.sendError(res, 'No supplier IDs provided', 400);
    }

    // Build filters for export
    const filters = {
      ids: idsArray,
    };

    // Call service
    const result = await this.service.exportSuppliers(filters);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });
  /**
   * Helper: Get branch ID from request context
   */
  getBranchId(req) {
    const user = req.user || {};
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

    const branchParam =
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

    return Array.isArray(branchParam) ? branchParam[0] : branchParam;
  }

  /**
   * Helper: Get branch name from request context
   */
  getBranchName(req) {
    const user = req.user || {};
    return user.branch_name || user.branch?.branch_name || '';
  }
}

module.exports = new SuppliersController();
