const fs = require('fs').promises;
const path = require('path');
const BaseController = require('./base.controller');
const SettingModel = require('../models/setting.model');
const settingsService = require('../services/setting.service');

console.log('[SETTINGS CONTROLLER] Module loaded - WhatsApp receipt functions available');

// Mirror the legacy PHP behaviour by searching both the new Frontend JSON
// directory and the original API source JSON directory.
// Priority order: local ApiV2 json, Frontend json, PHP api json
const JSON_DIRECTORIES = [
  path.join(__dirname, '..', 'json'),
  path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'static', 'json'),
  path.join(__dirname, '..', '..', '..', 'api', 'src', 'json'),
];

async function readJsonFromDirectories(fileName) {
  let lastError = null;

  for (const baseDir of JSON_DIRECTORIES) {
    const filePath = path.join(baseDir, fileName);
    try {
      await fs.access(filePath);
      const fileContents = await fs.readFile(filePath, 'utf8');
      return { data: JSON.parse(fileContents), filePath };
    } catch (error) {
      lastError = error;
      if (error.code !== 'ENOENT') {
        break;
      }
    }
  }

  const notFoundError = new Error(`JSON file not found: ${fileName}`);
  notFoundError.code = lastError?.code || 'ENOENT';
  notFoundError.cause = lastError;
  throw notFoundError;
}

async function sendJsonResponse(res, fileName) {
  try {
    const { data } = await readJsonFromDirectories(fileName);
    return res.status(200).json({
      type: 'success',
      message: '',
      data,
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        type: 'error',
        message: `File not found: ${fileName}`,
        data: null,
      });
    }

    console.error(`Error loading JSON file ${fileName}:`, error);
    return res.status(500).json({
      type: 'error',
      message: `Failed to load ${fileName}: ${error.message}`,
      data: null,
    });
  }
}

class SettingController extends BaseController {
  constructor() {
    super();

    // Bind methods to ensure correct 'this' context
    this.getJSONCountry = this.getJSONCountry.bind(this);
    this.getJSONCurrency = this.getJSONCurrency.bind(this);
    this.getJSONTimeZone = this.getJSONTimeZone.bind(this);
  }

  createModelWithContext(req) {
    const model = new SettingModel();

    // Extract branchId - PHP uses $_SESSION['PosnicPro']['settings']['_id']
    // In Node.js, user may have branch_access array (primary) or direct branch_id
    let branchId = req.tenantContext?.branchId || null;

    // 1. Try to get from session.selectedBranchId (set by changeBranch endpoint)
    if (!branchId && req.session?.selectedBranchId) {
      branchId = req.session.selectedBranchId;
    }
    // 2. Try to get from session.branch_id (set at login)
    else if (req.session?.branch_id) {
      branchId = req.session.branch_id;
    }
    // 3. Try user.branch_access[0].branch_id (user's first accessible branch)
    else if (req.user?.branch_access && req.user.branch_access.length > 0) {
      branchId = req.user.branch_access[0].branch_id;
    }
    // 4. Fall back to user.branch_id
    else if (req.user?.branch_id) {
      branchId = req.user.branch_id;
    }
    // 5. Fall back to user.branch._id or user.branch
    else if (req.user?.branch?._id) {
      branchId = req.user.branch._id;
    } else if (req.user?.branch) {
      branchId = req.user.branch;
    }

    // Extract licenseId - PHP uses self::$license
    let licenseId =
      req.tenantContext?.licenseId ||
      req.user?.license ||
      req.user?.license_id ||
      req.user?.licenseId ||
      null;

    // If user is not available, try to get license from session
    if (!licenseId && req.session?.license) {
      licenseId = req.session.license;
    }

    model.setContext({
      branchId,
      licenseId,
      user: req.user,
    });
    return model;
  }

  extractBranchIds(req) {
    if (req.tenantContext?.branchId) {
      return [String(req.tenantContext.branchId)];
    }
    const branchCandidates = [
      req.query?.branch,
      req.query?.branch_id,
      req.query?.['branch[]'],
      req.query?.['branch_id[]'],
      req.body?.branch,
      req.body?.branch_id,
      req.body?.['branch[]'],
      req.body?.['branch_id[]'],
      req.user?.branch_id,
      req.user?.branch,
      req.user?.branch?._id,
      req.user?.default_branch_id,
      ...(Array.isArray(req.user?.branch_access)
        ? req.user.branch_access.map(
            (entry) => entry?.branch_id || entry?.branch?._id || entry?._id
          )
        : []),
    ];

    const branchIds = [];
    branchCandidates.forEach((candidate) => {
      if (!candidate) return;
      if (Array.isArray(candidate)) {
        branchIds.push(...candidate.filter((value) => typeof value === 'string' && value.length));
      } else if (typeof candidate === 'string' && candidate.length) {
        branchIds.push(candidate);
      }
    });
    return branchIds;
  }

  async getJSONCountry(req, res) {
    const name = req.query.name || 'countries';
    if (!/^[\w-]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file name',
      });
    }
    return sendJsonResponse(res, `${name}.json`);
  }

  async getJSONState(req, res) {
    try {
      let rawId = typeof req.query.id === 'string' ? req.query.id.trim() : '';

      // Legacy frontend sometimes sends id=undefined/null when local storage
      // is not initialized. Fall back to a sensible default instead of
      // returning an error so the customer form can still work.
      if (!rawId || rawId === 'undefined' || rawId === 'null') {
        rawId = process.env.DEFAULT_COUNTRY_ID || '101'; // 101 = India in countries.json
      }

      let countryId = rawId;

      // If the id is not purely numeric, try to resolve it using
      // countries.json (id, sortname, or value). This mirrors the
      // flexible behaviour of the legacy PHP stack.
      if (!/^\d+$/.test(countryId)) {
        try {
          const { data: countriesData } = await readJsonFromDirectories('countries.json');
          const countries = countriesData?.countries || [];
          const lower = String(countryId).toLowerCase();
          const match = countries.find((c) => {
            const idStr = String(c.id);
            const sort = String(c.sortname || '').toLowerCase();
            const name = String(c.value || '').toLowerCase();
            return idStr === countryId || sort === lower || name === lower;
          });

          if (match && match.id) {
            countryId = String(match.id);
          } else {
            countryId = process.env.DEFAULT_COUNTRY_ID || '101';
          }
        } catch {
          countryId = process.env.DEFAULT_COUNTRY_ID || '101';
        }
      }

      // Load state list for the resolved country id
      const { data: stateArray } = await readJsonFromDirectories(`state_${countryId}.json`);

      // Determine the ISO country code (sortname) for phone input plugin.
      let countrySortName = 'IN'; // safe default
      try {
        const { data: countriesData } = await readJsonFromDirectories('countries.json');
        const countries = countriesData?.countries || [];
        const match = countries.find((c) => String(c.id) === String(countryId));
        if (match?.sortname) {
          countrySortName = String(match.sortname);
        }
      } catch {
        // Ignore and keep default sortname
      }

      return res.status(200).json({
        success: true,
        data: {
          stateJsonArray: Array.isArray(stateArray) ? stateArray : [],
          countrySortName,
        },
      });
    } catch (error) {
      console.error('Error in getJSONState:', error);
      return res.status(500).json({
        success: false,
        type: 'error',
        message: 'Unable to load state list',
        data: null,
      });
    }
  }

  async getJSONCurrency(req, res) {
    return sendJsonResponse(res, 'currency.json');
  }

  async getJSONTimeZone(req, res) {
    return sendJsonResponse(res, 'timezone.json');
  }

  parseNestedQueryParam(query = {}, key) {
    if (!query || typeof query !== 'object') return undefined;
    if (query[key] && typeof query[key] === 'object') {
      return query[key];
    }

    const prefix = `${key}[`;
    const nested = {};
    let found = false;

    for (const [entryKey, value] of Object.entries(query)) {
      if (entryKey.startsWith(prefix) && entryKey.endsWith(']')) {
        const nestedKey = entryKey.slice(prefix.length, -1);
        nested[nestedKey] = value;
        found = true;
      }
    }

    return found ? nested : undefined;
  }

  /**
   * PHP: getDefaultCustomer()
   * Get default customer details by ID
   */
  async getDefaultCustomer(req, res) {
    try {
      const data = req.query?.data || this.parseNestedQueryParam(req.query, 'data') || {};
      const customerId = data.customer || req.query.customer;

      // No early refusal: the model self-heals a missing id from the branch
      // context (finds or creates the branch's Walk-in) and only a truly
      // contextless call fails. The 400 here kept the heal dead code.
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getDefaultCustomer(customerId);

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'get Default Customer Supplier successfully',
          data: result.data,
        });
      }

      return res.status(404).json({
        type: 'error',
        message: result.message || 'get Default Customer Supplier unsuccessfully',
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getDefaultCustomer:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load default customer',
        data: null,
      });
    }
  }

  /**
   * PHP: getDefaultSupplier()
   * Get default supplier details by ID
   */
  async getDefaultSupplier(req, res) {
    try {
      const data = req.query?.data || this.parseNestedQueryParam(req.query, 'data') || {};
      const supplierId = data.supplier || req.query.supplier;

      // Same rule as the customer: heal in the model, never refuse here.
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getDefaultSupplier(supplierId);

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'get Default Customer Supplier successfully',
          data: result.data,
        });
      }

      return res.status(404).json({
        type: 'error',
        message: result.message || 'get Default Customer Supplier unsuccessfully',
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getDefaultSupplier:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load default supplier',
        data: null,
      });
    }
  }

  async getDefaultCustomerSupplier(req, res) {
    try {
      const data = req.query?.data || this.parseNestedQueryParam(req.query, 'data') || {};
      const customerId = data.customer || req.query.customer || req.query.customer_id;
      const supplierId = data.supplier || req.query.supplier || req.query.supplier_id;

      // Both ids heal in the model from the branch context.
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getDefaultCustomerSupplier(customerId, supplierId);

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          message: result.message || 'Default customer/supplier retrieved',
          data: result.data,
        });
      }

      const statusCode = result.message === 'Not found' ? 404 : 400;
      return res.status(statusCode).json({
        type: 'error',
        message: result.message || 'Unable to load default customer/supplier',
        data: null,
      });
    } catch (error) {
      console.error('Error in getDefaultCustomerSupplier:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load default customer/supplier',
        data: null,
      });
    }
  }

  async backupTable(req, res) {
    try {
      const limit =
        Number.isFinite(parseInt(req.query.limit, 10)) && parseInt(req.query.limit, 10) > 0
          ? parseInt(req.query.limit, 10)
          : 5;
      const page =
        Number.isFinite(parseInt(req.query.page, 10)) && parseInt(req.query.page, 10) > 0
          ? parseInt(req.query.page, 10)
          : 1;

      const table = (req.query.table || req.query.module || '').trim();
      if (!table) {
        return res.status(400).json({
          type: 'error',
          message: 'Table parameter is required',
          data: null,
        });
      }

      // Handle branch[] format from query string
      let branchIds = [];
      if (req.query['branch[]']) {
        branchIds = Array.isArray(req.query['branch[]'])
          ? req.query['branch[]']
          : [req.query['branch[]']];
      } else if (req.query.branch) {
        branchIds = Array.isArray(req.query.branch) ? req.query.branch : [req.query.branch];
      } else {
        branchIds = this.extractBranchIds(req);
      }

      const params = {
        table,
        branchIds,
        selectField: req.query.field_select || req.query.selectfield || '',
        inputField: req.query.field_input || req.query.fieldinput || '',
        startingDate: req.query.starting_date || null,
        endingDate: req.query.ending_date || null,
      };

      console.log('🗄️ backupTable - Params:', {
        table: params.table,
        branchIds: params.branchIds,
        selectField: params.selectField,
        inputField: params.inputField,
        startingDate: params.startingDate,
        endingDate: params.endingDate,
        limit,
        page,
      });

      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getBackupTable(params, {
        limit,
        page,
      });

      console.log('🗄️ backupTable - Result:', {
        status: result.status,
        total: result.data?.total,
        listCount: result.data?.list?.length,
      });

      if (!result.status) {
        return res.status(400).json({
          type: 'error',
          message: result.message || 'Unable to load backup records',
          data: null,
        });
      }

      return res.status(200).json({
        type: 'success',
        message: 'Backup records retrieved successfully',
        data: result.data,
      });
    } catch (error) {
      console.error('Error in SettingController.backupTable:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load backup records',
        data: null,
      });
    }
  }

  /**
   * Update general settings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateGeneralSetting(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.updateGeneralSetting(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'General Setting updated', data: result.data });
      }
      return res
        .status(404)
        .json({ type: 'error', message: 'General Setting Not Updated', data: result.data });
    } catch (error) {
      console.error('Error updating general settings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  /*
   * One branch's module switches (M4 branch selector). Any branch of THIS
   * license only - the model's license filter is the wall; a foreign id
   * answers not-found, never data.
   */
  async getBranchModules(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const branchId = req.query.branch_id;
      if (!branchId) {
        return res
          .status(400)
          .json({ type: 'error', message: 'branch_id is required', data: null });
      }
      const result = await settingModel.getBranchModules(branchId);
      if (!result.status) {
        return res.status(404).json({ type: 'error', message: result.message, data: null });
      }
      return res.json({ type: 'success', message: 'success', data: result.data });
    } catch (error) {
      console.error('Error in getBranchModules:', error);
      return res
        .status(500)
        .json({ type: 'error', message: 'Could not read branch modules', data: null });
    }
  }

  async updateCommonSettings(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const data = req.body;

      /*
       * Prefixes: 1-6 characters. The old exactly-3 rule rejected the
       * form's own default ('S'), so every settings save on such shops
       * failed with a 400 and the form reset - toggles never persisted
       * (owner's "I enabled quote and I see reset form").
       */
      if (data.sales_prefix && (data.sales_prefix.length < 1 || data.sales_prefix.length > 6)) {
        return res.status(400).json({
          type: 'error',
          message: 'Data Not Valid: sales_prefix must be 1-6 characters',
          data: null,
        });
      }
      if (
        data.receiving_prefix !== undefined &&
        (String(data.receiving_prefix).length < 1 || String(data.receiving_prefix).length > 6)
      ) {
        return res.status(400).json({
          type: 'error',
          message: 'Data Not Valid: receiving_prefix must be 1-6 characters',
          data: null,
        });
      }
      if (
        data.notification_value === undefined ||
        data.notification_value === null ||
        data.notification_value === ''
      ) {
        return res.status(400).json({
          type: 'error',
          message: 'Data Not Valid: notification_value required',
          data: null,
        });
      }

      const result = await settingsService.updateCommonSettings(data);

      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'Common settings updated', data: result.data });
      }
      return res.status(404).json({
        type: 'error',
        message: result.message || 'Common settings Not Updated',
        data: result.data,
      });
    } catch (error) {
      console.error('Error in updateCommonSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  // PHP: Tax Management Methods
  async addTax(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.addTax(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addTax:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editTax(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.editTax(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editTax:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteTax(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deleteTax(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteTax:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteTaxGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deleteTaxGroup(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteTaxGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Denomination Management Methods
  async addDenomForm(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.addDenomForm(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addDenomForm:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getDenomAll(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.getDenomAll();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getDenomAll:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteDenom(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deleteDenom(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteDenom:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async addDenomData(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const result = await settingsService.addDenomData(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addDenomData:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async restoreBackup(req, res) {
    try {
      // PHP uses $_SESSION['...']['access']['plan']['read'] and denies when it
      // is not strictly true. In Node, many users do not have a `plan` entry
      // at all, so we follow the same permissive rule as getRecycleBin:
      //   - If there is no `plan` ACL -> allow
      //   - If `plan.read` is explicitly false -> deny
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }

      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.restoreBackup(req.body.data);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in restoreBackup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Forgot Password
  async forgotPassword(req, res) {
    try {
      if (!req.body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
        return res.status(400).json({ type: 'error', message: 'Valid email required' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getForgotUserDetails(req.body.email);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in forgotPassword:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Dashboard
  async getDasboardSalesCount(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getDasboardSalesCountModel();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'successfully', data: result.data });
      } else {
        return res
          .status(404)
          .json({ type: 'error', message: 'unsuccessfully', data: result.data });
      }
    } catch (error) {
      console.error('Error in getDasboardSalesCount:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getRecycleBin(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }

      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ type: 'error', message: 'Id is Required' });
      }

      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getSettingTableRow(id);

      if (result.status) {
        return res.status(200).json({ type: 'success', data: result.data });
      }

      return res.status(404).json({ type: 'error', message: 'Backup Details Not found' });
    } catch (error) {
      console.error('Error in getRecycleBin:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Tax and Unit Methods
  async getTaxAll(req, res) {
    try {
      const data = { tax_group: req.query.tax_group };
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getTaxAllModel(data);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getTaxAll:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getUnitAll(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getUnitAllModel();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getUnitAll:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getTaxGroup(req, res) {
    try {
      const data = { tax_id: req.query.tax_id };
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getTaxGroupModel(data);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getTaxGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getTaxAjaxList(req, res) {
    try {
      const query = req.query.query || '';
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getSelectTaxAjaxList(query);
      if (result.status) {
        return res.status(200).json({ query: query, suggestions: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getTaxAjaxList:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getUnitAjaxList(req, res) {
    try {
      const query = req.query.query || '';
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getSelectUnitAjaxList(query);
      if (result.status) {
        return res.status(200).json({ query: query, suggestions: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getUnitAjaxList:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Ajax Lists
  async autoSuggestionRecycleBinTableField(req, res) {
    try {
      const query = req.query.query;
      const field = req.query.field;
      const collection = req.query.module;
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.autoSuggestionRecycleBinTableField(
        field,
        collection,
        query
      );
      if (result.status) {
        return res.status(200).json({ query: query, suggestions: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: 'Not Found', data: result.data });
      }
    } catch (error) {
      console.error('Error in autoSuggestionRecycleBinTableField:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getAllCollectionTotal(req, res) {
    try {
      const userAccess = req.user?.access?.plan?.read;
      if (userAccess !== true) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getAllCollectionTotal();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: 'Error in Data Fetch' });
      }
    } catch (error) {
      console.error('Error in getAllCollectionTotal:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Image Methods
  async storedImageData(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.storedImageModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'Image update successfully', data: result.data });
      } else {
        return res
          .status(404)
          .json({ type: 'error', message: 'Image update unsuccessfully', data: result.data });
      }
    } catch (error) {
      console.error('Error in storedImageData:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async branchImageDelete(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.branchImageDeleteModel(req.body.data);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'Image was deleted', data: result.data });
      } else {
        return res
          .status(404)
          .json({ type: 'error', message: 'There was not deleted', data: result.data });
      }
    } catch (error) {
      console.error('Error in branchImageDelete:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Email Setting
  async emailSetting(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.emailSettingModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in emailSetting:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Kiosk Settings
  async kioskAccountSettings(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      // Mirror permissive ACL behaviour: only block when plan.read is explicitly false.
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.kioskAccountSettingsModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in kioskAccountSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async kioskPrinterSettings(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.kioskPrinterSettingsModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in kioskPrinterSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async kioskPayment(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.kioskPaymentModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in kioskPayment:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async phonepepaymentsKey(req, res) {
    try {
      const planAccess = req.user?.access?.plan;
      if (planAccess && planAccess.read === false) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.phonepePaymentKeyModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in phonepepaymentsKey:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async kioskupdateInfo(req, res) {
    try {
      const kioskKey = req.body.update_key ? req.body.update_key.trim() : null;
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.kioskUpdateInfoModel(kioskKey);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in kioskupdateInfo:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Table Order Methods
  async addTableOrderData(req, res) {
    try {
      if (
        !req.body.tableorder_value ||
        req.body.tableorder_value.length < 1 ||
        req.body.tableorder_value.length > 6
      ) {
        return res.status(400).json({ type: 'error', message: 'Data Not Valid' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.addTableOrderFiledModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addTableOrderData:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  /* The session branch's tax profile (T2) - presentation only. */
  async getTaxProfile(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getTaxProfileModel();
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getTaxProfile:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  /* Price lists (V4) - customer-group pricing; one list per category. */
  async getPriceLists(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getPriceListsModel();
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getPriceLists:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async savePriceList(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.savePriceListModel(req.body || {});
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in savePriceList:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deletePriceList(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.deletePriceListModel(req.params.id || req.query.id);
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in deletePriceList:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  /* Modifier groups (V2) - Restaurant option sets; CRUD mirrors tables. */
  async getModifierGroups(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getModifierGroupsModel();
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in getModifierGroups:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async addModifierGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.addModifierGroupModel(req.body || {});
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in addModifierGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editModifierGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editModifierGroupModel(
        req.params.id || req.body.id,
        req.body || {}
      );
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in editModifierGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteModifierGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.deleteModifierGroupModel(req.params.id || req.query.id);
      const code = result.status ? 200 : 400;
      return res.status(code).json({
        type: result.status ? 'success' : 'error',
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error('Error in deleteModifierGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getTableOrderAll(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getTableOrderAllModel();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getTableOrderAll:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editTableOrderForm(req, res) {
    try {
      if (
        !req.body.tableorder_value ||
        req.body.tableorder_value.length < 1 ||
        req.body.tableorder_value.length > 6
      ) {
        return res.status(400).json({ type: 'error', message: 'Data Not Valid' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editTableOrderFiledModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editTableOrderForm:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteTableOrder(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deleteTableOrder(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteTableOrder:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Theme Settings
  async getThemeSettings(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getThemeSettings();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'Theme settings retrieved', data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: 'No theme settings found' });
      }
    } catch (error) {
      console.error('Error in getThemeSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateThemeSettings(req, res) {
    try {
      if (!req.body.theme_settings || typeof req.body.theme_settings !== 'object') {
        return res.status(400).json({ type: 'error', message: 'Invalid theme settings data' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editThemeSettings(req.body.theme_settings);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: 'Theme settings updated', data: result.data });
      } else {
        return res
          .status(404)
          .json({ type: 'error', message: 'Theme settings not updated', data: result.data });
      }
    } catch (error) {
      console.error('Error in updateThemeSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Unit Management Methods
  async addUnit(req, res) {
    try {
      // Validation matching PHP controller
      if (!req.body.unit_name || req.body.unit_name.length < 1 || req.body.unit_name.length > 20) {
        return res
          .status(400)
          .json({ type: 'error', message: 'Data Not Valid: unit_name required (1-20 chars)' });
      }
      if (
        !req.body.unit_value ||
        req.body.unit_value.length < 1 ||
        req.body.unit_value.length > 6
      ) {
        return res
          .status(400)
          .json({ type: 'error', message: 'Data Not Valid: unit_value required (1-6 chars)' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.addUnitModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addUnit:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editUnit(req, res) {
    try {
      // Validation matching PHP controller
      if (!req.body.unit_name || req.body.unit_name.length < 1 || req.body.unit_name.length > 20) {
        return res
          .status(400)
          .json({ type: 'error', message: 'Data Not Valid: unit_name required (1-20 chars)' });
      }
      if (
        !req.body.unit_value ||
        req.body.unit_value.length < 1 ||
        req.body.unit_value.length > 6
      ) {
        return res
          .status(400)
          .json({ type: 'error', message: 'Data Not Valid: unit_value required (1-6 chars)' });
      }
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editUnitModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editUnit:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteUnit(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deleteUnit(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteUnit:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Tax Group Management Methods
  async addTaxGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.addTaxGroupModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addTaxGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editTaxGroup(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editTaxGroupModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editTaxGroup:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Denomination edit method
  async editDenomForm(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editDenomFiledModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editDenomForm:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Payment Management Methods
  async getPaymentAll(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getPaymentAllModel();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getPaymentAll:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async addPaymentData(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.addPaymentFiledModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in addPaymentData:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async editPaymentForm(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.editPaymentFiledModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in editPaymentForm:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deletePayment(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      settingsService.setModel(settingModel);

      const id = req.query.id || req.params.id;
      const result = await settingsService.deletePayment(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deletePayment:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  // PHP: Additional missing methods
  async updateWay2SmsSetting(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.updateWay2SmsSettingModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateWay2SmsSetting:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateTextLocalSmsSetting(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.updateTextLocalSmsSettingModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateTextLocalSmsSetting:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateBranchLogo(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.updateBranchLogoModel(req.file, req.user?.branch_id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateBranchLogo:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateKioskImages(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.updateKioskImagesModel(req.files, req.user?.branch_id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateKioskImages:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateCustomerSettings(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const id = req.query.id || req.params.id;
      const result = await settingModel.updateCommonCustomerSettings(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateCustomerSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async updateSupplierSettings(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const id = req.query.id || req.params.id;
      const result = await settingModel.updateCommonSupplierSettings(id);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in updateSupplierSettings:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async changePassword(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.changePasswordModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in changePassword:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async salesSmsReceipt(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.salesSmsReceiptModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in salesSmsReceipt:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async saveWhatsAppReceipt(req, res) {
    try {
      console.log('[WHATSAPP RECEIPT] Step 1 - Initial request data:', {
        session_userId: req.session?.userId,
        session_branch_id: req.session?.branch_id,
        session_selectedBranchId: req.session?.selectedBranchId,
        has_user: !!req.user,
      });

      // If user is not loaded, try to load from session
      if (!req.user && req.session?.userId) {
        console.log('[WHATSAPP RECEIPT] Step 2 - Loading user from session:', req.session.userId);
        const User = require('../models/user.model');
        req.user = await User.findById(req.session.userId).lean();
        console.log('[WHATSAPP RECEIPT] Step 3 - User loaded:', {
          user_found: !!req.user,
          user_id: req.user?._id,
          user_license: req.user?.license,
        });
      }

      const settingModel = this.createModelWithContext(req);

      console.log('[WHATSAPP RECEIPT] Step 4 - Model context created:', {
        branchId: settingModel.branchId,
        licenseId: settingModel.licenseId,
      });

      // Verify branch exists before attempting update
      const Branch = require('../models/branch.model');
      const branchExists = await (
        req.tenantContext
          ? Branch.findOne({
              _id: settingModel.branchId,
              license: req.tenantContext.licenseId,
            })
          : Branch.findById(settingModel.branchId)
      ).lean();
      console.log('[WHATSAPP RECEIPT] Step 5 - Branch check:', {
        branchId: settingModel.branchId,
        branchExists: !!branchExists,
        branchName: branchExists?.name,
      });

      const result = await settingModel.saveWhatsAppReceiptModel(req.body);

      console.log('[WHATSAPP RECEIPT] Step 6 - Save result:', {
        status: result.status,
        message: result.message,
      });

      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('[WHATSAPP RECEIPT] Error:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getWhatsAppReceipt(req, res) {
    try {
      // If user is not loaded, try to load from session
      if (!req.user && req.session?.userId) {
        const User = require('../models/user.model');
        req.user = await User.findById(req.session.userId).lean();
      }

      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.getWhatsAppReceiptModel();
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in getWhatsAppReceipt:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async paymentsKey(req, res) {
    try {
      const userAccess = req.user?.access?.plan?.read;
      if (userAccess !== true) {
        return res.status(403).json({ type: 'error', message: 'Unauthorized', data: null });
      }

      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.paymentKeyModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in paymentsKey:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteCollection(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const collection = req.query.collection || req.body.collection;
      const result = await settingModel.deleteCollectionModel(collection);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteCollection:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async deleteAllSelectedCollection(req, res) {
    try {
      const settingModel = this.createModelWithContext(req);
      const result = await settingModel.deleteAllSelectedCollectionModel(req.body);
      if (result.status) {
        return res
          .status(200)
          .json({ type: 'success', message: result.message, data: result.data });
      } else {
        return res.status(404).json({ type: 'error', message: result.message, data: result.data });
      }
    } catch (error) {
      console.error('Error in deleteAllSelectedCollection:', error);
      return res.status(500).json({ type: 'error', message: error.message });
    }
  }

  async getJSONGstState(req, res) {
    return sendJsonResponse(res, 'gst_state_code.json');
  }
}

const settingControllerInstance = new SettingController();

// Ensure every controller method keeps the correct context even if extracted.
const methodNames = Object.getOwnPropertyNames(
  Object.getPrototypeOf(settingControllerInstance)
).filter((name) => name !== 'constructor');

for (const name of methodNames) {
  if (typeof settingControllerInstance[name] === 'function') {
    settingControllerInstance[name] =
      settingControllerInstance[name].bind(settingControllerInstance);
  }
}

module.exports = settingControllerInstance;
