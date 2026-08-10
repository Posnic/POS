// src/controllers/categories.controller.js
const BaseController = require('./base.controller');
const CategoryService = require('../services/category.service');
const BaseModel = require('../models/base.model');
const Branch = require('../models/branch.model');
const { validationResult } = require('express-validator');
const { Types } = require('mongoose');
const { ObjectId } = require('mongodb');
const asyncHandler = require('express-async-handler');
const { DEFAULTS } = require('../constants/categories.constants');

/**
 * Categories Controller
 * Handles HTTP requests for category operations
 * Uses service layer for business logic
 */
class CategoriesController extends BaseController {
  constructor() {
    super();
    this.service = new CategoryService();
  }

  normalizeCategoryImage(image, req) {
    // Always fallback to default placeholder if missing or explicitly default
    if (!image || image === DEFAULTS.IMAGE || image === 'category.svg') {
      return DEFAULTS.IMAGE;
    }

    let value = String(image).trim();

    // Preserve data URLs and blob URLs as-is
    if (/^data:/i.test(value) || /^blob:/i.test(value)) {
      return value;
    }

    // Handle absolute HTTP/HTTPS URLs
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const pathname = url.pathname || '';

        // If this is a localhost URL pointing at /uploads/category_images,
        // rebuild it using the current request host so images work when the
        // API is not running on localhost.
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

        if (isLocalhost && pathname.startsWith('/uploads/category_images/')) {
          const filename = pathname.split('/').filter(Boolean).pop();
          if (!filename) {
            return DEFAULTS.IMAGE;
          }

          const base =
            (process.env.CLI_HOST && process.env.CLI_HOST.trim()) ||
            `${req.protocol}://${req.get('host')}`;
          const normalizedBase = base.replace(/\/+$/, '');

          return `${normalizedBase}/uploads/category_images/${filename}`;
        }

        // Non-localhost absolute URLs (e.g. S3/CDN) are fine as-is
        return value;
      } catch (e) {
        // If URL parsing fails, fall through to relative handling below
      }
    }

    // Normalize relative paths or bare filenames to /uploads/category_images/<file>
    value = value.replace(/^\/+/, '');
    let filename = value;

    if (value.includes('uploads/category_images/')) {
      filename = value.split('/').filter(Boolean).pop();
    } else if (value.includes('/')) {
      filename = value.split('/').filter(Boolean).pop();
    }

    if (!filename) {
      return DEFAULTS.IMAGE;
    }

    const base =
      (process.env.CLI_HOST && process.env.CLI_HOST.trim()) ||
      `${req.protocol}://${req.get('host')}`;
    const normalizedBase = base.replace(/\/+$/, '');

    return `${normalizedBase}/uploads/category_images/${filename}`;
  }

  /**
   * Helper: Resolve branch context from request
   */
  async resolveBranchContext(req) {
    if (req.tenantContext?.branchId) {
      return {
        branch_id: req.tenantContext.branchId,
        branch_name: req.tenantContext.branchName || '',
      };
    }

    // Priority order: session > body > query > user default > branch access
    // Session selectedBranchId should always take precedence
    const branchAccess = Array.isArray(req.user?.branch_access) ? req.user.branch_access : [];

    const branchCandidates = [
      req.session?.selectedBranchId,
      req.session?.branch_id,
      req.body?.branch_id,
      req.body?.branchId,
      req.body?.branch,
      req.body?.branch?._id,
      req.body?.branch?.id,
      req.body?.['branch_id[]'],
      req.query?.branch_id,
      req.query?.branch,
      req.query?.branch?._id,
      req.query?.branch?.id,
      req.query?.['branch_id[]'],
      req.user?.branch_id,
      req.user?.branch,
      req.user?.branch?._id,
      req.user?.branch?.id,
      req.user?.default_branch_id,
    ];

    let branch_id = null;
    for (const candidate of branchCandidates) {
      branch_id = this.resolveBranchIdCandidate(candidate);
      if (branch_id) break;
    }

    // Only use branch_access as fallback if no branch found
    if (!branch_id) {
      for (const candidate of branchAccess) {
        branch_id = this.resolveBranchIdCandidate(candidate);
        if (branch_id) break;
      }
    }

    const branchNameCandidates = [
      req.session?.branch_name,
      req.body?.branch_name,
      req.body?.branch?.name,
      req.body?.branch?.branch_name,
      req.query?.branch_name,
      req.query?.branch?.name,
      req.query?.branch?.branch_name,
      req.user?.branch_name,
      req.user?.branch?.name,
      req.user?.branch?.branch_name,
      ...(branchAccess || []).map((entry) => entry?.branch_name),
    ];

    let branch_name =
      branchNameCandidates.find((name) => typeof name === 'string' && name.trim()) || '';

    // Resolve the name from the selected branch ID. A session can retain the
    // previous branch name briefly after selectedBranchId changes.
    if (branch_id) {
      try {
        const branch = await Branch.findOne({
          _id: branch_id,
          license: req.tenantContext?.licenseId,
        })
          .select('branch_name')
          .lean();
        if (branch?.branch_name) {
          branch_name = branch.branch_name.trim();
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    return { branch_id, branch_name };
  }

  resolveBranchIdCandidate(value) {
    if (!value) return null;

    const asObjectId = (candidate) => {
      if (!candidate) return null;
      if (Types.ObjectId.isValid(candidate)) {
        return new Types.ObjectId(candidate);
      }
      return null;
    };

    const directObjectId = asObjectId(value);
    if (directObjectId) {
      return directObjectId;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const resolved = this.resolveBranchIdCandidate(entry);
        if (resolved) return resolved;
      }
      return null;
    }

    if (typeof value === 'object') {
      const possibleValues = [value.branch_id, value.branchId, value._id, value.id, value.$oid];

      for (const entry of possibleValues) {
        const resolved = this.resolveBranchIdCandidate(entry);
        if (resolved) return resolved;
      }
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return this.resolveBranchIdCandidate(parsed);
          }
        } catch {
          const segments = trimmed.split(',').map((item) => item.trim());
          return this.resolveBranchIdCandidate(segments);
        }
      }

      return asObjectId(trimmed);
    }

    if (typeof value === 'number') {
      return asObjectId(String(value));
    }

    return null;
  }

  /**
   * Get all categories with pagination
   * GET /categories
   */
  getAll = asyncHandler(async (req, res) => {
    if (!this.checkPermission('category', 'read', req.user)) {
      return this.error(res, 'Unauthorized', 401);
    }

    const pageParam = parseInt(req.query.page);
    const page = pageParam && pageParam > 0 ? pageParam : 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || req.query.q || '';
    const status = req.query.status || 'all';

    const { branch_id, branch_name } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    // Get license from user context - REQUIRED (match PHP pattern)
    const license = req.tenantContext?.licenseId || req.user?.license || req.user?.license_id;

    if (!license) {
      return this.error(res, 'License context is required', 400);
    }

    // Parse filters from query string - use current selected branch only
    // PHP: $filters['branch_id'] = self::$currentBranch; (no fallbacks, no overrides)
    const filters = {
      branch_id: branch_id.toString(),
      branch_name: branch_name.trim(),
      license: license.toString(),
    };

    if (search) {
      filters.search = search;
    }

    if (status && status !== 'all') {
      filters.status = status;
    }

    if (req.query.filters) {
      try {
        const queryFilters =
          typeof req.query.filters === 'string' ? JSON.parse(req.query.filters) : req.query.filters;

        // Pass through name filter for regex handling in service
        if (queryFilters.name) {
          filters.name = queryFilters.name;
        }

        // Pass through description filter for regex handling in service
        if (queryFilters.description) {
          filters.description = queryFilters.description;
        }

        // Convert date strings to Date objects for MongoDB queries
        if (queryFilters.updated_date) {
          filters.updated_date = queryFilters.updated_date;
        }
        if (queryFilters.created_date) {
          filters.created_date = queryFilters.created_date;
        }
      } catch (e) {
        console.error('Error parsing filters:', e);
      }
    }

    const result = await this.service.getAllCategories(filters, { page, limit });

    if (result.status) {
      const list = (result.data.data || []).map((category) => ({
        ...category,
        image: this.normalizeCategoryImage(category.image, req),
        discount_amount: category.discount_amount || DEFAULTS.DISCOUNT_AMOUNT,
        discount_percentage: category.discount_percentage || DEFAULTS.DISCOUNT_PERCENTAGE,
      }));

      return this.success(
        res,
        {
          list,
          total: result.data.total,
          current_page: result.data.page,
          per_page: result.data.limit,
          total_pages: result.data.totalPages,
        },
        result.message
      );
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Get categories for index/listing with pagination
   * GET /categories/index
   */
  index = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search = '', status = 'all' } = req.query;
    const { branch_id, branch_name } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    const license = req.tenantContext?.licenseId || req.user?.license || req.user?.license_id;
    if (!license) {
      return this.error(res, 'License context is required', 400);
    }

    const filters = {
      branch_id: branch_id.toString(),
      branch_name: branch_name.trim(),
      license: license.toString(),
      search,
      status: status === 'all' ? undefined : status,
    };

    const result = await this.service.getAllCategories(filters, {
      page: parseInt(page),
      limit: parseInt(limit),
    });

    if (result.status) {
      const formatted = {
        total: result.data.total,
        total_pages: result.data.totalPages,
        current_page: result.data.page,
        per_page: result.data.limit,
        list: result.data.data.map((category) => ({
          _id: category._id?.toString?.() || category._id,
          name: category.name,
          image: this.normalizeCategoryImage(category.image, req),
          discount_amount: category.discount_amount || DEFAULTS.DISCOUNT_AMOUNT,
          discount_percentage: category.discount_percentage || DEFAULTS.DISCOUNT_PERCENTAGE,
          description: category.description || DEFAULTS.DESCRIPTION,
          is_active: category.is_active !== undefined ? category.is_active : DEFAULTS.IS_ACTIVE,
        })),
      };

      return this.success(res, formatted, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Create new category
   * POST /categories
   */
  create = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.error(res, 'Validation failed', 400, errors.array());
    }

    const { branch_id, branch_name } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    // Always derive branch_name from the RESOLVED branch_id so the two can never
    // disagree (PHP: branch_name => self::$currentBranchName, always the current
    // branch). The candidate-based branch_name from resolveBranchContext can belong
    // to a DIFFERENT branch (e.g. branch_access[0]) — that bug stamped every
    // category with the first branch's name ("posnic") regardless of the actual
    // branch_id. The branches collection's only name field is `branch_name`.
    let finalBranchName = '';
    if (branch_id) {
      try {
        const branchDoc = await Branch.findOne({
          _id: branch_id,
          license: req.tenantContext?.licenseId,
        })
          .select('branch_name')
          .lean();
        finalBranchName = (branchDoc?.branch_name || '').trim();
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }
    // Only if the DB lookup found nothing, fall back to the resolved candidate name.
    if (!finalBranchName) {
      finalBranchName = (branch_name || '').trim();
    }

    const categoryData = {
      name: req.body.name,
      description: req.body.description || DEFAULTS.DESCRIPTION,
      image: req.body.image || DEFAULTS.IMAGE,
      discount_amount: parseFloat(req.body.discount_amount) || DEFAULTS.DISCOUNT_AMOUNT,
      discount_percentage: parseFloat(req.body.discount_percentage) || DEFAULTS.DISCOUNT_PERCENTAGE,
      is_active: req.body.is_active !== undefined ? req.body.is_active : DEFAULTS.IS_ACTIVE,
      sort_order: parseInt(req.body.sort_order) || DEFAULTS.SORT_ORDER,
      branch_id: new ObjectId(branch_id), // PHP: self::$currentBranch  (session current branch)
      branch_name: finalBranchName, // PHP: self::$currentBranchName
    };

    const license = req.tenantContext?.licenseId || req.user?.license || req.user?.license_id;
    if (!license) {
      return this.error(res, 'License context is required', 400);
    }
    categoryData.license = new ObjectId(license);

    // Add created by information
    if (req.user) {
      const userIdentifier = req.user.username || req.user.email || req.user.name;
      categoryData.created_by = userIdentifier;
      if (req.user._id || req.user.id) {
        categoryData.created_by_id = new ObjectId(req.user._id || req.user.id);
      }
    }

    // Validate discount logic
    if (categoryData.discount_amount > 0 && categoryData.discount_percentage > 0) {
      return this.error(res, 'Enter discount_amount or discount_percentage, not both', 400);
    }

    const result = await this.service.createCategory(categoryData);

    if (result.status) {
      return this.success(res, result.data, result.message, 201);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Update category
   * PUT /categories/:id
   */
  update = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.error(res, 'Validation failed', 400, errors.array());
    }

    const id = req.params.id;
    const { branch_id } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    const updateData = {};

    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (req.body.description !== undefined) updateData.description = req.body.description;
    if (req.body.image !== undefined) updateData.image = req.body.image;
    if (req.body.is_active !== undefined) updateData.is_active = req.body.is_active;
    if (req.body.sort_order !== undefined) updateData.sort_order = parseInt(req.body.sort_order);

    // Handle discount fields with mutual exclusivity
    if (req.body.discount_amount !== undefined && req.body.discount_percentage === undefined) {
      updateData.discount_amount = parseFloat(req.body.discount_amount) || 0;
      updateData.discount_percentage = 0;
    } else if (
      req.body.discount_percentage !== undefined &&
      req.body.discount_amount === undefined
    ) {
      updateData.discount_percentage = parseFloat(req.body.discount_percentage) || 0;
      updateData.discount_amount = 0;
    } else if (
      req.body.discount_amount !== undefined &&
      req.body.discount_percentage !== undefined
    ) {
      const discountAmount = parseFloat(req.body.discount_amount) || 0;
      const discountPercentage = parseFloat(req.body.discount_percentage) || 0;

      if (discountAmount > 0 && discountPercentage > 0) {
        return this.error(res, 'Enter discount_amount or discount_percentage, not both', 400);
      }

      updateData.discount_amount = discountAmount;
      updateData.discount_percentage = discountPercentage;
    }

    // Add updated by information
    if (req.user) {
      const userIdentifier = req.user.username || req.user.email || req.user.name;
      updateData.updated_by = userIdentifier;
      if (req.user._id || req.user.id) {
        updateData.updated_by_id = new ObjectId(req.user._id || req.user.id);
      }
    }

    const result = await this.service.updateCategory(id, updateData);

    if (result.status) {
      return this.success(res, result.data, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Toggle category status
   * PUT /categories/:id/toggle-status
   */
  toggleStatus = asyncHandler(async (req, res) => {
    const id = req.params.id;
    const { is_active } = req.body;

    const result = await this.service.updateCategory(id, { is_active });

    if (result.status) {
      return this.success(
        res,
        result.data,
        `Category ${is_active ? 'activated' : 'deactivated'} successfully`
      );
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Get categories for dropdown/select options
   * GET /categories/options
   */
  getOptions = asyncHandler(async (req, res) => {
    const { search = '' } = req.query;
    const { branch_id } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    const result = await this.service.getActiveCategories(branch_id.toString());

    if (result.status) {
      const options = result.data.map((cat) => ({
        _id: cat._id,
        name: cat.name,
      }));

      // Apply search filter if provided
      const filtered = search
        ? options.filter((opt) => opt.name.toLowerCase().includes(search.toLowerCase()))
        : options;

      return this.success(res, filtered, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Get category AJAX list for autocomplete
   * GET /categories/ajax-list
   */
  getCategoryAjaxList = asyncHandler(async (req, res) => {
    const query = req.query.query || '';
    const { branch_id } = await this.resolveBranchContext(req);
    const license = req.user?.license || req.user?.license_id || null;

    const options = {
      page: 1,
      limit: 50,
      branchId: branch_id ? branch_id.toString() : null,
      license: license ? license.toString() : null,
    };

    const result = query
      ? await this.service.searchCategories(query, options)
      : await this.service.getCategoriesByBranch(
          branch_id.toString(),
          false,
          license ? license.toString() : null
        );

    if (result.status) {
      const categories = result.data.data || result.data;
      const suggestions = categories.map((cat) => ({
        id: cat._id.toString(),
        name: cat.name || '',
        discount_amount: cat.discount_amount || 0,
        discount_percentage: cat.discount_percentage || 0,
        description: cat.description || '',
      }));

      return res.status(200).json({
        query,
        suggestions,
      });
    } else {
      return this.error(res, result.message, 500);
    }
  });

  /**
   * Get categories with valid items
   * GET /categories/with-items
   */
  getCategoriesWithValidItems = asyncHandler(async (req, res) => {
    const { branch_id } = await this.resolveBranchContext(req);

    console.log('🔍 getCategoriesWithValidItems - branch_id:', branch_id);
    console.log('🔍 Session:', req.session?.branch_id, req.session?.selectedBranchId);
    console.log('🔍 User branch_access:', req.user?.branch_access);

    const license =
      req.user?.license?.toString?.() ||
      req.user?.license_id?.toString?.() ||
      (typeof req.user?.license === 'string' ? req.user.license : null);

    // Use getCategoriesWithItems to only return categories that have items
    const result = await this.service.getCategoriesWithItems(
      branch_id ? branch_id.toString() : null,
      true,
      license
    );

    console.log('🔍 Categories result:', { status: result.status, count: result.data?.length });

    if (result.status) {
      // Format for legacy compatibility
      const formatted = result.data.map((cat) => ({
        id: cat._id,
        category_name: cat.name,
        category_img: this.normalizeCategoryImage(cat.image, req),
        name: cat.name,
        description: cat.description || '',
      }));

      console.log('✅ Returning', formatted.length, 'categories (with items only)');

      return this.success(res, formatted, 'Categories with valid items retrieved successfully');
    } else {
      console.log('❌ Error:', result.message);
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Bulk import categories
   * POST /categories/import
   */
  categoriesImport = asyncHandler(async (req, res) => {
    if (!this.checkPermission('category', 'write', req.user)) {
      return this.error(res, 'Unauthorized', 401);
    }

    const rows = req.body.result || req.body.categories || [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return this.error(res, 'No categories to import', 400);
    }

    const { branch_id, branch_name } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required for import', 400);
    }

    // Fetch branch_name from database if empty
    let finalBranchName = branch_name;
    if (branch_id && !finalBranchName) {
      try {
        const branchesCollection = await BaseModel.prototype.getCollection.call(
          { collectionName: 'branches' },
          'branches'
        );
        const branchDoc = await branchesCollection.findOne({
          _id: new ObjectId(branch_id),
          license: req.tenantContext?.licenseId,
        });
        if (branchDoc) {
          finalBranchName = branchDoc.name || branchDoc.branch_name || '';
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    // Get license from user context
    const license = req.user?.license || req.user?.license_id;

    // Set BaseModel context for import operations
    BaseModel.currentBranch = new ObjectId(branch_id);
    BaseModel.currentBranchName = finalBranchName;
    if (license) {
      BaseModel.license = new ObjectId(license);
    }
    if (req.user?._id) {
      BaseModel.loggedUser = new ObjectId(req.user._id);
      BaseModel.loggedUserName = req.user?.username || req.user?.email || req.user?.name || '';
    }

    // Prepare categories with branch context
    const categoriesData = rows.map((row) => {
      const categoryData = {
        ...row,
        branch_id: new ObjectId(branch_id),
        branch_name: finalBranchName,
        created_by: req.user?.username || req.user?.email || req.user?.name,
        created_by_id: req.user?._id ? new ObjectId(req.user._id) : undefined,
      };

      // Add license if available
      if (license) {
        categoryData.license = new ObjectId(license);
      }

      return categoryData;
    });

    const result = await this.service.bulkImport(categoriesData);

    if (result.status) {
      return this.success(res, result.data, result.message);
    } else {
      return this.error(res, result.message, 400, result.data);
    }
  });

  /**
   * Export categories
   * POST /categories/export
   */
  exportCategories = asyncHandler(async (req, res) => {
    if (!this.checkPermission('category', 'read', req.user)) {
      return this.error(res, 'Unauthorized', 401);
    }

    const rawBody = req.body;

    const extractIds = (body) => {
      if (!body) return [];
      if (Array.isArray(body)) return body;
      if (Array.isArray(body.data)) return body.data;

      if (typeof body.data === 'string') {
        const trimmed = body.data.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
          } catch {}
        }
      }

      if (typeof body === 'string') {
        const trimmed = body.trim();
        if (!trimmed) return [];
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      const values = Object.values(body);
      if (values.length === 1 && typeof values[0] === 'string' && values[0].trim()) {
        const candidate = values[0].trim();
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }

      if (values.length > 0 && values.every((v) => typeof v === 'string')) {
        return values;
      }

      return [];
    };

    const ids = extractIds(rawBody);

    if (!Array.isArray(ids) || ids.length === 0) {
      return this.error(res, 'No categories selected for export', 400);
    }

    const objectIds = ids
      .filter((id) => typeof id === 'string' && Types.ObjectId.isValid(id))
      .map((id) => id);

    if (!objectIds.length) {
      return this.error(res, 'Invalid category IDs', 400, ids);
    }

    // Get categories by IDs
    const categories = [];
    for (const id of objectIds) {
      const result = await this.service.getCategoryById(id);
      if (result.status && result.data) {
        categories.push(result.data);
      }
    }

    const rows = categories.map((cat) => ({
      name: cat.name || '',
      discount_amount: cat.discount_amount || 0,
      discount_percentage: cat.discount_percentage || 0,
      description: cat.description || '',
    }));

    return this.success(res, rows, 'Categories Exported Successfully');
  });

  /**
   * Delete category by ID (soft delete)
   * DELETE /categories/:id
   */
  deleteCategory = asyncHandler(async (req, res) => {
    if (!this.checkPermission('category', 'delete', req.user)) {
      return this.error(res, 'Unauthorized', 401);
    }

    const id = req.params.id;
    const { branch_id } = await this.resolveBranchContext(req);

    if (!branch_id) {
      return this.error(res, 'Branch context is required', 400);
    }

    const result = await this.service.deleteCategory(id);

    if (result.status) {
      return this.success(res, result.data, result.message);
    } else {
      return this.error(res, result.message, 400);
    }
  });

  /**
   * Bulk delete categories
   * DELETE /categories/delete
   * POST /categories/bulk-delete
   */
  bulkDelete = asyncHandler(async (req, res) => {
    if (!this.checkPermission('category', 'delete', req.user)) {
      return this.error(res, 'Unauthorized', 401);
    }

    const ids = req.body.data || req.body.ids || req.body;

    if (!ids || (Array.isArray(ids) && ids.length === 0)) {
      return this.error(res, 'Category IDs are required', 400);
    }

    const idsArray = Array.isArray(ids) ? ids : [ids];

    const result = await this.service.bulkDeleteCategories(idsArray);

    if (result.status) {
      return this.success(res, result.data, result.message);
    } else {
      // For PHP-compatible behaviour, return HTTP 200 even for business-rule
      // failures (e.g. categories with associated items). The payload still
      // uses type: 'error', so the frontend can show a proper error toast
      // without jQuery treating it as an uncaught AJAX error.
      return this.error(res, result.message, 200);
    }
  });

  /**
   * Legacy delete alias for route compatibility
   */
  delete = asyncHandler(async (req, res) => {
    return this.bulkDelete(req, res);
  });

  /**
   * Delete category image (legacy PHP: categoryImageDelete)
   * DELETE /categories/categoryImageDelete
   */
  categoryImageDelete = asyncHandler(async (req, res) => {
    try {
      if (!this.checkPermission('category', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 401);
      }

      const body = req.body || {};
      const categoryId = body.id || body.category_id || body._id;
      const imageValue = body.data || body.image || null;

      if (!categoryId) {
        return this.error(res, 'Category Id Not Found', 400);
      }

      const { branch_id } = await this.resolveBranchContext(req);
      if (!branch_id) {
        return this.error(res, 'Branch context is required', 400);
      }

      // Load category to validate ownership and get current image
      const existingResult = await this.service.getCategoryById(categoryId);
      if (!existingResult.status || !existingResult.data) {
        return this.error(res, existingResult.message || 'Category not found', 404);
      }

      const category = existingResult.data;

      if (
        category.branch_id &&
        branch_id &&
        category.branch_id.toString &&
        category.branch_id.toString() !== branch_id.toString()
      ) {
        // Prevent deleting image from a different branch
        return this.error(res, 'Category not found', 404);
      }

      const currentImage = imageValue || category.image || DEFAULTS.IMAGE;
      const storageType = process.env.STORAGE_TYPE || 'local';

      if (currentImage && currentImage !== DEFAULTS.IMAGE) {
        if (storageType === 's3') {
          try {
            const url = new URL(currentImage);
            const key = url.pathname.replace(/^\/+/, '');
            if (key) {
              await require('../utils/s3').deleteObject(key);
            }
          } catch (err) {
            // Log and continue; DB will still be updated to default image
            console.error('Error deleting category image from S3:', err);
          }
        } else {
          const fs = require('fs');
          const path = require('path');
          try {
            let relativePath = currentImage;

            // If we received a full URL, strip protocol/host and keep pathname
            if (/^https?:\/\//i.test(currentImage)) {
              const parsed = new URL(currentImage);
              relativePath = parsed.pathname.replace(/^\/+/, '');
            }

            // Ensure we resolve within the ApiV2 project root
            const filePath = path.join(__dirname, '../../', relativePath);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (err) {
            // Log and continue; DB will still be updated to default image
            console.error('Error deleting local category image file:', err);
          }
        }
      }

      // Reset image field back to default placeholder
      const updateResult = await this.service.updateCategory(categoryId, {
        image: DEFAULTS.IMAGE,
      });

      if (!updateResult.status) {
        return this.error(res, updateResult.message || 'Image not deleted', 400);
      }

      // Match legacy PHP wording and response shape
      return this.success(res, DEFAULTS.IMAGE, 'Image was deleted');
    } catch (error) {
      return this.error(res, error?.message || 'Image not deleted', 500);
    }
  });

  /**
   * Upload category image
   * POST /categories/upload-image
   */
  uploadCategoryImage = asyncHandler(async (req, res) => {
    const fs = require('fs');
    const path = require('path');

    if (!req.file || !req.file.originalname) {
      return this.success(res, DEFAULTS.IMAGE, 'Image uploaded successfully');
    }

    const allowedExtensions = [
      'gif',
      'GIF',
      'jpg',
      'JPG',
      'png',
      'PNG',
      'jpeg',
      'JPEG',
      'bmp',
      'BMP',
    ];
    const fileExtension = path.extname(req.file.originalname).substring(1);

    if (!allowedExtensions.includes(fileExtension)) {
      return this.error(
        res,
        'Upload valid images. Only GIF, PNG, JPG, JPEG and BMP are allowed.',
        400
      );
    }

    if (req.file.size > 5242880) {
      return this.error(res, 'Image size exceeds 5MB', 400);
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const uniqueId = Math.random().toString(36).substring(2, 15);
    const filename = `${timestamp}-posnic_category-${uniqueId}.${fileExtension}`;

    const storageType = process.env.STORAGE_TYPE || 'local';

    if (storageType === 's3') {
      try {
        // No ACL: the bucket has ACLs disabled and rejects any PutObject that
        // carries one. Whether the object is publicly readable is the bucket
        // policy's decision.
        const result = await require('../utils/s3').uploadObject({
          key: filename,
          filePath: req.file.path,
          contentType: req.file.mimetype,
        });
        fs.unlinkSync(req.file.path);
        return this.success(res, result.Location, 'Image uploaded successfully');
      } catch (error) {
        return this.error(res, error.message, 404);
      }
    } else {
      const uploadDir = path.join(__dirname, '../../uploads/category_images/');

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const targetPath = path.join(uploadDir, filename);

      try {
        fs.renameSync(req.file.path, targetPath);

        const base =
          (process.env.CLI_HOST && process.env.CLI_HOST.trim()) ||
          `${req.protocol}://${req.get('host')}`;
        const normalizedBase = base.replace(/\/+$/, '');
        const imageUrl = `${normalizedBase}/uploads/category_images/${filename}`;
        return this.success(res, imageUrl, 'Image uploaded successfully');
      } catch (error) {
        return this.error(res, 'Image not uploaded', 404);
      }
    }
  });
}

module.exports = new CategoriesController();
