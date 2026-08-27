// src/controllers/customers-refactored.controller.js
const asyncHandler = require('express-async-handler');
const CustomerService = require('../services/customer.service');
const { validationResult } = require('express-validator');
const BaseController = require('./base.controller');
const Branch = require('../models/branch.model');
const { ObjectId } = require('mongodb');
const { ERROR_MESSAGES, DEFAULTS } = require('../constants/customers.constants');
const { normalizeBoolean } = require('../helpers/customers.helper');
const sessionFilterUtil = require('../utils/session-filter.util');

const BaseModel = require('../models/base.model');

/**
 * Customer Controller (Refactored)
 * Follows layered architecture: Route → Controller → Service → Repository → Model
 *
 * Responsibilities:
 * - Handle HTTP requests/responses
 * - Validate input
 * - Call service layer for business logic
 * - Format responses
 */
class CustomerController extends BaseController {
  constructor() {
    super();
    this.service = new CustomerService();
  }

  /**
   * Set request context (user, branch, license)
   */
  setRequestContext(req) {
    this.user = req.user;
    this.branch = req.branch;
    this.license = req.license;

    // Set BaseModel context for repositories
    if (req.user) {
      BaseModel.loggedUser = req.user._id;
      BaseModel.loggedUserName = req.user.username || req.user.name;
      BaseModel.license = req.tenantContext?.licenseId || req.license || req.user.license;

      // Determine branch context
      const branchId =
        req.tenantContext?.branchId ||
        req.query?.branch_id ||
        req.query?.branch ||
        req.body?.branch_id ||
        req.session?.selectedBranchId ||
        req.user.branch_id ||
        req.user.branch?._id ||
        (Array.isArray(req.user.branch_access) && req.user.branch_access[0]?.branch_id);

      BaseModel.currentBranch = branchId;
    }
  }

  /**
   * Get all customers with pagination and filters
   * GET /api/customers
   */
  getCustomers = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    // Parse query parameters
    const pageParam = parseInt(req.query.page);
    const page = pageParam && pageParam > 0 ? pageParam : 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const tier = req.query.tier || null;

    // Get branch_id - prioritize session selectedBranchId
    let branch_id =
      req.tenantContext?.branchId ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      req.query.branch_id ||
      req.query.branch;

    if (!branch_id && this.user) {
      // Use user's current branch if no branch specified
      branch_id =
        this.user.branch_id ||
        this.user.branch?._id ||
        this.user.default_branch_id ||
        (Array.isArray(this.user.branch_access) && this.user.branch_access[0]?.branch_id);
    }

    // Build filters - parse complex filters from query string
    let filters = {};

    // Parse filters JSON if provided
    if (req.query.filters) {
      try {
        const parsedFilters =
          typeof req.query.filters === 'string' ? JSON.parse(req.query.filters) : req.query.filters;
        filters = { ...parsedFilters };
      } catch (e) {
        console.error('Error parsing filters:', e);
      }
    }

    // Add basic filters
    if (search) filters.search = search;
    if (branch_id) filters.branch_id = branch_id;
    if (tier) filters.tier = tier;

    // Build options
    const options = {
      page,
      limit,
      sort: { created_date: -1 },
    };

    // Call service
    const result = await this.service.getAllCustomers(filters, options);

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
   * Get customer by ID
   * GET /api/customers/:id
   * GET /api/customers/getCustomerDetails?id=xxx (legacy)
   */
  getCustomer = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Support both params and query for legacy compatibility
    const id = req.params.id || req.query.id;

    if (!id) {
      return this.sendError(res, ERROR_MESSAGES.CUSTOMER_NOT_FOUND, 400, null);
    }

    // Call service
    const result = await this.service.getCustomerById(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Create new customer
   * POST /api/customers
   */
  createCustomer = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    // Extract customer data from request body (matching old structure)
    // Extract category information (matching PHP logic)
    const categoryId = req.body.customer_category || req.body.category_id;
    const referrerId = req.body.customer_referrer_id || req.body.referrer_id;

    // Determine GST status based on type and number (matching PHP logic)
    const gstType = req.body.gst_type || '';
    const gstNumber = req.body.gstin_number || req.body.gst_number || '';
    const gstStatus =
      (gstType && gstType !== 'consumer') || gstNumber ? 'enable' : req.body.gst || DEFAULTS.GST;

    const customerData = {
      name: req.body.name,
      email: req.body.email || '',
      phone: req.body.phone || '',
      alternatePhone: req.body.alternatePhone,
      address: req.body.address || '',
      city: req.body.city || '',
      state: req.body.state || '',
      country: req.body.country || DEFAULTS.COUNTRY,
      pincode: req.body.pincode,
      // Category fields - always set (empty string if not provided, matching PHP)
      category_id: categoryId ? new ObjectId(categoryId) : '',
      category_name: req.body.category_name || '',
      // Referrer fields - always set (empty string if not provided, matching PHP)
      referrer_id: referrerId ? new ObjectId(referrerId) : '',
      referrer_name: req.body.customer_referrer_name || req.body.referrer_name || '',
      // GST fields - auto-enable when gst_type is set or gst_number provided
      gst: gstStatus,
      gst_type: gstType,
      gst_number: gstNumber,
      notes: req.body.notes,
      tags: req.body.tags || [],
      balance: req.body.balance || DEFAULTS.BALANCE,
      partial_balance: normalizeBoolean(req.body.partial_balance),
    };

    // Add loyalty if requested (old structure has loyalty field)
    if (req.body.enableLoyalty || req.body.loyalty) {
      customerData.loyalty = req.body.loyalty || {
        points: DEFAULTS.LOYALTY_POINTS,
        pointsEarned: 0,
        pointsRedeemed: 0,
        tier: DEFAULTS.LOYALTY_TIER,
        lastUpdated: new Date(),
      };
    }

    // Add branch information with ObjectId conversion
    const branchId =
      req.body?.branch_id ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      this.user?.branch_id ||
      this.user?.branch?._id;

    let branchName =
      req.body?.branch_name ||
      this.user?.branch_name ||
      this.user?.branch?.name ||
      this.branch?.name ||
      '';

    // If branch_name is empty but we have branch_id, fetch from branches collection
    if (branchId && !branchName) {
      try {
        const BaseModel = require('../models/base.model');
        const branchesCollection = await new BaseModel('branches').getCollection('branches');
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
      customerData.branch_id = new ObjectId(branchId);
      customerData.branch_name = branchName;
    }

    // Add created by and updated by information with ObjectId conversion
    if (this.user) {
      const userIdentifier = this.user.username || this.user.email;
      customerData.created_by = userIdentifier;
      customerData.updated_by = userIdentifier;

      if (this.user._id) {
        const userObjectId = new ObjectId(this.user._id);
        customerData.created_by_id = userObjectId;
        customerData.updated_by_id = userObjectId;
      }
    }

    // Add date field (same as created_date for compatibility)
    customerData.date = new Date();

    // Call service
    const result = await this.service.createCustomer(customerData);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 201);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Update customer
   * PUT /api/customers/:id
   */
  updateCustomer = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.sendError(res, 'Validation failed', 400, errors.array());
    }

    const { id } = req.params;

    // Extract update data
    const updateData = { ...req.body };

    // Convert branch_id to ObjectId if present
    if (updateData.branch_id) {
      updateData.branch_id = new ObjectId(updateData.branch_id);
    }

    // Convert category_id to ObjectId if present (matching PHP logic)
    if (updateData.customer_category !== undefined || updateData.category_id !== undefined) {
      const categoryId = updateData.customer_category || updateData.category_id;
      updateData.category_id = categoryId ? new ObjectId(categoryId) : '';
      delete updateData.customer_category;
    }

    // Convert referrer_id to ObjectId if present (matching PHP logic)
    if (updateData.customer_referrer_id !== undefined || updateData.referrer_id !== undefined) {
      const referrerId = updateData.customer_referrer_id || updateData.referrer_id;
      updateData.referrer_id = referrerId ? new ObjectId(referrerId) : '';
      updateData.referrer_name =
        updateData.customer_referrer_name || updateData.referrer_name || '';
      delete updateData.customer_referrer_id;
      delete updateData.customer_referrer_name;
    }

    // Map gstin_number to gst_number if present
    if (updateData.gstin_number) {
      updateData.gst_number = updateData.gstin_number;
      delete updateData.gstin_number;
    }

    // PHP: 'partial_balance' => isset($data['partial_balance'])
    // Frontend checkbox sends "on" when checked, field absent when unchecked.
    // PHP always sets this as boolean; mirror that here.
    updateData.partial_balance = normalizeBoolean(req.body.partial_balance);

    // Add updated by information with ObjectId conversion
    if (this.user) {
      updateData.updated_by = this.user.username;
      if (this.user._id) {
        updateData.updated_by_id = new ObjectId(this.user._id);
      }
    }

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.license;
    delete updateData.created_date;
    delete updateData.created_by;
    delete updateData.created_by_id;

    // Call service
    const result = await this.service.updateCustomer(id, updateData);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Delete customer (soft delete)
   * DELETE /api/customers/:id
   */
  deleteCustomer = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;

    // Call service
    const result = await this.service.deleteCustomer(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Bulk delete customers
   * POST /api/customers/bulk-delete
   */
  bulkDelete = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const ids = req.body?.data || req.body?.ids;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return this.sendError(res, 'No customer IDs provided', 400, null);
    }

    // Call service
    const result = await this.service.bulkDeleteCustomers(ids);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Search customers
   * GET /api/customers/search
   */
  searchCustomers = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const searchTerm = req.query.q || req.query.search;
    const pageParam = parseInt(req.query.page);
    const page = pageParam && pageParam > 0 ? pageParam : 1;
    const limit = parseInt(req.query.limit) || 10;
    const branchId = req.query.branch_id || null;

    if (!searchTerm) {
      return this.sendError(res, 'Search term is required', 400, null);
    }

    const options = { page, limit, branchId };

    // Call service
    const result = await this.service.searchCustomers(searchTerm, options);

    if (result.status) {
      // Format response to match frontend expectations
      const responseData = {
        list: result.data.data || [],
        total: result.data.total || 0,
      };
      return this.sendResponse(res, responseData, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Legacy AJAX search endpoint
   * GET /api/customers/getCustomersAjaxList
   * PHP: getCustomersAjaxList()
   */
  getCustomersAjaxList = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const searchTerm = req.query.query || req.query.q || req.query.search;
    const pageParam2 = parseInt(req.query.page);
    const page = pageParam2 && pageParam2 > 0 ? pageParam2 : 1;
    const limit = parseInt(req.query.limit) || 100; // Increase limit for autocomplete

    // Get branch_id from current user context (not from query to prevent cross-branch access)
    const branchId = BaseModel.currentBranch || this.user?.branch_id || this.user?.branch?._id;

    if (!searchTerm) {
      return this.sendError(res, 'Search term is required', 400, null);
    }

    const options = { page, limit, branchId };

    // Call service
    const result = await this.service.searchCustomers(searchTerm, options);

    if (result.status) {
      // Format response to match legacy frontend expectations
      // Return suggestions array with query including all required fields
      const formattedList = (result.data.data || []).map((customer) => ({
        id: customer._id?.toString() || customer.id,
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        country: customer.country || '',
        state: customer.state || '',
        gst_type: customer.gst_type || '',
        gst_number: customer.gst_number || '',
        address: customer.address || '',
        balance: customer.balance || 0,
        partial_balance: customer.partial_balance || false,
        // Price lists (V4): the category rides the suggestion so the sale
        // screen resolves pricing at select time - no async fallback race
        // between selecting a customer and scanning the first item.
        category_id: customer.category_id?.toString() || '',
      }));

      // Return in the format expected by autocomplete: { query, suggestions }
      return res.json({
        query: searchTerm,
        suggestions: formattedList,
      });
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get customer summary with sales statistics
   * GET /api/customers/:id/summary
   */
  getCustomerSummary = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;

    // Call service
    const result = await this.service.getCustomerSummary(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Get customers by loyalty tier
   * GET /api/customers/tier/:tier
   */
  getCustomersByTier = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { tier } = req.params;
    const pageParam3 = parseInt(req.query.page);
    const page = pageParam3 && pageParam3 > 0 ? pageParam3 : 1;
    const limit = parseInt(req.query.limit) || 10;

    const options = { page, limit };

    // Call service
    const result = await this.service.getCustomersByTier(tier, options);

    if (result.status) {
      // Format response to match frontend expectations
      const responseData = {
        list: result.data.data || [],
        total: result.data.total || 0,
      };
      return this.sendResponse(res, responseData, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Add loyalty points
   * POST /api/customers/:id/loyalty/add
   */
  addLoyaltyPoints = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;
    const { points, reason } = req.body;

    // Call service
    const result = await this.service.addLoyaltyPoints(id, points, reason);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Redeem loyalty points
   * POST /api/customers/:id/loyalty/redeem
   */
  redeemPoints = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;
    const { points } = req.body;

    // Call service
    const result = await this.service.redeemLoyaltyPoints(id, points);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get customer outstanding report
   * GET /api/customers/reports/outstanding
   */
  customerOutstandingReport = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const pageParam4 = parseInt(req.query.page);
    const page = pageParam4 && pageParam4 > 0 ? pageParam4 : 1;
    const limit = parseInt(req.query.limit) || 10;
    const branchIds = req.query.branch_ids ? JSON.parse(req.query.branch_ids) : [];

    const filters = {};
    const options = { page, limit, branchIds };

    // Call service
    const result = await this.service.getOutstandingReport(filters, options);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get data changes for synchronization
   * GET /api/customers/sync/changes
   */
  getDataChanges = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const fromDate = req.query.from || new Date(0).toISOString();

    // Call service
    const result = await this.service.getDataChanges(fromDate);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Import customers from CSV/Excel
   * POST /api/customers/import
   * POST /api/customers/customersImport (legacy)
   */
  importCustomers = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Handle multiple request body formats from frontend
    const customersData = req.body.result || req.body.customers || req.body.data || [];

    if (!Array.isArray(customersData) || customersData.length === 0) {
      return this.sendError(res, 'No customers to import', 400);
    }

    // Add branch context to each customer
    const branchId =
      req.user?.branch_id ||
      req.user?.branch?._id ||
      req.user?.default_branch_id ||
      (Array.isArray(req.user?.branch_access) && req.user.branch_access[0]?.branch_id);

    const branchName =
      req.user?.branch_name || req.user?.branch?.branch_name || req.user?.branch?.name || '';

    // Fetch branch details for country/state/city (matching PHP implementation)
    let branchCountry = 'India';
    let branchState = '';
    let branchCity = '';

    try {
      const branchesCollection = await new BaseModel('branches').getCollection('branches');
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

    const customersWithContext = customersData.map((customer) => ({
      ...customer,
      branch_id: new ObjectId(branchId),
      branch_name: branchName,
      country: customer.country || branchCountry,
      state: customer.state || branchState,
      city: customer.city || branchCity,
      gst: customer.gst || 'disable',
      gst_type: customer.gst_type || 'consumer',
      gst_number: customer.gst_number || '',
      partial_balance: customer.partial_balance || false,
      balance: customer.balance || 0.0,
      created_by: req.user?.name || req.user?.username || req.user?.email || '',
      created_by_id: req.user?._id ? new ObjectId(req.user._id) : undefined,
    }));

    // Call service with branch_id for duplicate checking
    const result = await this.service.importCustomers(customersWithContext, branchId);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, result.data);
    }
  });

  /**
   * Legacy alias for customersImport route
   */
  customersImport = asyncHandler(async (req, res) => {
    return this.importCustomers(req, res);
  });

  /**
   * Normalize export ID payloads from legacy frontend
   */
  normalizeExportIds(raw) {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw;
    }

    if (typeof raw === 'object') {
      const candidate = raw.data !== undefined ? raw.data : raw.ids;
      if (candidate !== undefined) {
        return this.normalizeExportIds(candidate);
      }

      const keys = Object.keys(raw || {});
      if (keys.length === 1) {
        const onlyKey = keys[0];
        try {
          const parsed = JSON.parse(onlyKey);
          if (Array.isArray(parsed)) {
            return parsed;
          }
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
        if (Array.isArray(parsed)) {
          return parsed;
        }
        return [parsed];
      } catch (e) {
        return [raw];
      }
    }

    return [raw];
  }

  /**
   * Export customers data
   * POST /api/customers/export
   * POST /api/customers/exportCustomers (legacy)
   * POST /api/customers/exportcustomers (legacy lowercase)
   */
  exportCustomers = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    // Normalize various legacy payload formats
    const idsArray = this.normalizeExportIds(req.body);

    // Build filters for export
    const filters = req.body.filters || {};

    // If IDs are provided, add them to filters
    if (idsArray && idsArray.length > 0) {
      filters.ids = idsArray;
    }

    // Call service
    const result = await this.service.exportCustomers(filters);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 400, null);
    }
  });

  /**
   * Get customer payment details
   * GET /api/customers/:id/payment-details
   */
  getPaymentDetails = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;

    // Call service
    const result = await this.service.getPaymentDetails(id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Get customer transactions
   * GET /api/customers/:id/transactions
   */
  getTransactions = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;
    const pageParam5 = parseInt(req.query.page);
    const page = pageParam5 && pageParam5 > 0 ? pageParam5 : 1;
    const limit = parseInt(req.query.limit) || 10;

    const options = { page, limit };

    // Call service
    const result = await this.service.getTransactions(id, options);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Update customer preferences
   * PUT /api/customers/:id/preferences
   */
  updatePreferences = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { id } = req.params;
    const { preferences } = req.body;

    // Call service
    const result = await this.service.updatePreferences(id, preferences);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * Alias for backward compatibility
   */
  getAll = asyncHandler(async (req, res) => {
    return this.getCustomers(req, res);
  });

  /**
   * Legacy delete endpoint for PosnicPro compatibility
   */
  delete = asyncHandler(async (req, res) => {
    return this.bulkDelete(req, res);
  });

  /**
   * PHP: customerPaymentDetails()
   * Get customer balance and sales payment details
   * GET /customers/customerPaymentDetails?customer_id=xxx
   */
  customerPaymentDetails = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const { customer_id } = req.query;

    if (!customer_id) {
      return this.sendError(res, 'Customer ID is required', 400);
    }

    // Get payment details from service
    const result = await this.service.getPaymentDetails(customer_id);

    if (result.status) {
      return this.sendResponse(res, result.data, result.message, 200);
    } else {
      return this.sendError(res, result.message, 404, null);
    }
  });

  /**
   * PHP: transactionDetails()
   * Get customer transaction details
   */
  transactionDetails = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const options = { limit, page, sort: { _id: -1 } };

    // Handle branch[] array parameter
    let branchid = req.query.branch;
    if (!branchid && req.query['branch[]']) {
      branchid = req.query['branch[]'];
    }

    const data = {
      customer_id: req.query.customer_id,
      branchid: branchid,
    };

    try {
      // Set BaseModel context
      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      // Build filter
      const filters = {
        customer_id: new ObjectId(data.customer_id),
      };

      // Add license filter - handle both string and ObjectId formats
      if (BaseModel.license) {
        const licenseId = BaseModel.license.toString();
        filters.$or = [{ license: licenseId }, { license: new ObjectId(licenseId) }];
      }

      // Add branch filter only if branchid is provided
      // Include records with null branch_id or matching branch_id
      if (data.branchid && data.branchid.length > 0) {
        const branchIds = Array.isArray(data.branchid)
          ? data.branchid.map((id) => new ObjectId(id))
          : [new ObjectId(data.branchid)];
        filters.$and = [
          {
            $or: [{ branch_id: null }, { branch_id: { $in: branchIds } }],
          },
        ];
      }

      // Get transaction collection
      const transactionCollection = await new BaseModel('transaction').getCollection('transaction');

      // Get paginated transactions
      const skip = (page - 1) * limit;

      const transactions = await transactionCollection
        .find(filters)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Check if there are any transactions without license filter
      const totalWithoutLicense = await transactionCollection.countDocuments(filters);

      // Get a sample transaction to see its structure
      if (totalWithoutLicense > 0) {
        const sampleTxn = await transactionCollection.findOne(filters);
      }

      // Format transactions with string_date for frontend
      const formattedTransactions = transactions.map((txn) => {
        const date = txn.updated_date || txn.date || new Date();
        const dateObj = date instanceof Date ? date : new Date(date);

        // Format as MM/DD/YYYY HH:mm am/pm
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const year = dateObj.getFullYear();
        let hours = dateObj.getHours();
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;

        const string_date = `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

        return {
          ...txn,
          string_date,
        };
      });

      const total = await transactionCollection.countDocuments(filters);

      // Aggregate amounts
      const aggregateResult = await transactionCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: null,
              totalInAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] },
              },
              totalOutAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] },
              },
              totalPendingAmount: { $sum: '$pending' },
            },
          },
          {
            $addFields: {
              totalAmountDue: { $subtract: ['$totalInAmount', '$totalOutAmount'] },
            },
          },
        ])
        .toArray();

      const totals =
        aggregateResult.length > 0
          ? aggregateResult[0]
          : {
              totalInAmount: 0,
              totalOutAmount: 0,
              totalAmountDue: 0,
              totalPendingAmount: 0,
            };

      const responseData = {
        pending: totals.totalPendingAmount || 0,
        wallet: totals.totalAmountDue || 0,
        in: totals.totalInAmount || 0,
        out: totals.totalOutAmount || 0,
        table: {
          status: true,
          data: {
            total,
            current_page: page,
            total_pages: Math.ceil(total / limit),
            per_page: limit,
            list: formattedTransactions,
          },
          message: 'success',
        },
      };

      return res.status(200).json({
        type: 'success',
        message: 'get detail successfully',
        data: responseData,
      });
    } catch (error) {
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * PHP: transaction()
   * Create customer transaction (wallet transaction)
   * POST /customers/transaction
   */
  transaction = asyncHandler(async (req, res) => {
    this.setRequestContext(req);

    try {
      const { id, amount, date, description, type, sale_id, transaction_image } = req.body;

      if (!id || !amount) {
        return res.status(400).json({
          type: 'error',
          message: 'Customer ID and amount are required',
          data: null,
        });
      }

      // Set BaseModel context
      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      // Get customer details
      const customerCollection = await new BaseModel('customers').getCollection('customers');

      const customer = await customerCollection.findOne({
        _id: new ObjectId(id),
        license: BaseModel.license,
      });

      if (!customer) {
        return res.status(404).json({
          type: 'error',
          message: 'Customer not found',
          data: null,
        });
      }

      // Get transaction collection
      const transactionCollection = await new BaseModel('transaction').getCollection('transaction');

      // Create transaction document
      const transactionDate = date ? new Date(date) : new Date();

      // Fetch branch_name from DB if empty
      let branch_name = req.user?.branch_name || '';
      const userBranchId = req.user?.branch_id;
      if (userBranchId && !branch_name) {
        try {
          const branch = await (
            req.tenantContext
              ? Branch.findOne({ _id: userBranchId, license: req.tenantContext.licenseId })
              : Branch.findById(userBranchId)
          )
            .select('branch_name')
            .lean();
          if (branch?.branch_name) {
            branch_name = branch.branch_name.trim();
          }
        } catch (error) {
          console.error('Error fetching branch name:', error);
        }
      }

      const transactionDoc = {
        sale_id: sale_id || '',
        customer_id: new ObjectId(id),
        customer_name: customer.name || '',
        customer_phone: customer.phone || '',
        branch_id: req.user?.branch_id ? new ObjectId(req.user.branch_id) : null,
        branch_name: branch_name,
        amount: parseFloat(amount),
        type: type || 'in',
        pending: 0,
        description: description || 'Add transaction',
        transaction_image: transaction_image || '',
        date: transactionDate,
        created_date: new Date(),
        updated_date: new Date(),
        license: BaseModel.license,
      };

      // Insert transaction
      await transactionCollection.insertOne(transactionDoc);

      // Recalculate customer balance from all transactions
      const aggregateResult = await transactionCollection
        .aggregate([
          {
            $match: {
              customer_id: new ObjectId(id),
              license: BaseModel.license,
            },
          },
          {
            $group: {
              _id: null,
              totalIn: {
                $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] },
              },
              totalOut: {
                $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] },
              },
            },
          },
          {
            $addFields: {
              balance: { $subtract: ['$totalIn', '$totalOut'] },
            },
          },
        ])
        .toArray();

      const newBalance = aggregateResult.length > 0 ? aggregateResult[0].balance : 0;

      // Update customer balance
      await customerCollection.updateOne(
        { _id: new ObjectId(id), license: BaseModel.license },
        { $set: { balance: newBalance, updated_date: new Date() } }
      );

      return res.status(200).json({
        type: 'success',
        message: 'Add transaction successfully',
        data: newBalance,
      });
    } catch (error) {
      console.error('Error in transaction:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * DELETE /customers/deleteTransaction
   *
   * The route for this has been live and calling a method that was never
   * written, so the trash icon on a customer's transaction list returned 500
   * every time. Express did not catch it at startup because the route wraps
   * the call in an arrow function - the wrapper IS a function, so the server
   * boots clean and the TypeError waits for someone to press delete.
   *
   * WHY THIS IS SAFE TO WRITE, when reversing a money record usually is not:
   * the balance here is DERIVED, not maintained. `transaction` above computes
   * it as sum(in) - sum(out) over every transaction for the customer and $sets
   * the result. So a delete does not need bespoke reversal arithmetic that
   * could drift from the original - it removes the row and re-runs the exact
   * same derivation. The aggregate below is a copy of that one deliberately;
   * if the definition of balance ever changes, both must change together.
   *
   * A transaction that belongs to a SALE is refused. The UI already shows a
   * link icon rather than a trash for those, but the server must not trust
   * that: deleting one would leave the sale believing it had been paid while
   * the customer's ledger says otherwise, and nothing would flag the gap.
   */
  deleteTransaction = asyncHandler(async (req, res) => {
    try {
      const { id, customer_id } = req.body || {};
      if (!id || !customer_id) {
        return res.status(400).json({
          type: 'error',
          message: 'Transaction id and customer id are required',
          data: null,
        });
      }

      const transactionCollection = await new BaseModel('transaction').getCollection('transaction');

      /* Scoped by customer AND license, never by id alone: an id on its own
         would let one customer's row be deleted from another's screen. */
      const scope = {
        _id: new ObjectId(id),
        customer_id: new ObjectId(customer_id),
        license: BaseModel.license,
      };

      const existing = await transactionCollection.findOne(scope);
      if (!existing) {
        return res.status(404).json({
          type: 'error',
          message: 'Transaction not found',
          data: null,
        });
      }

      if (existing.sale_id) {
        return res.status(400).json({
          type: 'error',
          message: 'This transaction belongs to a sale. Cancel the sale instead.',
          data: null,
        });
      }

      await transactionCollection.deleteOne(scope);

      // Recalculate customer balance from all transactions - the same
      // derivation the add path uses, so the two can never disagree.
      const aggregateResult = await transactionCollection
        .aggregate([
          {
            $match: {
              customer_id: new ObjectId(customer_id),
              license: BaseModel.license,
            },
          },
          {
            $group: {
              _id: null,
              totalIn: {
                $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] },
              },
              totalOut: {
                $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] },
              },
            },
          },
          {
            $addFields: {
              balance: { $subtract: ['$totalIn', '$totalOut'] },
            },
          },
        ])
        .toArray();

      const newBalance = aggregateResult.length > 0 ? aggregateResult[0].balance : 0;

      const customerCollection = await new BaseModel('customers').getCollection('customers');
      await customerCollection.updateOne(
        { _id: new ObjectId(customer_id), license: BaseModel.license },
        { $set: { balance: newBalance, updated_date: new Date() } }
      );

      return res.status(200).json({
        type: 'success',
        message: 'Transaction deleted successfully',
        data: newBalance,
      });
    } catch (error) {
      console.error('Error in deleteTransaction:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * PHP: uploadTransactionImage()
   * Upload transaction image
   * POST /customers/uploadTransactionImage
   */
  uploadTransactionImage = asyncHandler(async (req, res) => {
    try {
      const path = require('path');
      const fs = require('fs');

      // If no file uploaded, return error
      if (!req.file || !req.file.originalname) {
        return res.status(400).json({
          type: 'error',
          message: 'No file uploaded',
          data: null,
        });
      }

      // Get file extension
      const fileExtension = path.extname(req.file.originalname);
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'];

      if (!allowedExtensions.includes(fileExtension.toLowerCase())) {
        // Delete uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          type: 'error',
          message: 'Invalid file type. Only JPG, PNG, GIF, and PDF are allowed.',
          data: null,
        });
      }

      // Generate unique filename matching PHP format
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const fileName = `${timestamp}-posnic_category-${uniqueId}${fileExtension}`;

      // Use transaction_images folder as requested (without public folder)
      const uploadDir = path.join(__dirname, '../../uploads/transaction_images');

      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Move file to destination
      const oldPath = req.file.path;
      const newPath = path.join(uploadDir, fileName);
      fs.renameSync(oldPath, newPath);

      // Construct full URL dynamically based on request
      const protocol = req.protocol; // http or https
      const host = req.get('host'); // localhost:5000 or domain
      const imageUrl = `${protocol}://${host}/uploads/transaction_images/${fileName}`;

      console.log('[TRANSACTION IMAGE] Uploaded:', {
        fileName,
        uploadDir,
        fullPath: newPath,
        imageUrl,
      });

      // Return the full URL so it can be saved in database
      return res.status(200).json({
        type: 'success',
        message: 'Image uploaded successfully',
        data: imageUrl,
      });
    } catch (error) {
      console.error('Error in uploadTransactionImage:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  });

  /**
   * GET /customers/customerGraphicalReports
   * Get customer graphical reports (sales by day of week)
   * PHP: customers.php -> customerGraphicalReports()
   */
  async customerGraphicalReports(req, res) {
    try {
      this.setRequestContext(req);

      let startingDate = req.query.starting_date;
      let endingDate = req.query.ending_date;
      const branchIds = req.query.branch || req.query['branch[]'] || [];
      const customerId = req.query.field_input || '';

      // Apply session filtering if user has permission and dates are provided
      if (startingDate || endingDate) {
        const startDate = startingDate ? new Date(startingDate) : null;
        const endDate = endingDate ? new Date(endingDate) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        // Update dates with filtered values
        startingDate = filteredDateRange.start_date;
        endingDate = filteredDateRange.end_date;
      } else {
      }

      // Check user access
      const userAccess = this.user?.access?.report?.read ?? false;
      if (!userAccess) {
        return res.status(403).json({
          type: 'error',
          message: 'Unauthorized',
          data: null,
        });
      }

      const result = await this.service.getCustomerGraphicalReports({
        branchIds: Array.isArray(branchIds) ? branchIds : [branchIds],
        startingDate,
        endingDate,
        customerId,
      });

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: result.message,
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in customerGraphicalReports:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * GET /customers/customerOutstandingReportTable
   * Get customer outstanding report with pagination
   * PHP: customers.php -> customerOutstandingReportTable()
   */
  async customerOutstandingReportTable(req, res) {
    try {
      this.setRequestContext(req);

      const limit = parseInt(req.query.limit, 10) || 5;
      const page = parseInt(req.query.page, 10) || 1;
      const branchIds = req.query.branch || req.query['branch[]'] || [];
      const startingDate = req.query.starting_date;
      const endingDate = req.query.ending_date;
      const customerId = req.query.field_input || '';

      // Check user access
      const userAccess = this.user?.access?.report?.read ?? false;
      if (!userAccess) {
        return res.status(403).json({
          type: 'error',
          message: 'Unauthorized',
          data: null,
        });
      }

      const result = await this.service.getCustomerOutstandingReport({
        branchIds: Array.isArray(branchIds) ? branchIds : [branchIds],
        startingDate,
        endingDate,
        customerId,
        page,
        limit,
      });

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          message: 'Get Successfully',
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: 'Customer Details Not Found',
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in customerOutstandingReportTable:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }
}

module.exports = new CustomerController();
