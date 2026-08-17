// src/controllers/registers_controller.js
// Complete 1:1 replica of PHP registers.php controller
const BaseController = require('./base.controller');
const RegisterModel = require('../models/register.model');
const BaseModel = require('../models/base.model');
const RegisterService = require('../services/register.service');
const branchesService = require('../services/branch.service');
const { mongoRegisterDateFilter } = require('../helpers/registers.helper');
const sessionFilterUtil = require('../utils/session-filter.util');
const { getRequestDeviceId } = require('../utils/device-id.util');
const { AuditService, AUDIT_EVENTS } = require('../services/audit.service');

class RegistersController extends BaseController {
  constructor() {
    super();
    this.registerModel = new RegisterModel();
    this.service = new RegisterService(this.registerModel);
  }

  /**
   * Set request context (branch, user, license) for the model
   */
  async setRequestContext(req) {
    if (!this.registerModel) return;

    const user = req.user || {};

    const branchParam =
      req.tenantContext?.branchId ||
      req.body?.branch_id ||
      req.body?.branch ||
      req.query?.branch_id ||
      req.query?.branch ||
      req.headers['x-branch-id'] ||
      req.session?.selectedBranchId ||
      user.branch_id ||
      user.branch?._id ||
      user.default_branch_id ||
      null;

    // Find the matching branch entry from branch_access array
    let branchAccessEntry = null;
    if (Array.isArray(user.branch_access)) {
      if (branchParam) {
        branchAccessEntry = user.branch_access.find(
          (entry) => String(entry.branch_id) === String(branchParam)
        );
      }
      if (!branchAccessEntry) {
        branchAccessEntry = user.branch_access[0];
      }
    }

    const finalBranchParam =
      branchParam || branchAccessEntry?.branch_id || branchAccessEntry?._id || null;

    this.registerModel.branchId = Array.isArray(finalBranchParam)
      ? finalBranchParam[0]
      : finalBranchParam;

    this.registerModel.licenseId =
      req.tenantContext?.licenseId ||
      user.license ||
      user.license_id ||
      req.session?.license ||
      BaseModel.license ||
      this.registerModel.licenseId;

    this.registerModel.user = user;
    let branchName =
      req.tenantContext?.branchName ||
      branchAccessEntry?.branch_name ||
      user.branch_name ||
      user.branch?.branch_name ||
      '';

    // Fetch branch_name from BranchesService if empty
    if (this.registerModel.branchId && !branchName) {
      try {
        const branch = await branchesService.getBranchById(this.registerModel.branchId, {
          lean: true,
          select: 'branch_name',
        });

        if (branch?.branch_name) {
          branchName = branch.branch_name.trim();
        }
      } catch (error) {
        console.error('Error fetching branch name:', error);
      }
    }

    this.registerModel.branchName = branchName;

    // Propagate to BaseModel
    if (this.registerModel.branchId) {
      BaseModel.currentBranch = this.registerModel.branchId;
      BaseModel.currentBranchName = this.registerModel.branchName;
    }
    if (this.registerModel.licenseId) {
      BaseModel.license = this.registerModel.licenseId;
    }
    if (user._id) {
      BaseModel.loggedUser = user._id;
      BaseModel.loggedUserName = user.username || user.firstname || '';
    }
  }

  // PHP: getDataChanges()
  async getDataChanges(req, res) {
    try {
      await this.setRequestContext(req);
      const from = req.query.from || '';
      const result = await this.service.getDataChanges('registers', from);

      if (result.status === true) {
        return this.success(res, result.data, 'Changes Retrieved');
      } else {
        return this.error(res, 'Not valid Input', 200, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: getcashField()
  async getcashField(req, res) {
    try {
      await this.setRequestContext(req);
      const result = await this.service.getcashFieldData();

      if (result.status === true) {
        return this.success(res, result.data, 'Changes Retrieved');
      } else {
        return this.error(res, 'Not valid Input', 200, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.getcashField:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerReportTable()
  async registerReportTable(req, res) {
    try {
      console.log('🔍 Register Report Table - METHOD CALLED!');
      console.log('🔍 Register Report Table - Full Query Params:', req.query);
      console.log('🔍 Register Report Table - User Info:', {
        _id: req.user?._id,
        usertype: req.user?.usertype,
        access: req.user?.access,
      });

      await this.setRequestContext(req);
      if (!this.checkPermission('report', 'read', req.user)) {
        console.log('❌ Register Report Table - Permission Denied');
        return this.error(res, 'Unauthorized', 403);
      }

      console.log('✅ Register Report Table - Permission Granted');

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      let starting_date = req.query.starting_date;
      let ending_date = req.query.ending_date;

      console.log('🔍 Register Report Table - Initial Data:', {
        register_id: req.query.register || [],
        starting_date,
        ending_date,
      });

      // Apply session filtering if user has permission and dates are provided
      if (
        (starting_date && starting_date.trim() !== '') ||
        (ending_date && ending_date.trim() !== '')
      ) {
        console.log('🔍 Register Report Table - Session filter condition MET!');
        console.log('🔍 Register Report Table - Before filter:', {
          starting_date,
          ending_date,
        });

        const startDate = starting_date ? new Date(starting_date) : null;
        const endDate = ending_date ? new Date(ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 Register Report Table - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Register Report Table - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Update dates with filtered values
        starting_date = filteredDateRange.start_date;
        ending_date = filteredDateRange.end_date;

        console.log('🔍 Register Report Table - Final Data After Filter:', {
          register_id: req.query.register || [],
          starting_date,
          ending_date,
        });
      } else {
        console.log('🔍 Register Report Table - No dates provided, skipping session filter');
      }

      const data = {
        register_id: req.query.register || [],
        starting_date,
        ending_date,
      };

      console.log('🔍 Register Report Table - About to call service with filtered data:', data);

      const result = await this.service.registerReportPage(data, options);

      if (result.status === true) {
        let filteredList = this.mongoIDFilter(result.list);
        filteredList = mongoRegisterDateFilter(filteredList);

        return this.success(
          res,
          {
            status: result.status,
            total: result.total,
            current_page: result.current_page,
            total_pages: result.total_pages,
            per_page: result.per_page,
            list: filteredList,
            data: result.data || [],
          },
          'Get Successfully'
        );
      } else {
        return this.error(res, 'Register Not Found', 404, result);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registeropendateFilter()
  async registeropendateFilter(req, res) {
    try {
      await this.setRequestContext(req);
      const data = {
        registername: req.query.register_name,
        registerid: req.query.register_Id,
      };

      const registerCount = req.user?.register?.length || 0;
      if (registerCount <= 0) {
        return this.error(res, 'Unauthorized', 403);
      }

      const result = await this.service.registeropendateFilterPage(data);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registeropendateFilter:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerFindStatus()
  async registerFindStatus(req, res) {
    try {
      await this.setRequestContext(req);
      const data = {
        registername: req.query.register_name,
        registerid: req.query.register_Id,
      };

      const result = await this.service.userFindStatus(data);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerFindStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerAdd()
  async registerAdd(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      const result = await this.service.registeraddInsert(req.body);

      if (result.status === true) {
        // Append-only accountability trail (fail-safe; see registerClose).
        // result.data is the new register id.
        await new AuditService(this.registerModel).record(AUDIT_EVENTS.REGISTER_OPEN, {
          entity: 'cashregister',
          entity_id: result.data,
          device_id: req.body.lock_device_id,
        });
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerAdd:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerUpdate()
  async registerUpdate(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      const result = await this.service.registerUpdateList(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerUpdate:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerInDetail()
  async registerInDetail(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      const result = await this.service.registerInOutDetail(req.body);

      if (result.status === true) {
        // Record the cash movement(s) to the append-only audit_log (fail-safe).
        // One request may carry a pay-in and/or a pay-out; log whichever ran.
        const inAmt = parseFloat(req.body.in_amount) || 0;
        const outAmt = parseFloat(req.body.out_amount) || 0;
        const audit = new AuditService(this.registerModel);
        if (inAmt > 0) {
          await audit.record(AUDIT_EVENTS.CASH_IN, {
            entity: 'cashregister',
            entity_id: req.body.cash_register_id,
            amount: inAmt,
            reason: (req.body.in_description || '').trim() || null,
            device_id: req.body.lock_device_id,
          });
        }
        if (outAmt > 0) {
          await audit.record(AUDIT_EVENTS.CASH_OUT, {
            entity: 'cashregister',
            entity_id: req.body.cash_register_id,
            amount: outAmt,
            reason: (req.body.out_description || '').trim() || null,
            device_id: req.body.lock_device_id,
          });
        }
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 400, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerInDetail:', error);
      return this.error(res, error.message, 500);
    }
  }

  // Delete cash in/out entry
  async deleteCashInOut(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      const result = await this.service.deleteCashInOut(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 400, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.deleteCashInOut:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerClose()
  async registerClose(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      req.body.request_user_role = req.user?.usertype || req.user?.role || '';
      const result = await this.service.registercloseUpdate(req.body);

      if (result.status === true) {
        // Append-only accountability trail. Fail-safe: never throws, so a
        // failed audit write can't break the close (actor/tenant come from the
        // per-request context set by setRequestContext above).
        await new AuditService(this.registerModel).record(AUDIT_EVENTS.REGISTER_CLOSE, {
          entity: 'cashregister',
          entity_id: req.body.cash_register_id,
          device_id: req.body.lock_device_id,
          details: {
            closing_expected: result.data?.closing_expected,
            closing_counted: result.data?.closing_counted,
            over_short: result.data?.over_short,
          },
        });
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerClose:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: cashRegisterOpenManual()
  async cashRegisterOpenManual(req, res) {
    try {
      await this.setRequestContext(req);
      const id = req.query.id;
      const result = await this.service.cashRegisterOpenManualModel(id);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.cashRegisterOpenManual:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: getCashRegister()
  async getCashRegister(req, res) {
    try {
      await this.setRequestContext(req);
      const id = req.query.id;
      const result = await this.service.getCashRegisterModel(id);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.getCashRegister:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerCountedAmount()
  async registerCountedAmount(req, res) {
    try {
      await this.setRequestContext(req);
      const result = await this.service.registerCountedAmount(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerCountedAmount:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerPaymentNote()
  async registerPaymentNote(req, res) {
    try {
      await this.setRequestContext(req);
      const result = await this.service.registerPaymentNoteModel(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerPaymentNote:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerSaleDetails()
  async registerSaleDetails(req, res) {
    try {
      await this.setRequestContext(req);
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const data = {
        id: req.query.id,
      };

      const result = await this.service.registerSaleDetailsPage(data, options);

      if (result.status === true) {
        return this.success(res, result, 'Get Successfully');
      } else {
        return this.error(res, 'Sales Details Not Found', 404, result);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerSaleDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: getRegisterReportDetails()
  async getRegisterReportDetails(req, res) {
    try {
      await this.setRequestContext(req);
      const data = {
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
        register_id: req.query.register,
      };
      // Server-decided visibility (P0 rule): managers see every session on the
      // register, a cashier only their own. Never taken from the client.
      const requesterType = String(req.user?.usertype || req.user?.role || '').toLowerCase();
      data.see_all =
        ['super_admin', 'owner', 'admin', 'manager', 'store_manager'].includes(requesterType) ||
        this.checkPermission('user', 'read', req.user);

      const result = await this.service.getRegisterReportDetailsPage(data);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.getRegisterReportDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: getRegisterReportPdfDetails() - Returns data for PDF generation
  async getRegisterReportPdfDetails(req, res) {
    try {
      await this.setRequestContext(req);
      const data = {
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
        register_id: req.query.register,
      };
      // Server-decided visibility (P0 rule): managers see every session on the
      // register, a cashier only their own. Never taken from the client.
      const requesterType = String(req.user?.usertype || req.user?.role || '').toLowerCase();
      data.see_all =
        ['super_admin', 'owner', 'admin', 'manager', 'store_manager'].includes(requesterType) ||
        this.checkPermission('user', 'read', req.user);

      const result = await this.service.getRegisterReportPdfDetails(data);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      }

      return this.error(res, result.message, 404, result.data);
    } catch (error) {
      console.error('Error in RegistersController.getRegisterReportPdfDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: registerDenomsubmit()
  async registerDenomsubmit(req, res) {
    try {
      await this.setRequestContext(req);
      req.body.lock_device_id = getRequestDeviceId(req);
      const result = await this.service.registerDenomsubmitModel(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, result.statusCode || 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.registerDenomsubmit:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: editCashDenomination()
  async editCashDenomination(req, res) {
    try {
      await this.setRequestContext(req);
      const result = await this.service.editCashDenominationModel(req.query.id);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.editCashDenomination:', error);
      return this.error(res, error.message, 500);
    }
  }

  // PHP: deleteCashDenomination()
  async deleteCashDenomination(req, res) {
    try {
      await this.setRequestContext(req);
      const result = await this.service.deleteCashDenominationModel(req.body);

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in RegistersController.deleteCashDenomination:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new RegistersController();
