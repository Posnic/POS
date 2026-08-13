const BaseController = require('./base.controller');
const DashboardModel = require('../models/dashboard.model');
const Branch = require('../models/branch.model');
const sessionFilterUtil = require('../utils/session-filter.util');

class DashboardController extends BaseController {
  constructor() {
    super();
    this.getDashboardCurrentWish = this.getDashboardCurrentWish.bind(this);
    this.getDashboardPaymentModeData = this.getDashboardPaymentModeData.bind(this);
    this.getPendingActivities = this.getPendingActivities.bind(this);
    this.getDashboardTopPerformers = this.getDashboardTopPerformers.bind(this);
    this.getDashboardTotalAmounts = this.getDashboardTotalAmounts.bind(this);
    this.getDashboardSalesPurchase = this.getDashboardSalesPurchase.bind(this);
    this.getProfitSummary = this.getProfitSummary.bind(this);
    this.getDashboardBestSellingProducts = this.getDashboardBestSellingProducts.bind(this);
    this.getDashboardExpiredProducts = this.getDashboardExpiredProducts.bind(this);
    this.debugSessionFilter = this.debugSessionFilter.bind(this);
  }

  setRequestContext(req) {
    const model = req.dashboardModel || this.model || new DashboardModel();
    req.dashboardModel = model;
    const pickFirst = (...candidates) => {
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          if (candidate.length) {
            const value = candidate.find((entry) => entry);
            if (value) return value;
          }
          continue;
        }
        if (candidate) return candidate;
      }
      return null;
    };

    const branchAccessEntry =
      Array.isArray(req.user?.branch_access) && req.user.branch_access.length
        ? req.user.branch_access[0]
        : null;

    const branchParam = pickFirst(
      req.tenantContext?.branchId,
      req.session?.selectedBranchId,
      req.session?.branch_id,
      req.user?.branch_id,
      req.user?.branch?._id,
      req.user?.branch,
      req.user?.default_branch_id,
      branchAccessEntry?.branch_id,
      branchAccessEntry?.branch?._id,
      branchAccessEntry?._id,
      req.headers?.['x-branch-id'],
      req.query?.branch,
      req.query?.branch_id,
      req.query?.['branch[]'],
      req.query?.['branch_id[]'],
      req.body?.branch,
      req.body?.branch_id,
      req.body?.['branch[]'],
      req.body?.['branch_id[]']
    );

    const branchId = branchParam
      ? Array.isArray(branchParam)
        ? branchParam[0]
        : branchParam
      : null;

    console.log('[DASHBOARD CONTEXT] req.user:', {
      license: req.user?.license,
      license_id: req.user?.license_id,
      _id: req.user?._id,
      username: req.user?.username,
    });

    const licenseId =
      req.tenantContext?.licenseId || req.user?.license || req.user?.license_id || null;
    const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';

    console.log('[DASHBOARD CONTEXT] Setting model context:', {
      branchId,
      licenseId,
      timeZone,
    });

    model.branchId = branchId;
    model.licenseId = licenseId;
    model.timeZone = timeZone;
    return model;
  }

  async ensureContext(req) {
    const model = this.setRequestContext(req);

    if (model.branchId) {
      return model;
    }

    const licenseFilter = model.licenseId ? { license: model.licenseId } : null;

    const branchDoc = licenseFilter ? await Branch.findOne(licenseFilter).lean() : null;

    if (branchDoc) {
      model.branchId = branchDoc._id;
      if (!model.licenseId && branchDoc.license) {
        model.licenseId = branchDoc.license;
      }
    }
    return model;
  }

  /*
   * Whether this user may see money-health figures - profit, cost, margin,
   * expenses, cash, dues. The owner always may (role 'admin'), which also
   * grandfathers shops that upgraded before the flag existed; a manager or
   * anyone else needs it granted explicitly. The gate for every financial
   * dashboard endpoint runs through here.
   */
  canSeeFinancials(user) {
    if (!user) return false;
    const isOwner = user.role === 'admin' || user.usertype === 'admin';
    return isOwner || user.access?.dashboard?.financials === true;
  }

  /**
   * Get dashboard welcome message and quotes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardCurrentWish(req, res) {
    try {
      const model = await this.ensureContext(req);
      const result = model.getDashboardCurrentWish();
      if (!result || result.status !== true) {
        return res.status(500).json({
          type: 'error',
          message: result?.message || 'Failed to retrieve dashboard wish',
          data: null,
        });
      }
      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getDashboardCurrentWish:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching dashboard welcome message',
        data: null,
      });
    }
  }

  /**
   * Get payment mode statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardPaymentModeData(req, res) {
    try {
      const { filter = 'today' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      await this.ensureContext(req);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Payment Mode Data - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getDashboardPaymentModeDataModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: 'Payment mode data retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve payment mode data',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDashboardPaymentModeData:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching payment mode data',
        data: null,
      });
    }
  }

  /**
   * Get pending activities (unpaid sales)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getPendingActivities(req, res) {
    try {
      const { filter = 'today' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      await this.ensureContext(req);

      // DEBUG: Log user data before session filter
      console.log('🔍 DEBUG: User data before session filter:', {
        userId: req.user?._id,
        username: req.user?.username,
        access: req.user?.access,
        salesAccess: req.user?.access?.sales,
        sessionFilter: req.user?.access?.sales?.session_filter,
        originalDateRange: originalDateRange,
      });

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Pending Activities - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getPendingActivitiesModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: 'Pending activities retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve pending activities',
        data: null,
      });
    } catch (error) {
      console.error('Error in getPendingActivities:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching pending activities',
        data: null,
      });
    }
  }

  /**
   * Debug session filter - for testing purposes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async debugSessionFilter(req, res) {
    try {
      console.log('🔍 DEBUG SESSION FILTER - Starting...');

      // Test basic user data
      console.log('🔍 User data:', {
        userId: req.user?._id,
        username: req.user?.username,
        access: req.user?.access,
        salesAccess: req.user?.access?.sales,
        sessionFilter: req.user?.access?.sales?.session_filter,
      });

      // Test session filter utility
      const sessionFilterUtil = require('../utils/session-filter.util');

      // Test permission check
      const hasPermission = sessionFilterUtil.hasSessionFilterPermission(req.user);
      console.log('🔍 Permission check result:', hasPermission);

      // Test session data retrieval
      const sessionData = await sessionFilterUtil.getUserSessionData(req);
      console.log('🔍 Session data result:', sessionData);

      // Test session filter application
      const testDateRange = {
        start_date: new Date('2026-03-01'),
        end_date: new Date('2026-04-30'),
      };

      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, testDateRange);
      console.log('🔍 Filter result:', filteredDateRange);

      return res.status(200).json({
        type: 'success',
        message: 'Session filter debug completed',
        data: {
          user: {
            userId: req.user?._id,
            username: req.user?.username,
            sessionFilter: req.user?.access?.sales?.session_filter,
          },
          hasPermission,
          sessionData,
          originalDateRange: testDateRange,
          filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        },
      });
    } catch (error) {
      console.error('Error in debugSessionFilter:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Debug session filter failed',
        data: { error: error.message },
      });
    }
  }

  /**
   * Get top performers (users with highest sales)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardTopPerformers(req, res) {
    try {
      const { filter = 'month' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      await this.ensureContext(req);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Top Performers - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getDashboardTopPerformersModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: 'Top performers retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve top performers',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDashboardTopPerformers:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching top performers',
        data: null,
      });
    }
  }

  async getDashboardTotalAmounts(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      await this.ensureContext(req);

      const { filter = 'month' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Total Amounts - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getDashboardTotalAmountsModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'Totals retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve totals',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDashboardTotalAmounts:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching dashboard totals',
        data: null,
      });
    }
  }

  async getProfitSummary(req, res) {
    try {
      if (!req.user) {
        return res
          .status(401)
          .json({ type: 'error', message: 'Authentication required', data: null });
      }

      // Financial visibility is the real boundary, enforced here so a
      // salesperson cannot reach profit, cost or margin even by calling this
      // directly. The owner (role 'admin') always qualifies - which also
      // grandfathers shops upgraded before the flag existed; everyone else
      // needs it granted explicitly via access.dashboard.financials.
      if (!this.canSeeFinancials(req.user)) {
        return res.status(403).json({
          type: 'error',
          message: 'You do not have access to financial figures',
          data: null,
        });
      }

      await this.ensureContext(req);

      const { filter = 'month' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      const result = await req.dashboardModel.getProfitSummaryModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
        filter,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'Profit summary',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to compute profit',
        data: null,
      });
    } catch (error) {
      console.error('Error in getProfitSummary:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while computing profit',
        data: null,
      });
    }
  }

  async getDashboardSalesPurchase(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      await this.ensureContext(req);

      const { filter = 'month' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Sales/Purchase - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getDashboardSalesPurchaseModel({
        filter,
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'Sales/purchase data retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve sales/purchase data',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDashboardSalesPurchase:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching sales/purchase data',
        data: null,
      });
    }
  }

  async getDashboardBestSellingProducts(req, res) {
    try {
      if (!req.user) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      await this.ensureContext(req);

      const { filter = 'month' } = req.query;
      const timeZone = req.user?.settings?.time_zone || 'Asia/Kolkata';
      const originalDateRange = this.getDatesBasedOnFilter(filter, timeZone);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Best Selling Products - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const model = req.dashboardModel;
      const result = await model.getDashboardBestSellingProductsModel({
        starting_date: filteredDateRange.start_date,
        ending_date: filteredDateRange.end_date,
      });

      if (result?.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'Best selling products retrieved successfully',
          data: result.data,
        });
      }

      return res.status(400).json({
        type: 'error',
        message: result?.message || 'Failed to retrieve best selling products',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDashboardBestSellingProducts:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching best selling products',
        data: null,
      });
    }
  }

  getDatesBasedOnFilter(filter, timeZone) {
    const now = new Date();
    const start = new Date();

    // Match PHP filter values exactly: 'day', 'week', 'month', 'year'
    switch (filter.toLowerCase()) {
      case 'day':
      case 'today':
        // PHP: DateTime("now", timezone)
        start.setHours(0, 0, 0, 0);
        return {
          start_date: start,
          end_date: new Date(now.setHours(23, 59, 59, 999)),
        };

      // Braced: a const declared in a bare case belongs to the whole switch, so
      // it is in scope - and in its temporal dead zone - inside every other
      // branch too.
      case 'yesterday': {
        start.setDate(now.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const yesterdayEnd = new Date(start);
        yesterdayEnd.setHours(23, 59, 59, 999);
        return {
          start_date: start,
          end_date: yesterdayEnd,
        };
      }

      case 'week': {
        // PHP: DateTime("last Sunday", timezone)
        const dayOfWeek = now.getDay(); // 0 = Sunday
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        return {
          start_date: start,
          end_date: now,
        };
      }

      case 'month':
        // PHP: DateTime("first day of this month", timezone)
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return {
          start_date: start,
          end_date: now,
        };

      case 'year':
        // PHP: DateTime("first day of january this year", timezone)
        start.setMonth(0, 1);
        start.setHours(0, 0, 0, 0);
        return {
          start_date: start,
          end_date: now,
        };

      default:
        // Default to 'day' like PHP
        start.setHours(0, 0, 0, 0);
        return {
          start_date: start,
          end_date: new Date(now.setHours(23, 59, 59, 999)),
        };
    }
  }

  /**
   * PHP: getDashboardExpiredProducts()
   * Get expired products data for dashboard
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardExpiredProducts(req, res) {
    try {
      await this.ensureContext(req);

      const filter = req.query.filter || 'day';
      const model = req.dashboardModel;
      const originalDateRange = this.getDatesBasedOnFilter(filter, model.timeZone);

      // Apply session filtering if user has permission
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Dashboard Expired Products - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      const result = await model.getDashboardExpiredProducts(filteredDateRange);

      if (!result || result.status !== true) {
        return res.status(500).json({
          type: 'error',
          message: result?.message || 'Failed to retrieve expired products',
          data: null,
        });
      }

      return res.status(200).json({
        type: 'success',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getDashboardExpiredProducts:', error);
      return res.status(500).json({
        type: 'error',
        message: 'An error occurred while fetching expired products data',
        data: null,
      });
    }
  }
}

module.exports = new DashboardController();
