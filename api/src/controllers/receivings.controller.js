// src/controllers/receivings_controller.js
const mongoose = require('mongoose');
const { currentConnection } = require('../db/tenant-context');
const fs = require('fs');
const path = require('path');
const BaseController = require('./base.controller');
const BaseModel = require('../models/base.model');

const Receiving = require('../models/receiving.model');
const Branch = require('../models/branch.model');
const { ObjectId } = require('mongodb');
require('../utils/appError');
const { formatDate } = require('../utils/helpers');
const config = require('../config/config');

const extractNumericValue = (value) => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]+/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.' || cleaned === '.-') {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const numberOrZero = (value, fallback = 0) => {
  const parsed = extractNumericValue(value);
  return parsed === null ? fallback : parsed;
};

const roundToTwo = (value = 0) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const toNumberExpression = (expression, fallback = 0) => ({
  $convert: {
    input: expression,
    to: 'double',
    onError: fallback,
    onNull: fallback,
  },
});

class ReceivingsController extends BaseController {
  constructor() {
    super(Receiving);
  }

  setRequestContext(req) {
    const user = req.user || {};
    const sessionBranch =
      req.tenantContext?.branchId || req.session?.selectedBranchId || req.session?.branch_id;
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

    const branchParam =
      sessionBranch ||
      req.query?.branch_id ||
      req.query?.branch ||
      req.body?.branch_id ||
      req.body?.branch ||
      user.branch_id ||
      (user.branch && (user.branch._id || user.branch.id)) ||
      user.default_branch_id ||
      (branchAccessEntry && (branchAccessEntry.branch_id || branchAccessEntry._id)) ||
      null;

    if (branchParam) {
      const raw = Array.isArray(branchParam) ? branchParam[0] : branchParam;
      if (raw instanceof mongoose.Types.ObjectId) {
        BaseModel.currentBranch = raw;
      } else if (mongoose.Types.ObjectId.isValid(String(raw))) {
        BaseModel.currentBranch = new mongoose.Types.ObjectId(String(raw));
      } else {
        BaseModel.currentBranch = raw;
      }
    }

    const licenseParam =
      req.tenantContext?.licenseId ||
      user.license ||
      user.license_id ||
      req.query?.license_id ||
      req.body?.license_id ||
      null;

    if (licenseParam) {
      if (licenseParam instanceof mongoose.Types.ObjectId) {
        BaseModel.license = licenseParam;
      } else if (mongoose.Types.ObjectId.isValid(String(licenseParam))) {
        BaseModel.license = new mongoose.Types.ObjectId(String(licenseParam));
      } else {
        BaseModel.license = licenseParam;
      }
    }

    if (user._id) {
      if (user._id instanceof mongoose.Types.ObjectId) {
        BaseModel.loggedUser = user._id;
      } else if (mongoose.Types.ObjectId.isValid(String(user._id))) {
        BaseModel.loggedUser = new mongoose.Types.ObjectId(String(user._id));
      } else {
        BaseModel.loggedUser = user._id;
      }
    }

    // Prefer login identifier (username/email) for audit trails
    const userName = user.username || user.email || user.name;
    if (userName) {
      BaseModel.loggedUserName = userName;
    }
  }

  async ensureContext(req) {
    this.setRequestContext(req);
  }

  /**
   * PHP: add()
   * Create a new receiving order
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async create(req, res) {
    try {
      if (!this.checkPermission('receiving', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Ensure BaseModel context (branch, license, user) is set so that
      // receivingInsertUpdate can correctly create stock logs and use
      // branch settings (stock_management, stock_management_log),
      // mirroring the behaviour of other modules like sales/items.
      await this.ensureContext(req);

      const data = req.body;

      // Validate required fields
      if (!data.supplier_name || data.supplier_name.trim().length < 3) {
        return this.error(res, 'Validation Error', 400, {
          supplier_name: 'Supplier name is required and must be at least 3 characters',
        });
      }

      const result = await Receiving.receivingInsertUpdate(data, null);
      if (result.status === true) {
        /* PO receive bridge: a receiving born from a purchase order updates
           the PO's mirror AFTER the receipt is real. Fire-safe - the receipt
           never fails because the mirror hiccuped. */
        if (data.source_po_id) {
          const { syncPoFromReceivings } = require('../services/po-receive-bridge');
          await syncPoFromReceivings(data.source_po_id, {
            branchId: req.tenantContext?.branchId || BaseModel.currentBranch,
            licenseId: req.tenantContext?.licenseId || BaseModel.license,
          }).catch(() => {});
        }
        return this.success(res, result.data, result.message || 'Receiving created successfully');
      }

      return this.error(res, result.message || 'Failed to create receiving', 400, result.data);
    } catch (error) {
      console.error('Error in create:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: edit()
   * Update an existing receiving order
   */
  async update(req, res) {
    try {
      if (!this.checkPermission('receiving', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Ensure BaseModel context (branch, license, user) is set before
      // delegating to receivingInsertUpdate so that stock logs for
      // Edit Receiving use the correct branch and license values.
      await this.ensureContext(req);

      const id = req.params.id;
      const data = req.body;

      if (!id) {
        return this.error(res, 'Receiving ID is required', 400);
      }

      if (!data.supplier_name || data.supplier_name.trim().length < 3) {
        return this.error(res, 'Validation Error', 400, {
          supplier_name: 'Supplier name is required and must be at least 3 characters',
        });
      }

      console.log('🔧 UPDATE - Receiving ID:', id);
      console.log('🔧 UPDATE - supplier_id:', data.supplier_id);
      console.log('🔧 UPDATE - supplier_id type:', typeof data.supplier_id);
      console.log('🔧 UPDATE - Full data keys:', Object.keys(data));

      const result = await Receiving.receivingInsertUpdate(data, id);

      console.log('🔧 UPDATE - Result status:', result.status);
      console.log('🔧 UPDATE - Result message:', result.message);

      if (result.status === true) {
        // Same bridge as create: edited quantities re-sync the PO mirror.
        if (data.source_po_id) {
          const { syncPoFromReceivings } = require('../services/po-receive-bridge');
          await syncPoFromReceivings(data.source_po_id, {
            branchId: req.tenantContext?.branchId || BaseModel.currentBranch,
            licenseId: req.tenantContext?.licenseId || BaseModel.license,
          }).catch(() => {});
        }
        return this.success(res, result.data, result.message || 'Receiving updated successfully');
      }

      return this.error(res, result.message || 'Failed to update receiving', 400, result.data);
    } catch (error) {
      console.error('Error in update:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: receivedReceiving()
   * Mark receiving as "Received" status
   */
  async receivedReceiving(req, res) {
    try {
      if (!this.checkPermission('receiving', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { id } = req.body;

      if (!id) {
        return this.error(res, 'Receiving ID is required', 400);
      }

      // Set BaseModel context
      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }
      if (req.user && req.user._id) {
        BaseModel.loggedUser = req.user._id;
      }
      if (req.user && (req.user.name || req.user.username || req.user.email)) {
        BaseModel.loggedUserName = req.user.name || req.user.username || req.user.email;
      }
      if (req.session && req.session.selectedBranchId) {
        BaseModel.currentBranch = req.session.selectedBranchId;
      }

      // Get the existing receiving to update its status
      const existingReceiving = await Receiving.getReceivingOrder(id);

      if (!existingReceiving.status) {
        return this.error(res, existingReceiving.message || 'Receiving not found', 404);
      }

      // Update the status to "Received"
      const data = {
        ...existingReceiving.data,
        status: 'Received',
      };

      const result = await Receiving.receivingInsertUpdate(data, id);

      if (result.status === true) {
        return this.success(
          res,
          result.data,
          result.message || 'Receiving marked as received successfully'
        );
      }

      return this.error(
        res,
        result.message || 'Failed to mark receiving as received',
        400,
        result.data
      );
    } catch (error) {
      console.error('Error in receivedReceiving:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnReceiving()
   * Process return of receiving items
   */
  async returnReceiving(req, res) {
    try {
      if (!this.checkPermission('receiving', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const data = req.body;

      // Set BaseModel context
      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }
      if (req.user && req.user._id) {
        BaseModel.loggedUser = req.user._id;
      }
      if (req.user && (req.user.name || req.user.username || req.user.email)) {
        BaseModel.loggedUserName = req.user.name || req.user.username || req.user.email;
      }
      if (req.session && req.session.selectedBranchId) {
        BaseModel.currentBranch = req.session.selectedBranchId;
      }

      const result = await Receiving.returnReceivingOrder(data);

      if (result.status === true) {
        return this.success(
          res,
          result.data,
          result.message || 'Return receiving updated successfully'
        );
      }

      return this.error(
        res,
        result.message || 'Failed to process return receiving',
        400,
        result.data
      );
    } catch (error) {
      console.error('Error in returnReceiving:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: uploadReceivingImage()
   * Upload receiving images
   */
  async uploadReceivingImage(req, res) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const config = require('../config/config');

      const allowedExtensions = ['gif', 'jpg', 'png', 'jpeg', 'bmp', 'pdf'];
      const maxFileSize = 5242880; // 5MB

      const { receiving_image } = req.body;

      if (!receiving_image || !Array.isArray(receiving_image)) {
        return this.error(res, 'No images provided', 400);
      }

      const returnNames = [];

      for (const imageData of receiving_image) {
        const { data, name, size } = imageData;

        if (!data || !name) {
          continue;
        }

        // Get file extension
        const extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase();

        // Validate extension
        if (!allowedExtensions.includes(extension)) {
          return this.error(
            res,
            'Upload valid images. Only GIF, PNG, JPG, JPEG, BMP and PDF are allowed.',
            400
          );
        }

        // Validate size
        if (size > maxFileSize) {
          return this.error(res, 'Image size exceeds 5MB', 400);
        }

        // Generate unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueId = Date.now() + Math.random().toString(36).substring(2, 15);
        const fileName = `${timestamp}-posnic_receiving_image-${uniqueId}.${extension}`;

        // Decode base64 data
        const buffer = Buffer.from(data, 'base64');

        // Save to local storage
        const uploadDir = path.join(config.uploadDir || './uploads', 'receiving_images');

        // Ensure directory exists
        await fs.mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, fileName);
        await fs.writeFile(filePath, buffer);

        // Return the URL
        // Prefer an explicit CLI host from config if provided; otherwise,
        // build the URL dynamically from the current request so that
        // attachments are always served from the same origin (protocol/host)
        // that the frontend is using.
        const requestHost = `${req.protocol}://${req.get('host')}`;
        const baseHost = config.cliHost || requestHost;
        const fileUrl = `${baseHost}/uploads/receiving_images/${fileName}`;

        returnNames.push({
          name: fileUrl,
          size: size,
        });
      }

      return this.success(res, returnNames, 'Image uploaded successfully');
    } catch (error) {
      console.error('Error in uploadReceivingImage:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: delete()
   * Delete receiving orders
   */
  async delete(req, res) {
    try {
      if (!this.checkPermission('receiving', 'delete', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Set BaseModel context for the delete operation
      const BaseModel = require('../models/base.model');
      const { ObjectId } = require('mongodb');

      // Set license
      if (req.user && req.user.license) {
        BaseModel.license = ObjectId.isValid(req.user.license)
          ? new ObjectId(req.user.license)
          : req.user.license;
      }

      // Set logged user
      if (req.user && req.user._id) {
        BaseModel.loggedUser = ObjectId.isValid(req.user._id)
          ? new ObjectId(req.user._id)
          : req.user._id;
      }
      if (req.user && (req.user.name || req.user.username || req.user.email)) {
        BaseModel.loggedUserName = req.user.name || req.user.username || req.user.email;
      }

      // Set current branch from session (prioritize session over user object)
      const branchId =
        req.session?.selectedBranchId ||
        req.session?.branch_id ||
        req.user?.branch_id ||
        req.user?.branch?._id;
      if (branchId) {
        BaseModel.currentBranch = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      }

      // Set current branch name - fetch from DB if empty
      let branchName = req.user?.branch_name || req.user?.branch?.branch_name || '';
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
      if (branchName) {
        BaseModel.currentBranchName = branchName;
      }

      console.log('🗑️ Delete receivings - BaseModel context:', {
        currentBranch: BaseModel.currentBranch?.toString(),
        currentBranchName: BaseModel.currentBranchName,
        license: BaseModel.license?.toString(),
        loggedUser: BaseModel.loggedUser?.toString(),
      });

      const ids = req.body.data || req.body.ids || req.body;
      if (!ids || (Array.isArray(ids) && ids.length === 0)) {
        return this.error(res, 'Receiving ID required', 400);
      }

      console.log('🗑️ Delete request - IDs:', ids);
      console.log('🗑️ Delete request - User license:', req.user?.license);

      const result = await Receiving.deleteReceivingCollectionData(ids);
      if (result.status === true) {
        return this.success(res, result.data, 'Receiving deleted successfully');
      }

      return this.error(res, result.message || 'Receiving Not deleted', 404, result.data);
    } catch (error) {
      console.error('Error in delete:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportReceivings()
   * Export receiving data by IDs
   */
  async exportReceivings(req, res) {
    try {
      if (!this.checkPermission('receiving', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Set BaseModel context
      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      // Handle different input formats
      let ids = req.body.data || req.body.ids || req.body;

      // Ensure ids is an array
      if (!Array.isArray(ids)) {
        if (typeof ids === 'string') {
          ids = [ids];
        } else if (typeof ids === 'object' && ids !== null) {
          // If it's an object, try to extract array from common properties
          ids = Object.values(ids);
        } else {
          return this.error(res, 'Invalid receiving IDs format', 400);
        }
      }

      if (!ids || ids.length === 0) {
        return this.error(res, 'Receiving IDs required', 400);
      }

      console.log('📤 exportReceivings - IDs:', ids);

      const result = await Receiving.exportReceivingsOrder(ids);
      if (result.status === true) {
        return this.success(res, result.data, 'Receivings exported successfully');
      }

      return this.error(
        res,
        result.message || 'Receivings exported unsuccessfully',
        404,
        result.data
      );
    } catch (error) {
      console.error('Error in exportReceivings:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get all receivings with filters
   */
  async getAll(req, res) {
    try {
      if (!this.checkPermission('receiving', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, parseInt(req.query.limit) || 10);

      // Parse filters from query string
      const filterQuery = {};
      if (req.query.filters) {
        try {
          const filters =
            typeof req.query.filters === 'string'
              ? JSON.parse(req.query.filters)
              : req.query.filters;

          // Handle date filters for updated_date
          if (filters.updated_date) {
            filterQuery.updated_date = {};

            if (filters.updated_date.$gte) {
              // Parse date string and convert to Date object
              const gteDate = new Date(filters.updated_date.$gte.trim());
              filterQuery.updated_date.$gte = gteDate;
            }

            if (filters.updated_date.$lte) {
              // Parse date string and convert to Date object
              const lteDate = new Date(filters.updated_date.$lte.trim());
              filterQuery.updated_date.$lte = lteDate;
            }
          }

          // Handle other filters if needed
          Object.keys(filters).forEach((key) => {
            if (key !== 'updated_date') {
              filterQuery[key] = filters[key];
            }
          });
        } catch (e) {
          console.error('Error parsing filters:', e);
        }
      }

      // Add branch_id filter (from session.selectedBranchId or session.branch_id)
      let branchId = req.session?.selectedBranchId || req.session?.branch_id;
      if (!branchId && req.user?.branch_access && req.user.branch_access.length > 0) {
        branchId = req.user.branch_access[0].branch_id;
      }
      if (branchId) {
        filterQuery.branch_id = new ObjectId(branchId);
      }

      // Add license filter
      if (req.user?.license) {
        filterQuery.license = new ObjectId(req.user.license);
      }

      console.log('DEBUG - receivings getAll filter:', {
        branchId,
        license: req.user?.license,
        filterQuery: JSON.stringify(filterQuery),
      });

      const result = await Receiving.find(filterQuery)
        .sort({ created_date: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const total = await Receiving.countDocuments(filterQuery);

      // PHP: MongoIDFilter + MongoDateFilter post-processing
      const list = result.map((item) => {
        const simplified = BaseModel.simplifyFields(item);
        // MongoDB documents use updated_date (not updated_at from schema timestamps)
        const dateField =
          item.updated_date || item.updated_at || item.created_date || item.created_at;
        return {
          string_date: formatDate(dateField),
          ...simplified,
        };
      });

      return this.success(
        res,
        {
          list,
          total,
          current_page: page,
          per_page: limit,
          total_pages: Math.ceil(total / limit),
        },
        'Get successfully'
      );
    } catch (error) {
      console.error('Error in getAll:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getOne()
   * Get a single receiving order by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getOne(req, res) {
    try {
      if (!this.checkPermission('receiving', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const id = req.params.id || req.query.id;
      if (!id) {
        return this.error(res, 'Receiving ID is required', 400);
      }

      const result = await Receiving.getReceivingOrder(id);
      if (result.status === true) {
        // Restructure data to put specific fields at the top
        const {
          exclusive_tax,
          print_logoimg,
          receipt_barcode,
          id: receivingId,
          return_discount,
          ...restData
        } = result.data;
        const orderedData = {
          exclusive_tax: exclusive_tax || 'off',
          print_logoimg: print_logoimg !== undefined ? print_logoimg : false,
          receipt_barcode: receipt_barcode !== undefined ? receipt_barcode : false,
          id: receivingId || null,
          return_discount: return_discount || null,
          ...restData,
        };
        return this.success(res, orderedData, 'get successfully');
      }

      return this.error(res, 'Receiving Details Not Found', 404, result.data);
    } catch (error) {
      console.error('Error in getOne:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: productBasedReceivingReturnDetails()
   * Get product-based receiving return details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async productBasedReceivingReturnDetails(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.productBasedReceivingReturnReportPage(data, options);
      if (result.status === true) {
        return this.success(
          res,
          {
            status: result.status,
            list: result.list || [],
            total: result.total || 0,
            current_page: result.current_page || page,
            total_pages: result.total_pages || 0,
            per_page: result.per_page || limit,
          },
          'Get Successfully'
        );
      } else {
        return this.error(res, 'Receiving Details Not Found', 404, result);
      }
    } catch (error) {
      console.error('Error in productBasedReceivingReturnDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: receivingReportTable()
   * Get receiving report table
   */
  async receivingReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.receivingReportPage(data, options);
      if (result.status === true) {
        const list = this.mongoDateFilter(this.mongoIDFilter(result.data?.list || []));
        return this.success(
          res,
          {
            total: result.data?.total || 0,
            current_page: result.data?.current_page || page,
            total_pages:
              result.data?.total_pages ||
              Math.max(Math.ceil((result.data?.total || 0) / (result.data?.per_page || limit)), 1),
            per_page: result.data?.per_page || limit,
            list,
          },
          list.length ? 'Get Successfully' : 'No records found'
        );
      }

      return this.error(res, 'Receiving Details Not Found', 404, result);
    } catch (error) {
      console.error('Error in receivingReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: receivingsGraphicalReports()
   * Get receivings graphical reports
   */
  async receivingsGraphicalReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.receivingsGraphicalReports(data);
      if (result.status === true) {
        return this.success(res, result.data, result.message || 'Graphical report successfully');
      }

      return this.error(
        res,
        result.message || 'Failed to fetch graphical report',
        404,
        result.data
      );
    } catch (error) {
      console.error('Error in receivingsGraphicalReports:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnReceivingReportTable()
   * Get return receiving report
   */
  async returnReceivingReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const BaseModel = require('../models/base.model');
      if (req.user && req.user.license) {
        BaseModel.license = req.user.license;
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.returnReceivingReportPage(data, options);
      if (result.status === true) {
        const list = this.mongoIDFilter(result.list || []);
        return this.success(
          res,
          {
            total: result.total || 0,
            current_page: result.current_page || page,
            total_pages:
              result.total_pages ||
              Math.max(Math.ceil((result.total || 0) / (result.per_page || limit)), 1),
            per_page: result.per_page || limit,
            list,
          },
          list.length ? 'Get Successfully' : 'No records found'
        );
      }

      return this.error(res, 'Receiving Details Not Found', 404, result);
    } catch (error) {
      console.error('Error in returnReceivingReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: pendingReceivingReportTable()
   * Get pending receivings report table data (partially paid purchases)
   */
  async pendingReceivingReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
      const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.pendingReceivingReportPage(data, options);
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in pendingReceivingReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: pendingSupplierReportTable()
   * Get pending supplier summary report table data
   */
  async pendingSupplierReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
      const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const result = await Receiving.pendingSupplierReportPage(data, options);
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in pendingSupplierReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnReceivingProductDetails()
   * Get return receiving product details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async returnReceivingProductDetails(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        receiving_id: req.query.receiving_id || '',
      };

      const result = await Receiving.returnReceivingProductReportPage(data, options);
      if (result.status === true) {
        return this.success(
          res,
          {
            status: result.status,
            custom_details: result.custom_details || Receiving.custom_details,
            total: result.total || (result.data ? result.data.length : 0),
            current_page: page,
            total_pages: Math.ceil((result.data ? result.data.length : 0) / limit),
            per_page: limit,
            list: this.mongoIDFilter(result.data || []),
          },
          'Get Successfully'
        );
      } else {
        return this.error(res, 'Receiving Details Not Found', 404, result);
      }
    } catch (error) {
      console.error('Error in returnReceivingProductDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnReceivingProductView()
   * Get return receiving product view
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async returnReceivingProductView(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        receiving_id: req.query.id || '',
      };

      const result = await Receiving.returnReceivingProductReportPage(data, options);
      if (result.status === true) {
        return this.success(res, result.data || [], 'Get detail successfully');
      } else {
        return this.error(res, 'Receiving Details Not Found', 404, result);
      }
    } catch (error) {
      console.error('Error in returnReceivingProductView:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: supplierReceivingDetails()
   * Get individual receiving records for a specific supplier
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async supplierReceivingDetails(req, res) {
    try {
      await this.ensureContext(req);

      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const skip = (page - 1) * limit;

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const branchIds = Array.isArray(branches) ? branches : [branches];
      const supplierId = req.query.supplier_id;

      if (!supplierId) {
        return this.error(res, 'Supplier ID is required', 400);
      }

      // Build filter
      const filter = {
        supplier_id: new mongoose.Types.ObjectId(supplierId),
        branch_id: { $in: branchIds.map((id) => new mongoose.Types.ObjectId(id)) },
        license: BaseModel.license,
      };

      const receivingsCollection = currentConnection(mongoose.connection).collection('receivings');

      // Get total count
      const total = await receivingsCollection.countDocuments(filter);

      // This supplier's COMPLETE purchase value across all matching receivings,
      // so the detail page shows the true total rather than a client-side sum
      // over just the loaded page (which under-counted once there was >1 page).
      const totalsAgg = await receivingsCollection
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: null,
              purchase_amount: { $sum: { $ifNull: ['$items_total', 0] } },
              return_amount: { $sum: { $ifNull: ['$items_return_total', 0] } },
            },
          },
        ])
        .toArray();
      const purchaseAmount = totalsAgg.length
        ? Math.round((totalsAgg[0].purchase_amount || 0) * 100) / 100
        : 0;
      const returnAmount = totalsAgg.length
        ? Math.round((totalsAgg[0].return_amount || 0) * 100) / 100
        : 0;

      // Get paginated receivings
      const receivings = await receivingsCollection
        .find(filter)
        .sort({ updated_date: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Format response to match frontend expectations
      const formattedList = receivings.map((receiving) => {
        return {
          _id: receiving._id,
          receiving_id: receiving.receiving_id,
          receiving_status: receiving.receiving_status,
          date: receiving.date,
          string_date: receiving.string_date || receiving.date,
          items_total: receiving.items_total || 0,
          items_return_total: receiving.items_return_total || 0,
          items: receiving.items || [],
          items_return: receiving.items_return || [],
          supplier_id: receiving.supplier_id,
          supplier_name: receiving.supplier_name,
          branch_id: receiving.branch_id,
          branch_name: receiving.branch_name,
        };
      });

      // Return in the format frontend expects: response.data.table.data
      return this.success(
        res,
        {
          table: {
            data: {
              total: total,
              current_page: page,
              total_pages: Math.ceil(total / limit),
              per_page: limit,
              list: this.mongoIDFilter(formattedList),
            },
          },
          purchase_amount: purchaseAmount,
          return_amount: returnAmount,
        },
        'Get Successfully'
      );
    } catch (error) {
      console.error('Error in supplierReceivingDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnPrintDetails()
   * Get return receiving print details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async returnPrintDetails(req, res) {
    try {
      await this.ensureContext(req);

      const id = req.query.id;
      const result = await Receiving.returnPrintDetailsPage(id);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in returnPrintDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: receivingsPdf()
   * Generate PDF for receiving/purchase order
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async receivingsPdf(req, res) {
    try {
      const { generateReceivingPDF } = require('../utils/pdfGenerator');
      const id = req.query.id;

      if (!id) {
        return this.error(res, 'Receiving ID is required', 400);
      }

      // Get receiving order details
      const receivingQuery = req.tenantContext
        ? Receiving.findOne({
            _id: id,
            branch_id: req.tenantContext.branchId,
            branch_name: req.tenantContext.branchName,
            license: req.tenantContext.licenseId,
          })
        : Receiving.findById(id);
      const receiving = await receivingQuery
        .populate('supplier', 'supplier_name supplier_phone supplier_email supplier_address')
        .populate('items.item', 'item_name item_unit')
        .lean();

      if (!receiving) {
        return this.error(res, 'Receiving Details Not Found', 404);
      }

      // Get branch details
      const branchId = req.tenantContext?.branchId;
      const branch = await (
        req.tenantContext
          ? Branch.findOne({ _id: branchId, license: req.tenantContext.licenseId })
          : Branch.findById(branchId)
      ).lean();

      if (!branch) {
        return this.error(res, 'Branch Details Not Found', 404);
      }

      // Generate PDF and save a server-side copy (for audits/downloads)
      generateReceivingPDF({
        data: receiving,
        branch,
        res,
        config: {
          title: 'Purchase Invoice.',
          idField: 'receiving_id',
          itemsField: 'items',
          supplierField: 'supplier',
          dateField: 'date',
          // Request saving; file will be saved to ApiV2/public/pdfs unless
          // `PDF_SAVE_DIR` or `config.savePath` override is provided.
          saveToFile: true,
        },
      });
    } catch (error) {
      console.error('Error in receivingsPdf:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Email a receiving/purchase order to its supplier as a PDF attachment
   * (Loyverse study L2). The PDF is the same document receivingsPdf streams,
   * collected into a buffer instead of a response. Outward-facing, so it
   * requires receiving WRITE. Degrades honestly when the server has no mail
   * transport configured.
   */
  async emailToSupplier(req, res) {
    try {
      if (req.user?.access?.receiving?.write === false) {
        return this.error(res, 'Unauthorized access', 403);
      }
      const { generateReceivingPDF } = require('../utils/pdfGenerator');
      const { PassThrough } = require('stream');
      const id = req.body.id;
      if (!id) return this.error(res, 'Receiving ID is required', 400);

      const receivingQuery = req.tenantContext
        ? Receiving.findOne({
            _id: id,
            branch_id: req.tenantContext.branchId,
            branch_name: req.tenantContext.branchName,
            license: req.tenantContext.licenseId,
          })
        : Receiving.findById(id);
      const receiving = await receivingQuery
        .populate('supplier', 'supplier_name supplier_phone supplier_email supplier_address')
        .populate('items.item', 'item_name item_unit')
        .lean();
      if (!receiving) return this.error(res, 'Receiving Details Not Found', 404);

      const branchId = req.tenantContext?.branchId;
      const branch = await (
        req.tenantContext
          ? Branch.findOne({ _id: branchId, license: req.tenantContext.licenseId })
          : Branch.findById(branchId)
      ).lean();
      if (!branch) return this.error(res, 'Branch Details Not Found', 404);

      const to = String(req.body.to || receiving.supplier?.supplier_email || '').trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return this.error(
          res,
          'The supplier has no email address - add one on the supplier, or type an address',
          400
        );
      }

      /* Collect the PDF into a buffer: the generator writes to a response,
         so hand it a stream wearing a response's hat. */
      const sink = new PassThrough();
      sink.setHeader = () => {};
      const chunks = [];
      sink.on('data', (c) => chunks.push(c));
      const done = new Promise((resolve, reject) => {
        sink.on('end', resolve);
        sink.on('error', reject);
      });
      generateReceivingPDF({
        data: receiving,
        branch,
        res: sink,
        config: {
          title: 'Purchase Invoice.',
          idField: 'receiving_id',
          itemsField: 'items',
          supplierField: 'supplier',
          dateField: 'date',
        },
      });
      await done;
      const pdfBuffer = Buffer.concat(chunks);

      // Owner rule: the shop's own SMTP first, the platform chain otherwise.
      const { resolveShopTransport } = require('../utils/email');
      const resolved = resolveShopTransport(branch);
      const transporter = resolved.transporter;
      const shopName = branch.branch_name || 'Posnic POS';
      const orderId = receiving.receiving_id || String(receiving._id);
      const info = await transporter.sendMail({
        from: `${shopName} <${resolved.from}>`,
        to,
        subject:
          String(req.body.subject || '').trim() || `Purchase order from ${shopName} (${orderId})`,
        text:
          String(req.body.message || '').trim() ||
          `Please find attached purchase order ${orderId} from ${shopName}.`,
        attachments: [{ filename: `${orderId}.pdf`, content: pdfBuffer }],
      });
      /* The dev fallback transport prints to console instead of delivering -
         say so rather than claiming a send that never left the box. */
      if (!resolved.shopOwned && transporter.options && transporter.options.jsonTransport) {
        return this.error(
          res,
          'Email is not configured on this server - the PDF was generated but not sent',
          503
        );
      }
      return this.success(
        res,
        { to, messageId: info.messageId || '' },
        'Purchase order emailed to supplier'
      );
    } catch (error) {
      console.error('Error in emailToSupplier:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Alias for getOne - used by route GET /receivings/:id
   */
  async getById(req, res) {
    return this.getOne(req, res);
  }

  /**
   * PHP: supplierReceivingReportTable()
   * Get supplier-based receiving report (grouped by supplier)
   */
  async supplierReceivingReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) || 5;
      const pageParam = parseInt(req.query.page);
      const page = pageParam && pageParam > 0 ? pageParam : 1;
      const skip = Math.max(0, (page - 1) * limit);

      // Get branch IDs from query
      let branchIds = req.query.branch || req.query['branch[]'];
      if (!branchIds) {
        return this.error(res, 'Branch ID is required', 400);
      }
      if (!Array.isArray(branchIds)) {
        branchIds = [branchIds];
      }

      // Parse dates
      const startingDate = req.query.starting_date;
      const endingDate = req.query.ending_date;

      if (!startingDate || !endingDate) {
        return this.error(res, 'Starting date and ending date are required', 400);
      }

      // Convert branch IDs to ObjectId
      const branchObjectIds = branchIds.map((id) => new ObjectId(id));

      // Build date filter
      const fromDate = new Date(startingDate);
      const toDate = new Date(endingDate);

      // Build filter
      const filter = {
        $and: [
          {
            branch_id: { $in: branchObjectIds },
            // For supplier receiving summary, only include completed/partially returned
            // documents; exclude "Open" receivings from the report.
            receiving_status: { $in: ['Received', 'PartialReturn'] },
          },
          {
            updated_date: { $gte: fromDate, $lte: toDate },
            license: new ObjectId(req.user.license),
          },
        ],
      };

      // Add supplier filter if provided
      if (req.query.supplier_id) {
        filter.supplier_id = new ObjectId(req.query.supplier_id);
      }

      const receivingsCollection = currentConnection(mongoose.connection).collection('receivings');

      // Aggregate to group by supplier
      const receivingList = await receivingsCollection
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: {
                supplier_id: '$supplier_id',
                supplier_name: '$supplier_name',
                supplier_phone: '$supplier_phone',
              },
              receiving_avg: { $avg: '$items_total' },
              receiving_total: { $sum: '$items_total' },
              receiving_count: { $sum: 1 },
            },
          },
          { $sort: { receiving_total: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray();

      // Get total count
      const totalList = await receivingsCollection
        .aggregate([
          { $match: filter },
          {
            $group: {
              _id: {
                supplier_id: '$supplier_id',
                supplier_name: '$supplier_name',
                supplier_phone: '$supplier_phone',
              },
            },
          },
        ])
        .toArray();

      const total = totalList.length;

      // Format response
      const receivingValues = receivingList.map((item) => ({
        supplier_name: item._id.supplier_name || '',
        supplier_phone: item._id.supplier_phone || '',
        supplier_id: item._id.supplier_id?.toString() || '',
        receiving_payment: Math.round(item.receiving_total * 100) / 100,
        receiving_count: item.receiving_count,
        receiving_avg: Math.round(item.receiving_avg * 100) / 100,
      }));

      return res.status(200).json({
        type: 'success',
        message: 'Get Successfully',
        data: {
          status: true,
          total: total,
          current_page: page,
          total_pages: Math.ceil(total / limit),
          per_page: limit,
          list: receivingValues,
        },
      });
    } catch (error) {
      console.error('Error in supplierReceivingReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: gstTwoReportTable()
   * Get GST-2 report for receivings (purchases)
   */
  async gstTwoReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Get branch_id from session (selectedBranchId or branch_id)
      let branchId = req.session?.selectedBranchId || req.session?.branch_id;
      if (!branchId && req.user?.branch_access && req.user.branch_access.length > 0) {
        branchId = req.user.branch_access[0].branch_id;
      }

      // Parse dates
      const startingDate = req.query.starting_date;
      const endingDate = req.query.ending_date;

      if (!startingDate || !endingDate) {
        return this.error(res, 'Starting date and ending date are required', 400);
      }

      const fromDate = new Date(startingDate);
      const toDate = new Date(endingDate);

      // Main filter for registered suppliers (regular/composite)
      const filters = {
        $and: [
          {
            branch_id: new ObjectId(branchId),
            receiving_status: { $in: ['PartialReturn', 'Received'] },
            supplier_gst_type: { $in: ['regular', 'composite'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            gst: 'enable',
            license: new ObjectId(req.user.license),
          },
        ],
      };

      const receivingsCollection = currentConnection(mongoose.connection).collection('receivings');

      // 1. Receiving details (registered suppliers)
      const receivingList = await receivingsCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: filters },
          {
            $group: {
              _id: {
                item_receiving_id: '$receiving_id',
                item_date: '$date',
                item_supplier_state: '$supplier_state',
                supplier_gst_type: '$supplier_gst_type',
                item_supplier_gst_number: '$supplier_gst_number',
                item_tax: '$items.tax',
                item_total: '$items.total_amount',
                item_igst_tax: '$items.igst_tax',
                item_cgst_tax: '$items.cgst_tax',
                item_sgst_tax: '$items.sgst_tax',
                csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const receivingValues = receivingList.map((item) => {
        const multipleValue =
          item._id.item_igst_tax > 0 ? item._id.item_igst_tax : item._id.csgst_multiply;

        return {
          item_receiving_id: item._id.item_receiving_id || '',
          item_date: item._id.item_date
            ? new Date(item._id.item_date).toLocaleDateString('en-GB')
            : '',
          item_supplier_state: item._id.item_supplier_state || '',
          supplier_gst_type: item._id.supplier_gst_type || '',
          item_supplier_gst_number: item._id.item_supplier_gst_number || '',
          item_total: Math.round(item._id.item_total * 100) / 100,
          item_tax: Math.round(item._id.item_tax * 100) / 100,
          item_subtotal: Math.round((item._id.item_total - multipleValue) * 100) / 100,
          item_igst_tax: Math.round(item._id.item_igst_tax * 100) / 100,
          item_cgst_tax: Math.round(item._id.item_cgst_tax * 100) / 100,
          item_sgst_tax: Math.round(item._id.item_sgst_tax * 100) / 100,
        };
      });

      // 2. Return details
      const returnFilters = {
        $and: [
          {
            branch_id: new ObjectId(branchId),
            receiving_status: { $in: ['PartialReturn', 'FullReturn'] },
            supplier_gst_type: { $in: ['regular'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            gst: 'enable',
            license: new ObjectId(req.user.license),
          },
        ],
      };

      const returnList = await receivingsCollection
        .aggregate([
          { $unwind: '$items_return' },
          { $unwind: '$items_return.returnArray' },
          { $unwind: '$items_return.returnArray.returnValue' },
          { $match: returnFilters },
          {
            $group: {
              _id: {
                return_receiving_id: '$receiving_id',
                return_receiving_date: '$date',
                return_supplier_state: '$supplier_state',
                return_id: '$items_return.returnArray.returnValue.return_id',
                return_date: '$items_return.returnArray.returnValue.return_date',
                return_tax: '$items_return.returnArray.returnValue.tax',
                return_total: '$items_return.returnArray.returnValue.total_amount',
                return_igst_tax: '$items_return.returnArray.returnValue.igst_tax',
                return_cgst_tax: '$items_return.returnArray.returnValue.cgst_tax',
                return_sgst_tax: '$items_return.returnArray.returnValue.sgst_tax',
                return_csgst_multiply: {
                  $sum: {
                    $add: [
                      '$items_return.returnArray.returnValue.cgst_tax',
                      '$items_return.returnArray.returnValue.sgst_tax',
                    ],
                  },
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const returnValues = returnList.map((item) => {
        const returnMultipleValue =
          item._id.return_igst_tax > 0 ? item._id.return_igst_tax : item._id.return_csgst_multiply;

        return {
          return_receiving_id: item._id.return_receiving_id || '',
          return_date: item._id.return_receiving_date
            ? new Date(item._id.return_receiving_date).toLocaleDateString('en-GB')
            : '',
          return_id: item._id.return_id || '',
          return_receiving_date: item._id.return_date
            ? new Date(item._id.return_date).toLocaleDateString('en-GB')
            : '',
          return_supplier_state: item._id.return_supplier_state || '',
          return_total: Math.round(item._id.return_total * 100) / 100,
          return_tax: Math.round(item._id.return_tax * 100) / 100,
          return_subtotal: Math.round((item._id.return_total - returnMultipleValue) * 100) / 100,
          return_igst_tax: Math.round(item._id.return_igst_tax * 100) / 100,
          return_cgst_tax: Math.round(item._id.return_cgst_tax * 100) / 100,
          return_sgst_tax: Math.round(item._id.return_sgst_tax * 100) / 100,
        };
      });

      // 3. Product details
      const productFilters = {
        $and: [
          {
            branch_id: new ObjectId(branchId),
            receiving_status: { $in: ['PartialReturn', 'Received'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            receiving_status: 'Received',
            gst: 'enable',
            license: new ObjectId(req.user.license),
          },
        ],
      };

      const productList = await receivingsCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: productFilters },
          {
            $group: {
              _id: { item_name: '$items.item_name' },
              subtotal_amount: { $sum: '$items.total_amount' },
              tax: { $sum: '$items.tax' },
              igst_tax: { $sum: '$items.igst_tax' },
              cgst_tax: { $sum: '$items.cgst_tax' },
              sgst_tax: { $sum: '$items.sgst_tax' },
              total_qty: { $sum: '$items.item_quantity' },
              csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const productValues = productList.map((item) => {
        const productMultipleValue = item.igst_tax + item.csgst_multiply;

        return {
          product_name: item._id.item_name || '',
          product_qty: item.total_qty || 0,
          product_total: Math.round(item.subtotal_amount * 100) / 100,
          product_subtotal: Math.round((item.subtotal_amount - productMultipleValue) * 100) / 100,
          product_tax: Math.round(item.tax * 100) / 100,
          product_igst: Math.round(item.igst_tax * 100) / 100,
          product_cgst: Math.round(item.cgst_tax * 100) / 100,
          product_sgst: Math.round(item.sgst_tax * 100) / 100,
        };
      });

      const arrTableData = {
        sales_data: receivingValues,
        returns_data: returnValues,
        product_data: productValues,
      };

      return res.status(200).json({
        type: 'success',
        message: 'Get Successfully',
        data: arrTableData,
      });
    } catch (error) {
      console.error('Error in gstTwoReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: gstNineReportTable()
   * Get GST-9 report
   */
  async gstNineReportTable(req, res) {
    try {
      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      const data = {
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
        branch_id: req.session.branch_id,
        license: req.user.license,
      };

      const response = await Receiving.gstNineReportPage(data);

      if (response.status === true) {
        return this.success(res, response.data, 'Get Successfully');
      } else {
        return this.error(res, 'Receiving Details Not Found', 404);
      }
    } catch (error) {
      console.error('Error in gstNineReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: companyPriceUpdate()
   * Update company/supplier price for an item
   */
  async companyPriceUpdate(req, res) {
    try {
      const userAccess = req.user?.access?.receiving?.write;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { item_id, item_price } = req.body;

      if (!item_id || !mongoose.Types.ObjectId.isValid(item_id)) {
        return this.error(res, 'Valid item_id is required', 400);
      }

      if (!item_price || item_price.toString().trim() === '') {
        return this.error(res, 'item_price is required', 400);
      }

      const price = parseFloat(item_price);
      if (isNaN(price) || price < 0) {
        return this.error(res, 'item_price must be a valid positive number', 400);
      }

      const db = currentConnection(mongoose.connection).db;
      const itemsCollection = db.collection('items');

      const result = await itemsCollection.updateOne(
        {
          _id: new mongoose.Types.ObjectId(item_id),
          license: req.user.license,
        },
        {
          $set: {
            company_price: price,
          },
        }
      );

      if (result.matchedCount === 0) {
        return this.error(res, 'Item not found', 404);
      }

      return this.success(res, null, 'Item company price updated successfully');
    } catch (error) {
      console.error('Error in companyPriceUpdate:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * GET /api/receivings/summary
   *
   * Counts and totals for the receivings list header. Read-only, and scoped to
   * the branch when one is supplied.
   *
   * Grouped on `status` rather than `receiving_status` because `status` carries
   * the schema's enum (draft | received | cancelled) while `receiving_status`
   * is a free-text label derived from it. Existing rows have neither set - the
   * aggregate reports those under `unset` rather than silently dropping them,
   * which is the honest answer for 54 of supermarket's 54 receipts.
   */
  async getSummary(req, res) {
    try {
      if (!this.checkPermission('receiving', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const collection = currentConnection(mongoose.connection).db.collection('receivings');
      const match = {};
      if (req.query.branch) match.branch_id = req.query.branch;

      const rows = await collection
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: { $ifNull: ['$status', 'unset'] },
              count: { $sum: 1 },
              total: { $sum: { $ifNull: ['$grand_total', 0] } },
            },
          },
        ])
        .toArray();

      const byStatus = {};
      let count = 0;
      let total = 0;
      for (const r of rows) {
        byStatus[r._id] = { count: r.count, total: r.total };
        count += r.count;
        total += r.total;
      }

      return this.success(res, { count, total, byStatus }, 'Get Successfully');
    } catch (error) {
      console.error('Error in ReceivingsController.getSummary:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PATCH /api/receivings/:id/status  { status }
   *
   * Moves one receipt between draft, received and cancelled.
   *
   * The status is checked against the schema's own enum rather than a list
   * written out here, so the two cannot drift apart - a route that accepted
   * "recieved" would write a value nothing else in the product recognises, and
   * nothing would complain until a report came out short.
   */
  async updateStatus(req, res) {
    try {
      if (!this.checkPermission('receiving', 'edit', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const id = String(req.params.id || '').trim();
      const status = String(req.body?.status || '').trim();
      if (!ObjectId.isValid(id)) return this.error(res, 'A valid receiving id is required', 400);

      const allowed = Receiving?.schema?.path?.('status')?.enumValues || [
        'draft',
        'received',
        'cancelled',
      ];
      if (!allowed.includes(status)) {
        return this.error(res, `status must be one of: ${allowed.join(', ')}`, 400);
      }

      const collection = currentConnection(mongoose.connection).db.collection('receivings');
      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            /* Kept in step with the label the rest of the product reads, using
               the same mapping the model applies on save. */
            receiving_status:
              status === 'received' ? 'Received' : status === 'cancelled' ? 'Cancelled' : 'Open',
            updated_date: new Date(),
            updated_by: req.user?.name || req.user?.email || 'system',
          },
        },
        { returnDocument: 'after' }
      );

      const doc = result && result.value ? result.value : result;
      if (!doc || !doc._id) return this.error(res, 'Receiving not found', 404);

      return this.success(res, doc, 'Status updated successfully');
    } catch (error) {
      console.error('Error in ReceivingsController.updateStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * GET /api/receivings/getDataChanges?from=
   *
   * The change feed the frontend polls per module - see
   * `{module}/getDataChanges` in Frontend core/PosnicPro.js. Nine controllers
   * implement it; receivings did not, so the poll answered 501.
   */
  async getDataChanges(req, res) {
    try {
      const from = req.query.from || '';
      const baseModel = new BaseModel('receivings');
      const result = await baseModel.getAllDataChanges('receivings', null, from);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      }
      return this.error(res, 'Not valid Input', 200, result.data);
    } catch (error) {
      console.error('Error in ReceivingsController.getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * GET /api/receivings/pendingReceivingProductDetails?receiving_id=&branch=&page=&limit=
   *
   * The line items of one pending stock receipt, paged.
   *
   * This one has a caller: Frontend report_pending.js opens it from the pending
   * receivings report and reads total / total_pages / current_page / per_page
   * off the response, so the shape below is the shape that page already
   * expects rather than one invented here.
   */
  async pendingReceivingProductDetails(req, res) {
    try {
      if (!this.checkPermission('receiving', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const receivingId = String(req.query.receiving_id || '').trim();
      if (!receivingId) {
        return this.error(res, 'A receiving_id is required', 400);
      }

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), 100);

      const collection = currentConnection(mongoose.connection).db.collection('receivings');
      const query = ObjectId.isValid(receivingId)
        ? { $or: [{ _id: new ObjectId(receivingId) }, { receiving_id: receivingId }] }
        : { receiving_id: receivingId };
      if (req.query.branch) query.branch_id = req.query.branch;

      const doc = await collection.findOne(query);
      if (!doc) {
        return this.error(res, 'Receiving not found', 404);
      }

      /* Paged in memory: the line items live inside the receiving document, so
         there is nothing to page in the database - and a stock receipt has tens
         of lines, not thousands. */
      const all = Array.isArray(doc.items) ? doc.items : [];
      const total = all.length;
      const list = all.slice((page - 1) * limit, page * limit);

      return this.success(
        res,
        {
          total,
          current_page: page,
          total_pages: Math.max(1, Math.ceil(total / limit)),
          per_page: limit,
          list,
        },
        'Get Successfully'
      );
    } catch (error) {
      console.error('Error in ReceivingsController.pendingReceivingProductDetails:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new ReceivingsController();
