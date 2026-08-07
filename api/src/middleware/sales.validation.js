const { body, param } = require('express-validator');
const { ObjectId } = require('mongodb');
const { ERROR_MESSAGES } = require('../constants/sales.constants');
const { safeJsonParse } = require('../utils/helpers');
const {
  parseBranchIdsFromRequest,
  parseSaleDate,
  normalizeSaleItems,
} = require('../helpers/sales.helper');
const salesService = require('../services/sale.service');

/**
 * Validation middleware for creating a sale.
 *
 * This is intentionally conservative to avoid breaking existing legacy flows.
 * It can be strengthened later once all payload shapes are fully mapped.
 */
const validateCreateSale = [
  body('items').optional({ nullable: true }).isArray().withMessage(ERROR_MESSAGES.VALIDATION_ERROR),

  body('sales_total').optional().isNumeric().withMessage(ERROR_MESSAGES.VALIDATION_ERROR),
];

// Prepare payload for create sale requests without altering existing behaviour.
// This mirrors the parsing logic in SalesController.createOrHoldInternal but
// does not introduce new validation errors. On failure to parse, the
// controller will fall back to its existing logic.
const prepareCreateSalePayload = (req, res, next) => {
  try {
    let payload = req.body;

    if (typeof payload === 'string') {
      payload = safeJsonParse(payload, req.body);
    } else if (payload && typeof payload.data === 'string') {
      // Handle legacy wrappers where the actual payload is under a `data` key
      payload = safeJsonParse(payload.data, payload);
    }

    if (payload && typeof payload === 'object') {
      req.createSalePayload = payload;
    }

    return next();
  } catch (err) {
    // Do not change behaviour: let the controller handle malformed payloads
    return next();
  }
};

const prepareUpdateSalePayload = (req, res, next) => {
  let payload = req.body;
  if (typeof payload === 'string') {
    payload = safeJsonParse(payload, null);
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.INVALID_SALE_PAYLOAD,
      data: null,
    });
  }

  let rawItems = payload.items;
  if (typeof rawItems === 'string') {
    rawItems = safeJsonParse(rawItems, []);
  }

  const normalizedItems = normalizeSaleItems(rawItems);

  if (!Array.isArray(normalizedItems) || !normalizedItems.length) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.AT_LEAST_ONE_VALID_SALE_ITEM_REQUIRED,
      data: null,
    });
  }

  req.updateSalePayload = payload;
  req.updateSaleItems = normalizedItems;
  return next();
};

/**
 * Validation middleware for updating a sale.
 */
const validateUpdateSale = [
  param('id')
    .notEmpty()
    .withMessage(ERROR_MESSAGES.VALIDATION_ERROR)
    .isMongoId()
    .withMessage(ERROR_MESSAGES.VALIDATION_ERROR),

  body('sales_total').optional().isNumeric().withMessage(ERROR_MESSAGES.VALIDATION_ERROR),
];

/**
 * Ensure that :id route parameters are valid Mongo ObjectIds.
 *
 * This mirrors the legacy inline ensureValidSaleId helper used in sales.routes.
 * When the id is invalid, we call next("route") so that Express can fall back
 * to other matching routes (legacy behaviour).
 */
const ensureValidSaleIdParam = (req, res, next) => {
  const { id } = req.params;
  if (!id || !ObjectId.isValid(id)) {
    return next('route');
  }
  return next();
};

/**
 * Validation middleware for instantSaleDetails query.
 *
 * Mirrors the inline validation previously done in SalesController.instantSaleDetails:
 * - Accepts any of instant_id, sale_id, or id as the identifier.
 * - Requires a valid Mongo ObjectId string.
 * - On failure, returns the same error shape as BaseController.error with
 *   ERROR_MESSAGES.A_VALID_INSTANT_SALE_ID_REQUIRED.
 */
const validateInstantSaleDetailsQuery = (req, res, next) => {
  const instantId = req.query.instant_id || req.query.sale_id || req.query.id;

  if (!instantId || !ObjectId.isValid(String(instantId))) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.A_VALID_INSTANT_SALE_ID_REQUIRED,
      data: null,
    });
  }

  return next();
};

/**
 * Shared validation for daily sales report queries (dailySalesReports, dailyReportPdf).
 *
 * Ensures branch, starting_date, and ending_date are present and that branch
 * is a valid Mongo ObjectId. This mirrors the inline checks previously
 * performed in SalesController.dailySalesReports and SalesController.dailyReportPdf
 * using the same error messages and HTTP status codes.
 */
const validateDailyReportQuery = (req, res, next) => {
  const { branch, starting_date, ending_date } = req.query || {};

  if (!branch || !starting_date || !ending_date) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.MISSING_BRANCH_AND_DATE_PARAMS,
      data: null,
    });
  }

  if (!ObjectId.isValid(String(branch))) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.INVALID_BRANCH_ID_FORMAT,
      data: null,
    });
  }

  return next();
};

/**
 * Normalise query params for itemExpiryReportTable without changing behaviour.
 *
 * Builds the same { data, options } object that the controller previously
 * constructed inline and attaches it to req.itemExpiryReportParams so the
 * controller can stay thin.
 */
const prepareItemExpiryReportQuery = (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
  const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

  const options = { limit, page };

  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date,
    ending_date: req.query.ending_date,
  };

  req.itemExpiryReportParams = { data, options };
  return next();
};

const validateSalesSummaryReportQuery = (req, res, next) => {
  const { uniqueBranchIds, validBranchIds } = parseBranchIdsFromRequest(req);

  if (!uniqueBranchIds.length) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.AT_LEAST_ONE_BRANCH_ID_REQUIRED,
      data: null,
    });
  }

  if (!validBranchIds.length) {
    return res.status(400).json({
      type: 'error',
      status: false,
      message: ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED,
      data: null,
    });
  }

  req.salesSummaryBranchContext = { uniqueBranchIds, validBranchIds };
  return next();
};

const preparePaginatedDateRangeQuery = (req, res, next) => {
  const limitCandidate = parseInt(req.query.limit, 10);
  const pageCandidate = parseInt(req.query.page, 10);

  const limit = limitCandidate > 0 ? limitCandidate : 5;
  const page = pageCandidate > 0 ? pageCandidate : 1;
  const skip = (page - 1) * limit;

  const normalizeRangeDate = (value, options = {}) => {
    const { endOfDay = false } = options;
    if (!value) {
      return null;
    }
    const parsed = parseSaleDate(value);
    if (!parsed) {
      return null;
    }
    const normalized = new Date(parsed);
    normalized.setHours(0, 0, 0, 0);
    if (endOfDay) {
      normalized.setHours(23, 59, 59, 999);
    }
    return normalized;
  };

  const startDate = normalizeRangeDate(req.query.starting_date);
  const endDate = normalizeRangeDate(req.query.ending_date, { endOfDay: true });

  req.reportParams = { limit, page, skip, startDate, endDate };
  return next();
};

const validateSalesReportsQuery = (req, res, next) => {
  let branchIds = req.query.branch || req.query.branchid;

  if (!branchIds) {
    return res.status(400).json({
      type: 'error',
      message: ERROR_MESSAGES.BRANCH_ID_REQUIRED,
      data: null,
    });
  }

  // Handle comma-separated string or array
  if (!Array.isArray(branchIds)) {
    // Split by comma if it's a comma-separated string
    branchIds = String(branchIds)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id);
  }

  const branchObjectIds = branchIds
    .filter((id) => id && ObjectId.isValid(String(id)))
    .map((id) => new ObjectId(String(id)));

  if (!branchObjectIds.length) {
    return res.status(400).json({
      type: 'error',
      message: ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED,
      data: null,
    });
  }

  const startingDate = req.query.starting_date;
  const endingDate = req.query.ending_date;

  if (!startingDate || !endingDate) {
    return res.status(400).json({
      type: 'error',
      message: ERROR_MESSAGES.DATE_RANGE_REQUIRED,
      data: null,
    });
  }

  const startDate = new Date(startingDate);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(endingDate);
  endDate.setHours(23, 59, 59, 999);

  req.salesReportsFilters = { branchObjectIds, startDate, endDate };
  return next();
};

const prepareUserReportTableQuery = (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
  const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

  const options = { limit, page };

  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date || '',
    ending_date: req.query.ending_date || '',
    user_id: req.query.field_input || '',
  };

  req.userReportParams = { data, options };
  return next();
};

const prepareBranchPaginatedReportQuery = (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
  const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

  const options = { limit, page };

  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date || '',
    ending_date: req.query.ending_date || '',
  };

  req.branchPaginatedReportParams = { data, options };
  return next();
};

const preparePaymentPaginatedReportQuery = (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
  const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

  const options = { limit, page };

  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date || '',
    ending_date: req.query.ending_date || '',
    payment_mode: req.query.payment_mode || 'All',
  };

  req.paymentReportParams = { data, options };
  return next();
};

const prepareBranchReportQuery = (req, res, next) => {
  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date || '',
    ending_date: req.query.ending_date || '',
  };

  req.branchReportParams = { data };
  return next();
};

const prepareKioskPaginatedReportQuery = (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
  const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

  const options = { limit, page };

  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date,
    ending_date: req.query.ending_date,
    kiosk_method: req.query.kiosk_method || '',
  };

  req.kioskReportParams = { data, options };
  return next();
};

const prepareKioskReportQuery = (req, res, next) => {
  const branches = req.query['branch[]'] || req.query.branch || [];
  const data = {
    branchid: Array.isArray(branches) ? branches : [branches],
    starting_date: req.query.starting_date,
    ending_date: req.query.ending_date,
    kiosk_method: req.query.kiosk_method || '',
  };

  req.kioskBranchReportParams = { data };
  return next();
};

const prepareGstOneReportContext = async (req, res, next) => {
  try {
    let branchId = req.session?.selectedBranchId || req.session?.branch_id;
    if (!branchId && req.user?.branch_access && req.user.branch_access.length > 0) {
      branchId = req.user.branch_access[0].branch_id;
    }

    let branchState = '';
    if (branchId) {
      const branch = await salesService.getBranchById(branchId);
      if (branch) {
        branchState = branch.store_state || branch.state || '';
      }
    }

    const data = {
      starting_date: req.query.starting_date,
      ending_date: req.query.ending_date,
      branch_id: branchId,
      license: req.user?.license,
      branch_state: branchState,
    };

    req.gstOneReportParams = { data };
    return next();
  } catch (error) {
    return res.status(500).json({
      type: 'error',
      status: false,
      message: error.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND,
      data: null,
    });
  }
};

const prepareGstThreeReportContext = (req, res, next) => {
  try {
    const data = {
      starting_date: req.query.starting_date,
      ending_date: req.query.ending_date,
      branch_id: req.session?.branch_id,
      license: req.user?.license,
      branch_state: req.session?.branch_state,
    };

    req.gstThreeReportParams = { data };
    return next();
  } catch (error) {
    return res.status(500).json({
      type: 'error',
      status: false,
      message: error.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND,
      data: null,
    });
  }
};

/*
 * The kiosk-key guards live in middleware/kiosk-key, which imports nothing but
 * crypto. They were here, in a module that pulls in the whole service layer, so
 * a test of this security rule could not run without a database connection -
 * and an authentication guard should not be reachable only by loading the
 * validation layer.
 */
const { makeEnsureKioskKey, makeProtectOrKioskKey } = require('./kiosk-key');

const ensureKioskKey = makeEnsureKioskKey(ERROR_MESSAGES);
const protectOrKioskKey = makeProtectOrKioskKey(ERROR_MESSAGES);

module.exports = {
  protectOrKioskKey,
  validateCreateSale,
  validateUpdateSale,
  prepareCreateSalePayload,
  prepareUpdateSalePayload,
  ensureValidSaleIdParam,
  validateInstantSaleDetailsQuery,
  validateDailyReportQuery,
  prepareItemExpiryReportQuery,
  validateSalesSummaryReportQuery,
  preparePaginatedDateRangeQuery,
  validateSalesReportsQuery,
  prepareUserReportTableQuery,
  prepareBranchPaginatedReportQuery,
  preparePaymentPaginatedReportQuery,
  prepareBranchReportQuery,
  prepareGstOneReportContext,
  prepareGstThreeReportContext,
  prepareKioskPaginatedReportQuery,
  prepareKioskReportQuery,
  ensureKioskKey,
};
