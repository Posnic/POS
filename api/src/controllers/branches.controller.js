const BaseController = require('./base.controller');
const BranchModule = require('../models/branch.model');
const BranchModel = BranchModule.BranchModel;
const branchesService = require('../services/branch.service');
const User = require('../models/user.model');
const { ObjectId } = require('mongodb');
const { redactBranchSecrets } = require('../services/settings-groups');

class BranchesController extends BaseController {
  constructor() {
    super();
    this.branchModel = new BranchModel();
    this.branchesService = branchesService;
  }

  /**
   * Get all branches with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAll(req, res) {
    try {
      const limit =
        req.query.limit && parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = req.query.page && parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      let filters = {};

      if (req.query.filters) {
        try {
          filters = JSON.parse(req.query.filters);
        } catch (err) {
          return this.error(res, 'Incorrect format of filter', 404);
        }
      }

      if (!this.checkPermission('branch', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const options = {
        limit: limit,
        page: page,
        sort: { _id: -1 },
      };

      const context = {
        user: req.user,
        license: req.user.license,
      };

      const result = await this.branchModel.branchPage(filters, options, context);

      if (result.status === true) {
        if (result.data && result.data.list) {
          result.data.list = this.mongoIDFilter(result.data.list);
        }
        return this.success(res, result.data, result.message, 200);
      } else {
        return this.error(res, 'Details Not Found', 404, result.data);
      }
    } catch (error) {
      console.error('Error in getAll branches:', error);
      return this.error(res, 'Failed to retrieve branches', 500);
    }
  }

  /**
   * Get branch options for dropdown
   */
  async getOptions(req, res) {
    try {
      const result = await this.branchesService.getBranchOptions();

      if (!result.status) {
        return this.error(res, result.message, 404);
      }

      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in get branch options:', error);
      return this.error(res, 'Failed to retrieve branch options', 500);
    }
  }

  /**
   * Get a single branch by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getOne(req, res) {
    try {
      const { id } = req.params;

      if (!this.checkPermission('branch', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const result = await this.branchModel.getBranchById(id);

      if (!result.status) {
        return this.error(res, 'Branch Not found', 404);
      }

      return this.success(res, result.data, result.message || 'Branch retrieved successfully');
    } catch (error) {
      console.error('Error in getOne branch:', error);
      return this.error(res, 'Failed to retrieve branch', 500);
    }
  }

  /**
   * Create a new branch
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async add(req, res) {
    try {
      if (!this.checkPermission('branch', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const data = req.body;
      const user = req.user;
      const result = await this.branchModel.createBranch(data, user);

      if (result.status === 'exist') {
        // PHP returns 406 for duplicate entries
        return this.error(res, result.message, 406, result.data);
      }

      if (!result.status) {
        return this.error(res, result.message, 404, result.data);
      }

      return this.success(res, result.data, result.message, 200);
    } catch (error) {
      console.error('Error in add branch:', error);
      return this.error(res, 'Failed to create branch: ' + error.message, 500);
    }
  }

  /**
   * Update an existing branch
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async edit(req, res) {
    try {
      if (!this.checkPermission('branch', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { id } = req.params;
      const data = req.body;

      if (!id) {
        return this.error(res, 'Branch ID is required', 400);
      }

      const user = req.user;
      const result = await this.branchModel.updateBranch(id, data, user);

      if (!result.status) {
        return this.error(res, result.message, 404);
      }

      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in edit branch:', error);
      return this.error(res, 'Failed to update branch: ' + error.message, 500);
    }
  }

  /**
   * Delete a branch
   * Matches PHP branches.php delete() method
   * Supports both legacy (body.data) and RESTful (params.id) formats
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async delete(req, res) {
    try {
      // Support both legacy format (req.body.data) and RESTful format (req.params.id)
      // PHP line 278: $id = $GLOBALS['input']['json']['data'];
      const id = req.params.id || req.body.data;

      // PHP line 279: if (isset($id))
      if (!id) {
        return this.error(res, 'UID is missing', 400);
      }

      // PHP line 280: $user_access = $_SESSION['PosnicPro']['user']['access']['branch']['delete'];
      // PHP line 281: if ($user_access === true)
      if (!this.checkPermission('branch', 'delete', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // Set BaseModel context for backup
      const BaseModel = require('../models/base.model');
      const user = req.user || {};

      const sessionBranchId =
        req.session?.selectedBranchId ||
        req.session?.branch_id ||
        user.branch_id ||
        user.branch?._id;
      if (sessionBranchId) {
        BaseModel.currentBranch = ObjectId.isValid(sessionBranchId)
          ? new ObjectId(sessionBranchId)
          : sessionBranchId;
      }

      const branchName = user.branch_name || user.branch?.branch_name || '';
      if (branchName) {
        BaseModel.currentBranchName = branchName;
      }

      if (user.license || user.license_id) {
        const license = user.license || user.license_id;
        BaseModel.license = ObjectId.isValid(license) ? new ObjectId(license) : license;
      }

      if (user._id) {
        BaseModel.loggedUser = ObjectId.isValid(user._id) ? new ObjectId(user._id) : user._id;
        BaseModel.loggedUserName = user.name || user.username || user.email || '';
      }

      // PHP line 282: $response = $this->branchModel->deleteBranchCollectionData($id);
      const response = await this.branchModel.deleteBranchCollectionData(id, req.user);

      // PHP lines 283-287: Handle response
      if (response.status === true) {
        return this.success(res, response.data, response.message, 200);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in delete branch:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get payment gateway settings
   */
  async resetPaymentGateway(req, res) {
    try {
      // PHP uses self::$currentBranch which is session's selectedBranchId
      const branchId =
        req.tenantContext?.branchId ||
        req.session?.selectedBranchId ||
        req.query.branch_id ||
        req.query.id;
      const licenseId = req.tenantContext?.licenseId || req.user?.license;

      if (!branchId) {
        return this.error(res, 'Branch ID required', 400);
      }

      if (!licenseId) {
        return this.error(res, 'License ID required', 400);
      }

      const result = await this.branchModel.getPaymentGatewaySettings(branchId, licenseId);

      if (result.status) {
        return this.success(res, result.data, result.message, 200);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in resetPaymentGateway:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get PhonePe payment gateway settings
   */
  async resetPhonepePaymentGateway(req, res) {
    try {
      // PHP uses self::$currentBranch from session
      const branchId =
        req.tenantContext?.branchId ||
        req.session?.branch_id ||
        req.user?.branch_access?.[0]?.branch_id ||
        req.user?.branch_id ||
        req.query.branch_id ||
        req.query.id;
      const result = await this.branchModel.getPhonePePaymentGatewaySettings(
        branchId,
        req.tenantContext?.licenseId || req.user?.license
      );

      if (result.status) {
        return this.success(res, result.data, result.message, 200);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in resetPhonepePaymentGateway:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get Email settings
   */
  async resetEmailSetting(req, res) {
    try {
      // PHP uses self::$currentBranch which is session's selectedBranchId
      const branchId =
        req.tenantContext?.branchId ||
        req.session?.selectedBranchId ||
        req.query.branch_id ||
        req.query.id;
      const licenseId = req.tenantContext?.licenseId || req.user?.license;

      if (!branchId) {
        return this.error(res, 'Branch ID required', 400);
      }

      if (!licenseId) {
        return this.error(res, 'License ID required', 400);
      }

      const result = await this.branchModel.getEmailSettings(branchId, licenseId);

      if (result.status) {
        return this.success(res, result.data, result.message, 200);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in resetEmailSetting:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get branch options for dropdown
   * Legacy endpoint: GET /branches/getBranchList
   */
  async getBranchList(req, res) {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const user = await User.findById(userId).select('+branch_access').lean();

      const branchAccess = Array.isArray(user?.branch_access) ? user.branch_access : [];

      const branches = branchAccess.map((entry) => ({
        id: entry.branch_id?.toString?.() || entry.branch_id || '',
        branch_name: entry.branch_name || '',
        branch_image: entry.branch_image || 'store.png',
      }));

      return res.status(200).json({
        type: 'success',
        message: 'Branches retrieved successfully',
        data: branches,
      });
    } catch (error) {
      console.error('Error in getBranchList:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Failed to retrieve branch list',
        data: null,
      });
    }
  }

  /**
   * Legacy endpoint: GET /api/branches/userRegisterBranchSelect?id=<branchId>
   */
  async userRegisterBranchSelect(req, res) {
    try {
      const candidates = [
        req.query.id,
        req.query.branch,
        req.query.branch_id,
        req.query.branchId,
        req.body?.id,
        req.body?.branch,
        req.body?.branch_id,
        req.body?.branchId,
        req.user?.branch_id,
        req.user?.default_branch_id,
        req.user?.branch_access?.[0]?.branch_id,
        req.user?.branch?._id,
        req.user?.branch,
      ];

      let resolvedId =
        req.tenantContext?.branchId || this.branchesService.normalizeBranchId(candidates);
      if (!resolvedId && !req.tenantContext) {
        const fallbackBranch = await this.branchesService.getFirstBranch();
        resolvedId = fallbackBranch?._id?.toString();
      }

      if (!resolvedId) {
        return this.error(res, 'Branch id is required', 400);
      }

      const result = await this.branchModel.getRegisterList(resolvedId, req.user);

      if (!result.status) {
        const statusCode = result.message === 'Branch id is required' ? 400 : 404;
        return res.status(statusCode).json({
          type: 'error',
          message: result.message,
          data: result.data,
        });
      }

      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in userRegisterBranchSelect:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load register list. Please try again later.',
        data: {
          error: error.message,
          stack: error.stack,
        },
      });
    }
  }

  /**
   * Legacy endpoint: GET /branches/getOneStore?id=<branchId>
   */
  async getOneStore(req, res) {
    try {
      // The legacy frontend sometimes calls this endpoint with
      // id=null or without an explicit id, expecting the backend
      // to resolve the active branch from the session/user context
      // (matching PHP behaviour). Here we normalise all possible
      // branch id sources and fall back to the first branch in the
      // database if needed.

      const primaryCandidates = [
        req.query.id,
        req.query.branch,
        req.query.branch_id,
        req.query.branchId,
        req.params?.id,
      ];

      const contextCandidates = [
        req.session?.selectedBranchId,
        req.session?.branch_id,
        req.user?.branch_id,
        req.user?.default_branch_id,
        req.user?.branch_access?.[0]?.branch_id,
        req.user?.branch?._id,
        req.user?.branch,
      ];

      let resolvedId =
        req.tenantContext?.branchId ||
        this.branchesService.normalizeBranchId([...primaryCandidates, ...contextCandidates]);
      if (!resolvedId && !req.tenantContext) {
        const fallbackBranch = await this.branchesService.getFirstBranch();
        resolvedId = fallbackBranch?._id?.toString();
      }

      if (!resolvedId) {
        return res.status(400).json({
          type: 'error',
          message: 'Branch id is required',
          data: null,
        });
      }

      const result = await this.branchModel.getBranchDetails(resolvedId);

      if (!result.status) {
        const statusCode = result.message === 'Branch id is required' ? 400 : 404;
        return res.status(statusCode).json({
          type: 'error',
          message: result.message || 'Store Not found',
          data: null,
        });
      }

      /* S4: this returns the whole branch document, and the settings screen
         reads its email and SMS cards from it - so the SMTP password, the SMS
         gateway password and two API keys were being handed to the browser of
         anyone who could open Settings. They leave as a configured/not map;
         the values only ever travel inwards now. */
      return res.status(200).json({
        type: 'success',
        message: 'Get store details successfully',
        data: redactBranchSecrets(result.data),
      });
    } catch (error) {
      console.error('Error in getOneStore:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load store. Please try again later.',
        data: null,
      });
    }
  }

  /**
   * PHP: getBranchDetails()
   * Get branch details without permission check
   */
  async getBranchDetails(req, res) {
    try {
      const id = req.query.id || req.params.id;

      if (!id) {
        return this.error(res, 'Branch Id Not Found', 400);
      }

      const branch = req.tenantContext
        ? await this.branchModel.model
            .findOne({
              _id: req.tenantContext.branchId,
              branch_name: req.tenantContext.branchName,
              license: req.tenantContext.licenseId,
            })
            .lean()
        : await this.branchModel.model.findById(id).lean();

      if (!branch) {
        return this.error(res, 'Branch not found', 404);
      }

      return this.success(res, branch, 'Branch details retrieved successfully');
    } catch (error) {
      console.error('Error in getBranchDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getDataChanges()
   * Get data changes for synchronization
   */
  async getDataChanges(req, res) {
    try {
      const from = req.query.from || '';
      const result = await BranchModule.getDataChanges('branches', from);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, 'Not valid Input', 200, result.data);
      }
    } catch (error) {
      console.error('Error in getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportBranches()
   * Export branches data - returns JSON with selected branch details
   */
  async exportBranches(req, res) {
    try {
      // PHP line 306: Check permission
      if (!this.checkPermission('branch', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // PHP line 308: Get IDs from request body ($GLOBALS['input']['json'])
      const id = req.body;

      // PHP line 309: Call model method
      const response = await this.branchModel.exportBranchOrder(id, req.user.license);

      // PHP lines 310-314: Return appropriate response
      if (response.status === true) {
        return this.success(res, response.data, response.message, 200);
      } else {
        return this.error(res, response.message || 'Branches Exported Unsuccessfully', 404);
      }
    } catch (error) {
      console.error('Error in exportBranches:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getBranchRegisterList()
   * Get registers for a specific branch
   */
  async getBranchRegisterList(req, res) {
    try {
      // PHP allows 'branch' to be an array or string
      const branchId = req.query.branch || req.params.branchId;

      const result = await this.branchModel.getBranchRegisterList(branchId);

      if (result.status) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in getBranchRegisterList:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get branch statistics
   */
  async getStats(req, res) {
    try {
      if (!this.checkPermission('branch', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const result = await this.branchesService.getBranchStatistics();

      if (!result.status) {
        return this.error(res, result.message, 404);
      }

      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in getStats:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Search branches
   */
  async search(req, res) {
    try {
      if (!this.checkPermission('branch', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const q = req.query.q || '';
      const result = await this.branchesService.searchBranches(q, 10);

      if (!result.status) {
        return this.error(res, result.message, 400);
      }

      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in search:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Toggle branch status
   */
  async toggleStatus(req, res) {
    try {
      if (!this.checkPermission('branch', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { id } = req.params;
      const result = await this.branchesService.toggleBranchStatus(id);

      if (!result.status) {
        return this.error(res, result.message, 404);
      }

      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in toggleStatus:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new BranchesController();
