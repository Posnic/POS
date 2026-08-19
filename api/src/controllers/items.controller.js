// src/controllers/items_controller.js
const BaseController = require('./base.controller');
const { currentSecret } = require('../db/tenant-context');
const ItemService = require('../services/item.service');
const { safeJsonParse, formatDate } = require('../utils/helpers');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../constants/items.constants');
const sessionFilterUtil = require('../utils/session-filter.util');
const { toObjectId } = require('../utils/tenant-context');
const { isKioskConfigured } = require('../utils/kiosk');

class ItemsController extends BaseController {
  constructor() {
    // Initialise without a legacy Item model; use a lightweight context
    // object for branch/license and delegate all DB access to ItemService.
    super();
    // Preserve the legacy `this.model.*` API without storing tenant data on
    // this singleton controller. BaseModel delegates these properties to the
    // request AsyncLocalStorage context in the running application.
    const BaseModel = require('../models/base.model');
    const legacyContextModel = {};
    Object.defineProperties(legacyContextModel, {
      branchId: {
        get: () => BaseModel.currentBranch,
        set: (value) => {
          BaseModel.currentBranch = value;
        },
      },
      licenseId: {
        get: () => BaseModel.license,
        set: (value) => {
          BaseModel.license = value;
        },
      },
      loggedUserId: {
        get: () => BaseModel.loggedUser,
        set: (value) => {
          BaseModel.loggedUser = value;
        },
      },
      loggedUserName: {
        get: () => BaseModel.loggedUserName,
        set: (value) => {
          BaseModel.loggedUserName = value;
        },
      },
    });
    Object.defineProperty(this, 'model', {
      configurable: false,
      enumerable: true,
      get: () => legacyContextModel,
      // Some legacy callers/tests clear `model`; tenant state must never be
      // replaced with a process-global plain object.
      set: () => {},
    });
    this.service = new ItemService();
  }

  setRequestContext(req) {
    const BaseModel = require('../models/base.model');
    const user = req.user || {};
    const sessionBranch = req.session?.selectedBranchId || req.session?.branch_id;
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

    const branchParam =
      req.tenantContext?.branchId ||
      sessionBranch ||
      user.branch_id ||
      user.branchId ||
      user.branch?._id ||
      user.default_branch_id ||
      branchAccessEntry?.branch_id ||
      branchAccessEntry?._id ||
      null;

    const rawBranch = Array.isArray(branchParam) ? branchParam[0] : branchParam;
    const branchId = toObjectId(rawBranch);

    const licenseParam = req.tenantContext?.licenseId || user.license || user.license_id || null;

    const licenseId = toObjectId(licenseParam);
    req.itemContext = {
      branchId,
      branchName: req.tenantContext?.branchName || user.branch_name || '',
      licenseId,
    };
    BaseModel.currentBranch = branchId;
    BaseModel.currentBranchName = req.itemContext.branchName;
    BaseModel.license = licenseId;

    if (user._id) {
      BaseModel.loggedUser = user._id;
      req.itemContext.loggedUserId = user._id;
    }

    if (user.name || user.username || user.email) {
      BaseModel.loggedUserName = user.name || user.username || user.email;
      req.itemContext.loggedUserName = user.name || user.username || user.email;
    }
    return req.itemContext;
  }

  async ensureContext(req) {
    const requestContext = this.setRequestContext(req);

    if (requestContext.branchId && requestContext.licenseId) {
      return requestContext;
    }

    const userBranchId = req.user?.branch_id || req.user?.branchId;
    const currentLicenseId =
      requestContext.licenseId || req.user?.license || req.user?.license_id || null;

    const context = await this.service.resolveBranchContext({
      userBranchId,
      licenseId: currentLicenseId,
      currentBranchId: requestContext.branchId || null,
      currentLicenseId,
    });

    if (context.branchId) {
      requestContext.branchId = toObjectId(context.branchId);
    }
    if (context.licenseId && !requestContext.licenseId) {
      requestContext.licenseId = toObjectId(context.licenseId);
    }
    return requestContext;
  }

  parseFilters(rawFilters) {
    if (!rawFilters) {
      return {};
    }
    if (typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
      return rawFilters;
    }
    if (typeof rawFilters === 'string') {
      const parsed = safeJsonParse(rawFilters, null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      console.warn('Unable to parse filters for items_controller');
      return {};
    }
    return {};
  }

  normalizeBranchesInput(rawBranches) {
    let branches = rawBranches;

    if (branches == null) {
      return [];
    }

    if (typeof branches === 'string' && branches.includes(',')) {
      branches = branches
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
    } else if (!Array.isArray(branches)) {
      branches = [branches];
    }

    return branches;
  }

  /**
   * Has this branch been set up to run a kiosk?
   *
   * The rule itself lives in utils/kiosk; this is the lookup around it.
   *
   * Answers false on any failure. Hiding an optional column from a shop that
   * might have wanted it is a far smaller harm than a failed list of items.
   */
  async isKioskConfigured(branchId) {
    if (!branchId) return false;
    try {
      /*
       * Only ask if the database is actually there.
       *
       * This decides whether to draw one optional column, and it must never be
       * the reason the item list is slow. It first used a 750ms race against
       * the lookup, which was the wrong instrument: Mongoose does not fail when
       * it has no connection, it *buffers* the query for ten seconds, and a
       * timer racing that is a coin toss decided by how loaded the machine is.
       * It passed here and failed on CI, which is exactly what that kind of
       * flakiness looks like.
       *
       * readyState is a synchronous property. Connected, and the query runs
       * against a live socket and returns promptly. Not connected, and the
       * answer is no, immediately, with nothing left buffering in the
       * background to time out and log after the request has finished.
       */
      const mongoose = require('mongoose');
      if (mongoose.connection?.readyState !== 1) return false;

      const { getBranchById } = require('../services/sale.service');
      return isKioskConfigured(await getBranchById(branchId));
    } catch (error) {
      console.warn('isKioskConfigured: branch lookup failed', error.message);
      return false;
    }
  }

  /**
   * List items with pagination and optional filters
   * GET /items (legacy default endpoint)
   */
  async getAll(req, res) {
    try {
      await this.ensureContext(req);

      // Check user access
      const userAccess = req.user?.access?.item?.read;
      if (userAccess === false) {
        return this.sendError(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const limitParam = parseInt(req.query.limit, 10);
      const pageParam = parseInt(req.query.page, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 5;
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

      // Preserve existing flexible filter parsing semantics
      let filters = {};
      if (req.query.filters) {
        if (typeof req.query.filters === 'string') {
          const parsedFilters = safeJsonParse(req.query.filters, null);
          if (parsedFilters && typeof parsedFilters === 'object' && !Array.isArray(parsedFilters)) {
            filters = parsedFilters;
          }
        } else if (typeof req.query.filters === 'object' && !Array.isArray(req.query.filters)) {
          filters = req.query.filters;
        }
      }

      const options = { limit, page, sort: { _id: -1 } };

      // Use the service layer (ItemService → ItemRepository → LegacyItemModel)
      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;

      const result = await this.service.getAllItems({
        branchId,
        licenseId,
        filters,
        options,
      });

      if (result.status === true) {
        /*
         * Whether this branch runs a kiosk at all.
         *
         * The Item List carries a Kiosk toggle on every row. On a shop with no
         * kiosk that column is a control that does nothing, taking space from
         * the columns that matter on the page staff use most.
         *
         * Sent from here rather than read from a cached setting: the cache is
         * only written when the Settings page is opened, so a till that never
         * visited Settings would have to guess - and guessing wrong either
         * hides a control a kiosk shop needs or shows one nobody can use.
         */
        // Shape already matches legacy itemPage() result.data
        return this.sendResponse(
          res,
          { ...result.data, kiosk_configured: await this.isKioskConfigured(branchId) },
          result.message
        );
      }

      return this.sendError(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, result.data);
    } catch (error) {
      console.error('Error fetching items:', error);
      return this.sendError(res, ERROR_MESSAGES.FAILED_TO_FETCH_ITEMS, 500, error);
    }
  }

  async itemLowStockTable(req, res) {
    try {
      await this.ensureContext(req);

      const userAccess = req.user?.access?.item?.read;
      if (userAccess === false) {
        return this.sendError(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const limitParam = parseInt(req.query.limit, 10);
      const pageParam = parseInt(req.query.page, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 5;
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

      const notificationRaw = req.query.notificationrange ?? req.query.notificationRange;
      const notificationRange =
        notificationRaw !== undefined && notificationRaw !== null
          ? parseInt(notificationRaw, 10)
          : null;

      const filters = this.parseFilters(req.query.filters);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;

      const response = await this.service.getLowStockItems(
        {
          branchId,
          notificationRange,
          page,
          limit,
          filters,
        },
        {
          branchId,
          licenseId,
        }
      );

      if (response && response.status === true) {
        return this.sendResponse(res, response.data, response.message || 'success');
      }

      return this.sendError(
        res,
        response?.message || ERROR_MESSAGES.FAILED_TO_FETCH_ITEMS,
        500,
        response?.data || null
      );
    } catch (error) {
      console.error('Error in itemLowStockTable:', error);
      return this.sendError(res, ERROR_MESSAGES.FAILED_TO_FETCH_ITEMS, 500, error);
    }
  }

  // PHP: getReceivingItemsAjaxList() - New Purchase item autocomplete
  // Frontend expects a bare { query, suggestions } payload (no type/status
  // wrapper) on success, and a standard { type: 'error', message, data }
  // structure on failure. This mirrors the legacy PHP controller which uses
  // $this->jsonResponse($response) for success.
  /*
   * getReceivingItemsAjaxList was defined twice in this class. A later definition
   * replaces an earlier one, so this first version never ran - the live one is
   * further down this file. Removed rather than merged: merging would change
   * behaviour, and what runs today is the other one.
   */

  /**
   * Create a whole variant family atomically (V1). One request replaces
   * the old one-POST-per-variant flow whose partial failures left half a
   * family behind. Validation and rollback live in the service.
   */
  async createFamily(req, res) {
    try {
      if (req.user?.access?.item?.write === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const result = await this.service.createItemFamily({
        data: req.body || {},
        branchId: this.model?.branchId || null,
        licenseId: this.model?.licenseId || null,
        user: req.user || {},
      });
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(
        res,
        result?.message || 'Could not create the family',
        400,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in createFamily:', error);
      return this.error(res, error.message, 500);
    }
  }

  /** The family strip's data: every member of one variant group (V1). */
  async getFamily(req, res) {
    try {
      await this.ensureContext(req);
      const result = await this.service.repository.getFamily(req.query.group_id, {
        licenseId: this.model?.licenseId || null,
      });
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Could not load the family', 400);
    } catch (error) {
      console.error('Error in getFamily:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: add() - Create new item (POST /items)
   */
  async add(req, res) {
    try {
      await this.ensureContext(req);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;
      const user = req.user || {};

      const result = await this.service.addItem({
        data: req.body || {},
        branchId,
        licenseId,
        user,
      });

      if (result && result.status === true && result.data) {
        // Legacy frontend expects response.data to be the created item
        return this.success(res, result.data, result.message || 'Item created successfully');
      }

      if (result?.status === 'exist') {
        return this.error(
          res,
          result.message || 'This item already exists',
          409,
          result.data || null
        );
      }

      return this.error(
        res,
        result?.message || ERROR_MESSAGES.FAILED_TO_CREATE_ITEM,
        400,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in add:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_CREATE_ITEM, 500, error);
    }
  }

  /**
   * PHP: delete() - Delete items (bulk support)
   * Legacy frontend calls DELETE /items/delete with { data: [ids] }.
   */
  /*
   * delete was defined twice in this class. A later definition
   * replaces an earlier one, so this first version never ran - the live one is
   * further down this file. Removed rather than merged: merging would change
   * behaviour, and what runs today is the other one.
   */

  async getByCategory(req, res) {
    try {
      const { categoryId } = req.params;

      const result = await this.service.getItemsByCategory(categoryId);

      if (result.status === true) {
        // Legacy endpoint expected a bare list, not wrapped object
        return this.sendResponse(res, result.data);
      }

      return this.sendError(
        res,
        ERROR_MESSAGES.FAILED_TO_FETCH_ITEMS_BY_CATEGORY,
        500,
        result.data
      );
    } catch (error) {
      console.error('Error in getByCategory:', error);
      return this.sendError(res, ERROR_MESSAGES.FAILED_TO_FETCH_ITEMS_BY_CATEGORY, 500, error);
    }
  }

  /**
   * PHP: edit() - Update existing item (PUT /items/:id)
   */
  async edit(req, res) {
    try {
      await this.ensureContext(req);

      const id = req.params.id;
      if (!id) {
        return this.error(res, ERROR_MESSAGES.ITEM_ID_REQUIRED, 400);
      }

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;
      const user = req.user || {};

      const result = await this.service.updateItem({
        id,
        data: req.body || {},
        branchId,
        licenseId,
        user,
      });

      if (result && result.status === true && result.data) {
        return this.success(res, result.data, result.message || 'Item updated successfully');
      }

      return this.error(res, ERROR_MESSAGES.FAILED_TO_UPDATE_ITEM, 500, result?.data || null);
    } catch (error) {
      console.error('Error in edit:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_UPDATE_ITEM, 500, error);
    }
  }

  async accesskiosk(req, res) {
    try {
      // Per installation, set by the desktop app at startup. It used to be a
      // constant here, which meant every till in the world accepted the same
      // key and reading the source was enough to call this endpoint on any of
      // them. Read at call time, since main.js sets it while starting.
      const kioskKey = req.headers['kioskkey'];
      const expected = currentSecret('KIOSK_API_KEY', process.env.KIOSK_API_KEY) || null;
      if (!expected || kioskKey !== expected) {
        // 401, not 403: a wrong or missing kiosk key is failed AUTHENTICATION
        // of the kiosk device. 403 is reserved for a signed-in user who lacks
        // a permission (the browser client signs out on 401 by design).
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 401);
      }

      const response = await this.service.accessKiosk(req.body.branch);
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in accesskiosk:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: instanceItemInsert()
   * Create a new instant item and return it in PHP-compatible shape.
   * Frontend expects { type: 'success', data: { id, name, ... } }.
   */
  async instanceItemInsert(req, res) {
    try {
      await this.ensureContext(req);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;
      const user = req.user || {};

      if (!branchId || !licenseId) {
        return this.error(res, ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED, 400);
      }

      const context = {
        branchId,
        licenseId,
        userId: user._id || null,
        userName: user.name || user.username || user.email || null,
      };

      const payload = req.body || {};

      const result = await this.service.createInstantItem({
        data: payload,
        context,
      });

      if (result && result.status === true && result.data) {
        // Match legacy PHP response: type: 'success', data: full item doc
        return this.success(res, result.data, result.message || 'success');
      }

      return this.error(
        res,
        result?.message || ERROR_MESSAGES.FAILED_TO_CREATE_ITEM,
        500,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in instanceItemInsert:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_CREATE_ITEM, 500, error);
    }
  }

  /**
   * PHP: deleteInstant()
   * Delete an instant item by id.
   */
  async deleteInstant(req, res) {
    try {
      await this.ensureContext(req);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;

      const context = {
        branchId,
        licenseId,
      };

      const id = (req.body && (req.body.id || req.body._id)) || req.query.id || null;

      if (!id) {
        return this.error(res, ERROR_MESSAGES.ITEM_ID_REQUIRED, 400);
      }

      const result = await this.service.deleteInstantItem({ id, context });

      if (result && result.status === true) {
        // PHP returns: response('success', 'success', deletedCount, 200)
        return this.success(res, result.data, result.message || 'success');
      }

      return this.error(
        res,
        result?.message || ERROR_MESSAGES.FAILED_TO_DELETE_INSTANT_ITEM,
        500,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in deleteInstant:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_DELETE_INSTANT_ITEM, 500, error);
    }
  }

  async updateKioskStatus(req, res) {
    try {
      const { id, status } = req.body;
      const response = await this.service.updateKioskStatus(id, status);
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      }

      return this.error(res, response.message, 404, response.data);
    } catch (error) {
      console.error('Error in updateKioskStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  async bulkUpdateKioskStatus(req, res) {
    try {
      const items = req.body.items || [];
      const status = req.body.status || false;

      if (!Array.isArray(items) || items.length === 0) {
        return this.error(res, ERROR_MESSAGES.NO_ITEMS_TO_BULK_UPDATE, 400);
      }

      const results = [];
      for (const itemId of items) {
        try {
          const response = await this.service.updateKioskStatus(itemId, status);
          results.push({ id: itemId, success: response.status === true });
        } catch (e) {
          results.push({ id: itemId, success: false, error: e.message });
        }
      }

      return this.success(res, results, 'Bulk update completed');
    } catch (error) {
      console.error('Error in bulkUpdateKioskStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getItemsByCategoryId(req, res) {
    try {
      await this.ensureContext(req);
      const categoryId = req.query.category_id;

      if (!categoryId) {
        return this.error(res, ERROR_MESSAGES.CATEGORY_ID_REQUIRED, 400);
      }

      const response = await this.service.getItemsByCategoryId(categoryId, {
        branchId: this.model?.branchId || null,
        licenseId: this.model?.licenseId || null,
      });
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      }

      return this.error(res, response.message, 404, response.data);
    } catch (error) {
      console.error('Error in getItemsByCategoryId:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getOne(req, res) {
    try {
      await this.ensureContext(req);

      const id = req.params.id || req.query.id;
      if (!id) {
        return this.error(res, ERROR_MESSAGES.ITEM_ID_REQUIRED, 400);
      }

      const licenseId = this.model?.licenseId || req.user?.license || req.user?.license_id || null;

      const result = await this.service.getItemById(id, {
        branchId: this.model?.branchId || null,
        licenseId,
      });

      if (result && result.status === true && result.data) {
        return this.success(res, result.data, result.message || 'success');
      }

      return this.error(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, result?.data || null);
    } catch (error) {
      console.error('Error in getOne:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_LOAD_ITEM, 500, error);
    }
  }

  async getItemDetails(req, res) {
    try {
      await this.ensureContext(req);

      const id = req.query.id;
      if (!id) {
        return this.error(res, ERROR_MESSAGES.ITEM_ID_REQUIRED, 400);
      }

      const licenseId = this.model?.licenseId || req.user?.license || req.user?.license_id || null;

      const result = await this.service.getItemById(id, {
        branchId: this.model?.branchId || null,
        licenseId,
      });

      if (result && result.status === true && result.data) {
        return this.success(res, result.data, result.message || 'success');
      }

      return this.error(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, result?.data || null);
    } catch (error) {
      console.error('Error in getItemDetails:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_LOAD_ITEM, 500, error);
    }
  }

  async itemSearchTable(req, res) {
    try {
      await this.ensureContext(req);

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 52;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };
      const filter = req.query.filter || '';
      const startingPrice = req.query.starting_price;
      const endingPrice = req.query.ending_price;

      const response = await this.service.itemSearchPage(
        {
          startingPrice,
          endingPrice,
          filterValue: filter,
          options,
        },
        {
          branchId: this.model?.branchId || null,
          licenseId: this.model?.licenseId || null,
        }
      );

      if (response.status === true) {
        return this.success(res, response, 'Get Successfully');
      }

      return this.error(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, response);
    } catch (error) {
      console.error('Error in itemSearchTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  async onlineSalesItemsAjaxLists(req, res) {
    try {
      await this.ensureContext(req);

      const limitParam = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;

      const response = await this.service.getOnlineSalesItems(
        { limit },
        {
          branchId: this.model?.branchId || null,
          licenseId: this.model?.licenseId || null,
        }
      );

      if (response && response.status === true) {
        return this.success(res, response.data, response.message || 'success');
      }

      return this.error(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, response?.data || null);
    } catch (error) {
      console.error('Error in onlineSalesItemsAjaxLists:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getOnlineItemsAjaxList(req, res) {
    try {
      await this.ensureContext(req);

      const query = req.query.query || '';
      const type = req.query.type || 'normal';
      const limitParam = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 5;

      const response = await this.service.getOnlineItemsAjaxList(
        { query, type, limit },
        {
          branchId: this.model?.branchId || null,
          licenseId: this.model?.licenseId || null,
        }
      );

      if (response && response.status === true) {
        return res.status(200).json({
          query,
          suggestions: response.data || [],
        });
      }

      return this.error(res, ERROR_MESSAGES.ITEM_NOT_FOUND, 404, response?.data || null);
    } catch (error) {
      console.error('Error in getOnlineItemsAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }

  async accessQr(req, res) {
    try {
      const projectType = req.body.project_type || null;
      const isStockProject = projectType === 'stock';
      const branch = req.body.branch;

      const response = await this.service.accessQr({
        projectType,
        branch,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in accessQr:', error);
      return this.error(res, error.message, 500);
    }
  }

  async accessMobileApp(req, res) {
    try {
      const response = await this.service.accessMobileApp(req.body.branch);
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in accessMobileApp:', error);
      return this.error(res, error.message, 500);
    }
  }

  async updateItemQuantity(req, res) {
    try {
      const { id, value } = req.body;

      if (!id || value === undefined) {
        return this.error(res, ERROR_MESSAGES.INVALID_ID_AND_QUANTITY_REQUIRED, 400);
      }

      const result = await this.service.updateItemQuantity(id, value);

      if (!result || result.status !== true) {
        const message =
          ERROR_MESSAGES.FAILED_TO_UPDATE_QUANTITY_PREFIX + (result?.message || 'Unknown error');
        return this.error(res, message, 500);
      }

      return this.success(res, null, 'Quantity Updated Successfully');
    } catch (error) {
      console.error('Error in updateItemQuantity:', error);
      const message = ERROR_MESSAGES.FAILED_TO_UPDATE_QUANTITY_PREFIX + error.message;
      return this.error(res, message, 500);
    }
  }

  /**
   * PHP: categoryItemsReportTable()
   * Category-based product summary report
   * Endpoint: GET /items/categoryItemsReportTable
   */
  /*
   * categoryItemsReportTable was defined twice in this class. A later
   * definition replaces an earlier one, so this first version never ran - the
   * live one is further down this file. Removed rather than merged: merging
   * would change behaviour, and what runs today is the other one.
   */

  /**
   * PHP: supplierItemsReportTable()
   * Supplier-based item summary report
   * Endpoint: GET /items/supplierItemsReportTable
   */
  /*
   * supplierItemsReportTable was defined twice in this class. A later
   * definition replaces an earlier one, so this first version never ran - the
   * live one is further down this file. Removed rather than merged: merging
   * would change behaviour, and what runs today is the other one.
   */

  async categoryProductDetails(req, res) {
    try {
      await this.ensureContext(req);

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];

      const data = {
        category_id: req.query.category_id,
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
      };

      const result = await this.service.categoryProductDetails(data, {
        licenseId: this.model?.licenseId || null,
        options,
      });
      return this.success(res, result.data, result.message || 'Get Successfully');
    } catch (error) {
      console.error('Error in categoryProductDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: supplierProductDetails()
   * Get supplier product details
   */
  async supplierProductDetails(req, res) {
    try {
      await this.ensureContext(req);

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];

      const data = {
        supplier_id: req.query.supplier_id,
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
      };

      const result = await this.service.supplierProductDetails(data, {
        licenseId: this.model?.licenseId || null,
        options,
      });
      return this.success(res, result.data, result.message || 'Get Successfully');
    } catch (error) {
      console.error('Error in supplierProductDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getCustomerSearchItemsAjaxList()
   * Get items for customer search
   */
  async getCustomerSearchItemsAjaxList(req, res) {
    try {
      await this.ensureContext(req);
      const query = req.query.query || '';

      const response = await this.service.getCustomerSearchItems(query, {
        branchId: this.model?.branchId || null,
        licenseId: this.model?.licenseId || null,
      });
      if (response.status === true) {
        return res.status(200).json({
          query: query,
          suggestions: response.data,
        });
      } else {
        return this.error(res, ERROR_MESSAGES.ITEM_NOT_FOUND, 404, response.data);
      }
    } catch (error) {
      console.error('Error in getCustomerSearchItemsAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }

  async quantityCount(req, res) {
    try {
      await this.ensureContext(req);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;

      // notificationrange can come from query string or be derived from branch settings
      const rawRange =
        req.query.notificationrange ??
        req.query.notificationRange ??
        req.query.notification_range ??
        null;

      let notificationRange =
        rawRange !== undefined && rawRange !== null && String(rawRange).trim() !== ''
          ? parseInt(rawRange, 10)
          : NaN;

      if (!Number.isFinite(notificationRange) || notificationRange < 0) {
        const branchRange = await this.service.getBranchNotificationRange(branchId);
        if (Number.isFinite(branchRange) && branchRange >= 0) {
          notificationRange = branchRange;
        }
      }

      if (!Number.isFinite(notificationRange) || notificationRange < 0) {
        return this.success(res, { count: 0, list: [] }, 'No notification range configured');
      }

      const match = {
        available_quantity: { $lte: notificationRange },
        item_status: { $ne: 'instant' },
      };

      // Add branch and license filtering
      // Match PHP behaviour: filter by current branch via branch_access.branch_id,
      // while also supporting documents that store a direct branch_id field.
      if (branchId) {
        match.$or = [{ 'branch_access.branch_id': branchId }, { branch_id: branchId }];
      }

      if (licenseId) {
        match.license = licenseId;
      }

      const result = await this.service.quantityCount(match);

      if (!result || result.status !== true || !result.data) {
        return this.error(
          res,
          ERROR_MESSAGES.FAILED_TO_GET_QUANTITY_COUNT,
          500,
          result?.data || null
        );
      }

      const { count = 0, listDocs = [] } = result.data || {};
      const list = Array.isArray(listDocs)
        ? listDocs.map((doc) => ({
            ...doc,
            date: formatDate(doc.created_date || doc.date || null),
          }))
        : [];

      return this.success(res, { count, list }, result.message || 'success');
    } catch (error) {
      console.error('Error in quantityCount:', error);
      return this.error(res, ERROR_MESSAGES.FAILED_TO_GET_QUANTITY_COUNT, 500, error);
    }
  }

  /**
   * PHP: itemStockReportTable()
   * Get item stock report
   */
  async itemStockReportTable(req, res) {
    try {
      await this.ensureContext(req);

      const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
      const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
      const options = { limit, page };

      const branches = this.normalizeBranchesInput(req.query['branch[]'] || req.query.branch || []);

      const data = {
        branchid: branches,
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
      };

      // Apply session filtering if user has permission and dates are provided
      if (data.starting_date || data.ending_date) {
        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        // Update data with filtered dates
        data.starting_date = filteredDateRange.start_date;
        data.ending_date = filteredDateRange.end_date;
      } else {
      }

      const response = await this.service.itemStockReportTable(data, {
        licenseId: this.model?.licenseId || null,
        options,
      });

      if (response.status === true) {
        return this.success(
          res,
          {
            total: response.total,
            current_page: response.current_page,
            total_pages: response.total_pages,
            per_page: response.per_page,
            list: response.list,
            selling_total: response.selling_total,
            company_total: response.company_total,
          },
          'Get Successfully'
        );
      }

      return this.error(res, ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404, response);
    } catch (error) {
      console.error('Error in itemStockReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  async exportItems(req, res) {
    try {
      const userAccess = req.user?.access?.item?.read;
      if (userAccess === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      await this.ensureContext(req);

      const normalizeIds = (raw) => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (!trimmed) return [];
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [trimmed];
          } catch (e) {
            return [trimmed];
          }
        }

        if (typeof raw === 'object') {
          if (Array.isArray(raw.data)) {
            return raw.data;
          }
          if (typeof raw.data === 'string') {
            const candidate = raw.data.trim();
            if (!candidate) return [];
            try {
              const parsed = JSON.parse(candidate);
              return Array.isArray(parsed) ? parsed : [candidate];
            } catch (e) {
              return [candidate];
            }
          }
          const values = Object.values(raw).filter((v) => typeof v === 'string' && v.trim());
          return values.length ? values : [];
        }

        return [];
      };

      const ctx = req.itemContext || {};
      const licenseId =
        ctx.licenseId || this.model?.licenseId || req.user?.license || req.user?.license_id || null;
      const branchId = ctx.branchId || null;

      // "Select all N": the client sends { all: true } (with the active
      // category/search) instead of a page's worth of ids, so we export every
      // matching item, not just the ~100 rows the grid had loaded.
      const body = req.body;
      const wantsAll =
        body && typeof body === 'object' && !Array.isArray(body) && body.all === true;

      let result;
      if (wantsAll) {
        // The client sends the same `filters` object the item list uses, so the
        // export matches the filtered list exactly. It may arrive as an object
        // or a JSON string (the list stores it stringified).
        let filters = body.filters;
        if (typeof filters === 'string') {
          filters = safeJsonParse(filters, {});
        }
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
          filters = {};
        }

        result = await this.service.exportItems(
          {
            all: true,
            filters,
            categoryId: body.category_id || body.categoryId || null,
          },
          { licenseId, branchId }
        );
      } else {
        const ids = normalizeIds(body);
        if (!Array.isArray(ids) || ids.length === 0) {
          return this.error(res, ERROR_MESSAGES.NO_ITEM_IDS_PROVIDED, 400);
        }
        result = await this.service.exportItems(ids, { licenseId, branchId });
      }

      if (result && result.status === true) {
        return this.success(res, result.data, result.message || 'Item Data Exported');
      }

      return this.error(
        res,
        result?.message || ERROR_MESSAGES.ITEMS_EXPORTED_UNSUCCESSFULLY,
        404,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in exportItems:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Raise or lower prices across many items at once (all, or one category),
   * by a percentage or a flat amount, on one price field. Body:
   * { scope: 'all'|'category', category_id?, field, op: 'percent'|'amount',
   *   value, direction: 'increase'|'decrease' }.
   */
  async bulkUpdatePrices(req, res) {
    try {
      if (req.user?.access?.item?.write === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, field, op, value, direction, skipViolations } = req.body || {};
      const result = await this.service.bulkUpdatePrices(
        {
          scope,
          categoryId: category_id,
          field,
          op,
          value,
          direction,
          skipViolations: skipViolations === true || skipViolations === 'true',
        },
        { branchId: ctx.branchId, userName: ctx.loggedUserName, userId: ctx.loggedUserId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Bulk price update failed', 400);
    } catch (error) {
      console.error('Error in bulkUpdatePrices:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Dry-run a bulk price change: what would change, and which items it would
   * push over MRP or under cost. The "check feasible" button before applying.
   */
  async bulkPricePreview(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, field, op, value, direction } = req.body || {};
      const result = await this.service.previewBulkUpdatePrices(
        { scope, categoryId: category_id, field, op, value, direction },
        { branchId: ctx.branchId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Could not check prices', 400);
    } catch (error) {
      console.error('Error in bulkPricePreview:', error);
      return this.error(res, error.message, 500);
    }
  }

  /** Set the selling price from a target margin across items or a category. */
  async bulkSetMargin(req, res) {
    try {
      if (req.user?.access?.item?.write === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, margin, mode, skipViolations } = req.body || {};
      const result = await this.service.bulkSetMargin(
        {
          scope,
          categoryId: category_id,
          margin,
          mode,
          skipViolations: skipViolations === true || skipViolations === 'true',
        },
        { branchId: ctx.branchId, userName: ctx.loggedUserName, userId: ctx.loggedUserId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Could not set margin', 400);
    } catch (error) {
      console.error('Error in bulkSetMargin:', error);
      return this.error(res, error.message, 500);
    }
  }

  /** Dry-run a margin change before applying it. */
  async marginPreview(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, margin, mode } = req.body || {};
      const result = await this.service.previewSetMargin(
        { scope, categoryId: category_id, margin, mode },
        { branchId: ctx.branchId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Could not check margin', 400);
    } catch (error) {
      console.error('Error in marginPreview:', error);
      return this.error(res, error.message, 500);
    }
  }

  /** Price-change history for one item, newest first. */
  async getPriceHistory(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const itemId = req.params.id || req.params.itemId;
      const result = await this.service.getPriceHistory(itemId, { limit: req.query.limit });
      return this.success(res, result.data || [], 'Price history');
    } catch (error) {
      console.error('Error in getPriceHistory:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getBulkPriceUpdates(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const result = await this.service.getBulkPriceUpdates({
        limit: req.query.limit,
        skip: req.query.skip,
      });
      return this.success(
        res,
        { runs: result.data || [], total: result.total || 0 },
        'Bulk price history'
      );
    } catch (error) {
      console.error('Error in getBulkPriceUpdates:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Add to or remove from stock across many items or a category at once. Every
   * changed, inventory-tracked item is written to the stock log with the note
   * the shopkeeper attached, so the movement is auditable.
   */
  async bulkUpdateStock(req, res) {
    try {
      if (req.user?.access?.item?.write === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, op, value, direction, note } = req.body || {};
      const result = await this.service.bulkUpdateStock(
        { scope, categoryId: category_id, op, value, direction, note },
        { branchId: ctx.branchId, userName: ctx.loggedUserName, userId: ctx.loggedUserId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Bulk stock update failed', 400);
    } catch (error) {
      console.error('Error in bulkUpdateStock:', error);
      return this.error(res, error.message, 500);
    }
  }

  /** Dry-run a bulk stock change: how many items it would change. */
  async bulkStockPreview(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const ctx = req.itemContext || {};
      const { scope, category_id, op, value, direction } = req.body || {};
      const result = await this.service.previewBulkUpdateStock(
        { scope, categoryId: category_id, op, value, direction },
        { branchId: ctx.branchId }
      );
      if (result && result.status) return this.success(res, result.data, result.message);
      return this.error(res, result?.message || 'Could not check stock', 400);
    } catch (error) {
      console.error('Error in bulkStockPreview:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getBulkStockUpdates(req, res) {
    try {
      if (req.user?.access?.item?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.ensureContext(req);
      const result = await this.service.getBulkStockUpdates({
        limit: req.query.limit,
        skip: req.query.skip,
      });
      return this.success(
        res,
        { runs: result.data || [], total: result.total || 0 },
        'Bulk stock history'
      );
    } catch (error) {
      console.error('Error in getBulkStockUpdates:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: itemsImport() - Bulk import items from CSV/Excel
   * Frontend posts to `items/itemsImport` with body { result: [...] }.
   */
  async itemsImport(req, res) {
    try {
      const userAccess = req.user?.access?.item?.write;
      if (userAccess === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const rows = req.body?.result || req.body?.items || [];

      if (!Array.isArray(rows) || rows.length === 0) {
        return this.error(res, ERROR_MESSAGES.NO_ITEMS_TO_IMPORT, 400);
      }

      await this.ensureContext(req);

      const branchId = this.model?.branchId || null;
      const licenseId = this.model?.licenseId || null;
      const user = req.user || {};

      const context = {
        branchId,
        licenseId,
        user,
        branchName:
          user.branch?.branch_name ||
          user.branch_name ||
          (user.branch && (user.branch.name || user.branch.store_name)) ||
          '',
        userName: user.name || user.username || user.email || 'System',
        userId: user._id || null,
      };

      const result = await this.service.importItems(rows, context);

      if (result && result.status === true) {
        // For CSV validation errors, repository returns message === 'CSV'
        // and data is an array of problematic rows; keep that shape
        // so PosnicPro.importTableFile can render the table correctly.
        return this.success(res, result.data, result.message || 'success');
      }

      return this.error(
        res,
        result?.message || ERROR_MESSAGES.NO_ITEMS_TO_IMPORT,
        400,
        result?.data || null
      );
    } catch (error) {
      console.error('Error in itemsImport:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getJSONhsncode()
   * Get HSN codes from JSON file
   */
  async getJSONhsncode(req, res) {
    try {
      const result = await this.service.getHsnCodes();

      if (result.status === true) {
        // When file exists, legacy behaviour used an empty message string.
        // When not found, legacy message was "HSN file not found".
        return this.success(res, result.data, result.message || '');
      }

      return this.error(res, result.message, 500);
    } catch (error) {
      console.error('Error in getJSONhsncode:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: delete()
   * Delete items by IDs (bulk delete)
   * Expects: { data: [id1, id2, ...] } in request body
   */
  async delete(req, res) {
    try {
      await this.ensureContext(req);

      const ids = req.body?.data;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return this.error(res, 'Item Id is missing', 400);
      }

      // Check user access for item.delete
      const userAccess = req.user?.access?.item?.delete;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      const licenseId = this.model?.licenseId || req.user?.license || req.user?.license_id || null;

      const branchId = this.model?.branchId || req.user?.branch_id || null;

      const result = await this.service.deleteItems({
        ids,
        licenseId,
        branchId,
        user: req.user,
      });

      if (result && result.status === true) {
        return this.success(res, result.data, 'Item deleted successfully', 200);
      }

      return this.error(res, 'Item Not deleted', 404, result?.data || null);
    } catch (error) {
      console.error('Error in delete:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get receiving items for autocomplete (mirrors PHP getReceivingItemsAjaxList)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  /**
   * All of a supplier's items, or only the low-stock ones (Loyverse study
   * L2) - the receiving screen's autofill. Same row shape as the receiving
   * autocomplete so the client reuses its add-line path unchanged.
   */
  async getItemsBySupplier(req, res) {
    try {
      if (req.user?.access?.receiving?.read === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.setRequestContext(req);
      const result = await this.service.getItemsBySupplier(
        {
          supplierId: req.query.supplier_id,
          lowStockOnly: req.query.low_stock === 'true',
          notificationRange: req.query.notificationrange,
        },
        {
          branchId: this.model?.branchId || null,
          licenseId: this.model?.licenseId || null,
        }
      );
      if (!result.status) {
        return this.error(res, result.message || 'Item Not Found', 400, null);
      }
      return this.success(res, result.data, 'success');
    } catch (error) {
      console.error('Error in getItemsBySupplier:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Reasoned per-item stock adjustment (Loyverse study L2): Inventory count
   * sets, Loss/Damage subtract; every change lands in stocklogs with the
   * reason as its process.
   */
  async stockAdjustment(req, res) {
    try {
      if (req.user?.access?.item?.write === false) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }
      await this.setRequestContext(req);
      const result = await this.service.stockAdjustment(
        {
          reason: req.body.reason,
          mode: req.body.mode,
          note: req.body.note,
          rows: req.body.rows,
        },
        {
          branchId: this.model?.branchId || null,
          licenseId: this.model?.licenseId || null,
          userId: req.user?._id || null,
          userName: req.user?.username || req.user?.email || '',
        }
      );
      if (!result.status) return this.error(res, result.message || 'Adjustment failed', 400);
      return this.success(res, result.data, result.message);
    } catch (error) {
      console.error('Error in stockAdjustment:', error);
      return this.error(res, error.message, 500);
    }
  }

  async getReceivingItemsAjaxList(req, res) {
    try {
      const { query, type } = req.query;

      await this.setRequestContext(req);

      const result = await this.service.getReceivingItemsAjaxList(
        { type, query },
        {
          branchId: this.model?.branchId || null,
          license: this.model?.licenseId || null,
        }
      );

      if (!result.status) {
        return this.error(res, 'Item Not Found', 404, result.data || null);
      }

      // PHP returns: { query: query, suggestions: data }
      const response = {
        query: query,
        suggestions: result.data,
      };

      return res.json(response);
    } catch (error) {
      console.error('Error in getReceivingItemsAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }

  async uploadItemMultiImage(req, res) {
    try {
      const payload = req.body || {};
      const filesArray = Array.isArray(payload.items_image) ? payload.items_image : [];

      if (!filesArray.length) {
        return this.error(res, ERROR_MESSAGES.NO_FILES_UPLOADED, 400);
      }

      const protocol = req.protocol;
      const host = req.get('host');

      const result = await this.service.uploadItemImages(filesArray, {
        protocol,
        host,
      });

      if (!result || result.status !== true) {
        const statusCode = Number.isInteger(result?.code) ? result.code : 400;
        const message = result?.message || ERROR_MESSAGES.UPLOAD_FAILED;
        return this.error(res, message, statusCode, result?.data || null);
      }

      return this.success(res, result.data, result.message || SUCCESS_MESSAGES.IMAGE_UPLOADED);
    } catch (error) {
      console.error('Error in uploadItemMultiImage:', error);
      return this.error(res, ERROR_MESSAGES.UPLOAD_FAILED, 500, error);
    }
  }

  /**
   * PHP: categoryItemsReportTable() - Category items report
   * GET /items/categoryItemsReportTable
   */
  async categoryItemsReportTable(req, res) {
    try {
      await this.ensureContext(req);

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit =
        req.query.limit && parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = req.query.page && parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;

      let starting_date = req.query.starting_date;
      let ending_date = req.query.ending_date;

      // Apply session filtering if user has permission and dates are provided
      if (
        (starting_date && starting_date.trim() !== '') ||
        (ending_date && ending_date.trim() !== '')
      ) {
        const startDate = starting_date ? new Date(starting_date) : null;
        const endDate = ending_date ? new Date(ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        // Update dates with filtered values
        starting_date = filteredDateRange.start_date;
        ending_date = filteredDateRange.end_date;
      } else {
      }

      const params = {
        rawBranches: req.query.branch || req.query['branch[]'] || [],
        starting_date,
        ending_date,
        category_id: req.query.field_input || '',
        limit,
        page,
      };

      const result = await this.service.categoryItemsReportTable(params);

      if (result.status === true) {
        return res.status(200).json({
          type: 'success',
          message: 'Get Successfully',
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: 'Sales Details Not Found',
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in categoryItemsReportTable:', error);
      return this.error(res, error.message || 'Error retrieving category items report', 500);
    }
  }

  /**
   * PHP: supplierItemsReportTable() - Supplier items report
   * GET /items/supplierItemsReportTable
   */
  async supplierItemsReportTable(req, res) {
    try {
      await this.ensureContext(req);

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit =
        req.query.limit && parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = req.query.page && parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;

      let starting_date = req.query.starting_date;
      let ending_date = req.query.ending_date;

      // Apply session filtering if user has permission and dates are provided
      if (
        (starting_date && starting_date.trim() !== '') ||
        (ending_date && ending_date.trim() !== '')
      ) {
        const startDate = starting_date ? new Date(starting_date) : null;
        const endDate = ending_date ? new Date(ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        // Update dates with filtered values
        starting_date = filteredDateRange.start_date;
        ending_date = filteredDateRange.end_date;
      } else {
      }

      const params = {
        rawBranches: req.query.branch || req.query['branch[]'] || [],
        starting_date,
        ending_date,
        supplier_id: req.query.field_input || '',
        limit,
        page,
      };

      const result = await this.service.supplierItemsReportTable(params);

      if (result.status === true) {
        return res.status(200).json({
          type: 'success',
          message: 'Get Successfully',
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: 'Sales Details Not Found',
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in supplierItemsReportTable:', error);
      return this.error(res, error.message || 'Error retrieving supplier items report', 500);
    }
  }

  /**
   * PHP: itemReportTable() - Items report
   * GET /items/itemReportTable
   */
  async itemReportTable(req, res) {
    try {
      await this.ensureContext(req);

      const limit =
        req.query.limit && parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = req.query.page && parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;

      const params = {
        rawBranches: req.query.branch || req.query['branch[]'] || [],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
        limit,
        page,
      };

      const result = await this.service.itemReportTable(params);

      if (result.status === true) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'success',
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: result.message || 'Items not found',
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in itemReportTable:', error);
      return this.error(res, error.message || 'Error retrieving items report', 500);
    }
  }

  /**
   * GET /api/items/search?q=&limit=&page=
   *
   * Find an item by what somebody would actually type: part of its name, its
   * SKU, or a barcode off the packet.
   *
   * The route has existed since the API was written and was bound to a method
   * that did not, so `bindController` substituted a stub answering 501 to every
   * caller. Nothing failed loudly - a 501 is a well-formed response - and the
   * only reason it surfaced is that a smoke test started asking.
   *
   * Deliberately not `itemSearchPage`, despite the name: that one's
   * `filterValue` is a sort mode ('new' | 'low' | 'high'), not a search term,
   * and reusing it would have quietly returned a price-sorted page for any
   * query at all.
   */
  async search(req, res) {
    try {
      await this.ensureContext(req);

      if (req.user?.access?.item?.read === false) {
        return this.sendError(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const term = String(req.query.q ?? req.query.search ?? req.query.term ?? '').trim();
      if (!term) {
        return this.error(res, 'A search term is required', 400);
      }

      const limitParam = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;

      /* service.searchItems(query, context) already existed - this route was
         the only thing missing. Scoped to the branch and licence so a cashier
         is offered stock they can actually sell. */
      const result = await this.service.searchItems(term, {
        branchId: this.model?.branchId || null,
        licenseId: this.model?.licenseId || null,
        limit,
      });

      if (result.status === true) {
        const list = Array.isArray(result.data) ? result.data : [];
        return this.success(res, { total: list.length, per_page: limit, list }, 'Get Successfully');
      }
      return this.error(res, result.message || ERROR_MESSAGES.ITEM_DETAILS_NOT_FOUND, 404);
    } catch (error) {
      console.error('Error in ItemsController.search:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * GET /api/items/getDataChanges?from=
   *
   * The change feed the frontend polls for every module - see
   * `{module}/getDataChanges` in Frontend core/PosnicPro.js. Nine controllers
   * implement it; items did not, so the one module a till polls hardest
   * answered 501.
   */
  async getDataChanges(req, res) {
    try {
      await this.ensureContext(req);
      /* Required here rather than at module scope, matching the rest of this
         file - the class is constructed at import and pulling the model in at
         the top creates a cycle. */
      const BaseModel = require('../models/base.model');
      const from = req.query.from || '';
      const baseModel = new BaseModel('items');
      const result = await baseModel.getAllDataChanges('items', null, from);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      }
      return this.error(res, 'Not valid Input', 200, result.data);
    } catch (error) {
      console.error('Error in ItemsController.getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new ItemsController();
