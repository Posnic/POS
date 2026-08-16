const RegisterModel = require('../models/register.model');
const BaseModel = require('../models/base.model');
const baseRepository = require('../repositories/base.repository');
const { ObjectId } = require('mongodb');
const { formatRegisterDate } = require('../helpers/registers.helper');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  REGISTER_STATUS,
} = require('../constants/registers.constants');

class RegisterRepository {
  constructor(model) {
    this.model = model || new RegisterModel();
  }

  async validateSessionOwner(registerId, userId, deviceId) {
    if (!registerId || !ObjectId.isValid(registerId)) {
      return { status: false, message: ERROR_MESSAGES.INVALID_REGISTER_ID };
    }
    const collection = await this.model.getCollection('cashregister');
    const document = await collection.findOne({
      _id: new ObjectId(registerId),
      register_status: REGISTER_STATUS.OPENED,
    });
    if (!document) return { status: false, message: ERROR_MESSAGES.REGISTER_NOT_OPENED };

    const ownerId = document.current_user_id ? String(document.current_user_id) : '';
    const requesterId = userId ? String(userId) : '';
    if (ownerId && ownerId !== requesterId) {
      return { status: false, message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED };
    }
    if (document.lock_device_id && document.lock_device_id !== String(deviceId || 'unknown')) {
      return { status: false, message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED };
    }

    if (!document.lock_device_id) {
      await collection.updateOne(
        {
          _id: document._id,
          register_status: REGISTER_STATUS.OPENED,
          lock_device_id: { $exists: false },
        },
        {
          $set: {
            current_user_id: userId,
            lock_device_id: String(deviceId || 'unknown'),
            lock_acquired_at: new Date(),
          },
        }
      );
    }
    return { status: true, data: document };
  }

  async getDataChanges(moduleName, from) {
    try {
      const collectionName = this.model.collectionName || 'cashregister';
      const fields = BaseModel.getSelectFields(this.model.fields || {}, true);

      return await baseRepository.getAllDataChanges(collectionName, moduleName, from, fields);
    } catch (error) {
      console.error('Error in RegisterRepository.getDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getcashFieldData() {
    try {
      // Mirror PHP RegisterModel::getcashFieldData
      // Uses denomination collection filtered by current branch and license
      const denomModel = new BaseModel('denomination');
      const collection = await denomModel.getCollection('denomination');

      const andFilters = [];

      if (BaseModel.currentBranch) {
        andFilters.push({ branch_id: String(BaseModel.currentBranch) });
      }

      if (BaseModel.license) {
        andFilters.push({ license: BaseModel.license });
      }

      const filters = andFilters.length ? { $and: andFilters } : {};

      const pipeline = [];

      // Keep $unwind stage for parity with legacy aggregate pipeline
      pipeline.push({ $unwind: '$cash_fields' });
      if (Object.keys(filters).length > 0) {
        pipeline.push({ $match: filters });
      }

      const denomList = await collection.aggregate(pipeline).toArray();

      const denomData = [];

      denomList.forEach((document) => {
        const rawId = document._id;
        const cashFieldValue =
          document.cash_field ?? (document.cash_fields && document.cash_fields.field_value);

        if (cashFieldValue === undefined || cashFieldValue === null) {
          return;
        }

        const cashfiled_id =
          typeof rawId === 'string' ? rawId : rawId?.toString?.() || String(rawId);

        denomData.push({
          cashfield: cashFieldValue,
          cashfiled_id,
        });
      });

      return {
        status: true,
        data: denomData,
        message: 'denomination data get successfully',
      };
    } catch (error) {
      console.error('Error in RegisterRepository.getcashFieldData:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registerReportPage(data = {}, options = {}) {
    try {
      const baseModel = new BaseModel('registers');

      const fromDate = baseModel.startingDate(
        data.starting_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );
      const toDate = baseModel.endingDate(
        data.ending_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );

      const filters = [];

      console.log('registerReportPage - Input data:', data);

      // Add register ID filter if provided (using register_id field)
      if (data.register_id && ObjectId.isValid(data.register_id)) {
        filters.push({ register_id: new ObjectId(data.register_id) });
        console.log('Added register_id filter:', data.register_id);
      }

      // Add date filter
      const dateFilter = {
        $or: [
          {
            register_opendate: {
              $gte: new Date(fromDate),
              $lte: new Date(toDate),
            },
          },
          {
            register_closedate: {
              $gte: new Date(fromDate),
              $lte: new Date(toDate),
            },
          },
        ],
      };
      filters.push(dateFilter);
      console.log('Date range:', { fromDate, toDate });

      // Add license filter only (don't filter by branch - show all branches)
      if (BaseModel.license) {
        const licenseId = ObjectId.isValid(BaseModel.license)
          ? new ObjectId(BaseModel.license)
          : BaseModel.license;
        filters.push({ license: licenseId });
        console.log('Added license filter:', licenseId);
      }

      console.log('Final filters:', filters);

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const collection = await baseModel.getCollection('cashregister');

      // First, let's check what registers exist without filters
      const allRegisters = await collection.find({}).toArray();

      // Get total count with filters
      const totalCount = await collection.countDocuments({
        $and: filters,
      });
      console.log('Total count with filters:', totalCount);

      // Get register data
      const registers = await collection
        .find({ $and: filters })
        .sort({ register_opendate: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      console.log('Found registers:', registers.length);
      if (registers.length > 0) {
        console.log('First register:', registers[0]);
      }

      const list = registers.map((register) => {
        // Calculate register_amount from register_sales dynamically
        let calculatedRegisterAmount = 0;

        if (register.register_sales && Array.isArray(register.register_sales)) {
          register.register_sales.forEach((sale, index) => {
            // Only use register_amount (it already includes returns)
            const saleAmount = parseFloat(sale.register_amount || 0);

            calculatedRegisterAmount += saleAmount;
          });
        }

        // Add opening float to the calculated amount
        calculatedRegisterAmount += parseFloat(register.opening_float || 0);

        // Add cash in amounts
        calculatedRegisterAmount += parseFloat(register.cashin_amount || 0);

        // Subtract cash out amounts
        calculatedRegisterAmount -= parseFloat(register.cashout_amount || 0);

        // Format dates
        const openDate = register.register_opendate
          ? new Date(register.register_opendate)
              .toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })
              .replace(/\//g, '/') +
            ' ' +
            new Date(register.register_opendate)
              .toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })
              .toLowerCase()
              .replace(' ', ' ')
          : '';

        const closeDate = register.register_closedate
          ? new Date(register.register_closedate)
              .toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })
              .replace(/\//g, '/') +
            ' ' +
            new Date(register.register_closedate)
              .toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })
              .toLowerCase()
              .replace(' ', ' ')
          : '';

        return {
          open_date: openDate,
          close_date: closeDate,
          id: register._id?.toString() || '',
          register_name: register.register_name || '',
          register_opendate: register.register_opendate
            ? {
                $date: {
                  $numberLong: register.register_opendate.getTime().toString(),
                },
              }
            : null,
          register_closedate: register.register_closedate
            ? {
                $date: {
                  $numberLong: register.register_closedate.getTime().toString(),
                },
              }
            : null,
          opening_float: register.opening_float || 0,
          register_status: register.register_status || '',
          cashin_amount: register.cashin_amount || 0,
          cashout_amount: register.cashout_amount || 0,
          // Use dynamically calculated register_amount
          register_amount: parseFloat(calculatedRegisterAmount.toFixed(2)),
          countedAmount: register.countedAmount || [],
        };
      });

      // Calculate payment data from register sales
      const paymentData = [];
      if (registers.length > 0) {
        // Aggregate payment data from all registers
        const paymentTotals = {};

        registers.forEach((register) => {
          if (register.register_sales && Array.isArray(register.register_sales)) {
            register.register_sales.forEach((sale) => {
              const paymentMode = sale.payment_mode || 'Cash';
              if (!paymentTotals[paymentMode]) {
                paymentTotals[paymentMode] = {
                  sale_total: 0,
                  return_total: 0,
                  count: 0,
                };
              }
              paymentTotals[paymentMode].sale_total += sale.grand_total || 0;
              paymentTotals[paymentMode].return_total += sale.return_total || 0;
              paymentTotals[paymentMode].count += 1;
            });
          }
        });

        // Convert to array format
        Object.keys(paymentTotals).forEach((mode) => {
          paymentData.push({
            payment_mode: mode,
            sale_total: parseFloat(paymentTotals[mode].sale_total.toFixed(2)),
            return_total: parseFloat(paymentTotals[mode].return_total.toFixed(2)),
            count: paymentTotals[mode].count,
          });
        });
      }

      // If no payment data, provide default
      if (paymentData.length === 0 && list.length > 0) {
        paymentData.push({
          payment_mode: 'Cash',
          sale_total: 0,
          return_total: 0,
          count: 0,
        });
      }

      return {
        status: true,
        total: totalCount,
        current_page: page,
        total_pages: limit ? Math.ceil(totalCount / limit) : 0,
        per_page: limit,
        list,
        data: paymentData,
      };
    } catch (error) {
      console.error('Error in registerReportPage:', error);
      return {
        status: false,
        list: [],
        message: error.message || ERROR_MESSAGES.FAILED_FETCH_REGISTER_REPORT,
      };
    }
  }

  async registeropendateFilterPage(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      if (!data.registerid || !ObjectId.isValid(data.registerid)) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.INVALID_REGISTER_ID,
        };
      }

      // Build match filter with register_id, branch and license context
      const matchFilter = {
        register_id: new ObjectId(data.registerid),
      };

      // Branch context
      let branchIdToMatch = this.model.branchId || BaseModel.currentBranch;
      if (typeof branchIdToMatch === 'string' && ObjectId.isValid(branchIdToMatch)) {
        branchIdToMatch = new ObjectId(branchIdToMatch);
      }
      if (branchIdToMatch) {
        matchFilter.branch_id = branchIdToMatch;
      }

      // License context
      let licenseToMatch = this.model.licenseId || BaseModel.license;
      if (typeof licenseToMatch === 'string' && ObjectId.isValid(licenseToMatch)) {
        licenseToMatch = new ObjectId(licenseToMatch);
      }
      if (licenseToMatch) {
        matchFilter.license = licenseToMatch;
      }

      const pipeline = [
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            startingDate: { $min: '$register_opendate' },
            endingDate: { $max: '$register_closedate' },
            register_name: { $first: '$register_name' },
            branch_name: { $first: '$branch_name' },
          },
        },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      if (!results.length) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.REGISTER_NOT_FOUND,
        };
      }

      const agg = results[0];
      const startingDate = agg.startingDate || null;
      const endingDate = agg.endingDate || null;

      const responseData = {
        starting_date: startingDate ? formatRegisterDate(startingDate) : null,
        ending_date: endingDate ? formatRegisterDate(endingDate) : null,
        register_name: agg.register_name || data.registername || '',
        branch_name: agg.branch_name || '',
      };

      return {
        status: true,
        data: responseData,
        message: SUCCESS_MESSAGES.CHANGES_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in registeropendateFilterPage:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async userFindStatus(data) {
    try {
      const userCollection = await this.model.getCollection('users');

      const userObjectId = BaseModel.loggedUser;
      const registerId = new ObjectId(data.registerid);

      const filters = {
        $and: [
          { 'registers.register_id': registerId },
          {
            _id: userObjectId,
            license: BaseModel.license,
          },
        ],
      };

      const cursor = userCollection.aggregate([
        { $unwind: '$registers' },
        { $match: filters },
        {
          $group: {
            _id: {
              register_id: '$registers.register_id',
              register_name: '$registers.register_name',
              register_status: '$registers.register_status',
              current_registerId: '$registers.current_registerId',
            },
          },
        },
      ]);

      const user_data = [];
      let currentRegisterId = null;
      let index = 0;

      for await (const document of cursor) {
        user_data[index] = {
          register_id: String(document._id.register_id),
          register_name: document._id.register_name,
          register_status: document._id.register_status,
          current_registerId: document._id.current_registerId,
        };
        currentRegisterId = document._id.current_registerId;
        index += 1;
      }

      const userData = {
        register_data: user_data,
      };

      if (currentRegisterId) {
        await userCollection.updateOne(
          {
            _id: userObjectId,
            'registers.register_id': registerId,
            license: BaseModel.license,
          },
          {
            $set: {
              updated_registerId: currentRegisterId,
            },
          }
        );
      }

      return {
        status: true,
        data: userData,
        message: '',
      };
    } catch (error) {
      console.error('Error in userFindStatus:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registeraddInsert(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      let branchIdToSave = this.model.branchId || BaseModel.currentBranch;
      if (typeof branchIdToSave === 'string' && ObjectId.isValid(branchIdToSave))
        branchIdToSave = new ObjectId(branchIdToSave);
      let licenseToSave = this.model.licenseId || BaseModel.license;
      if (typeof licenseToSave === 'string' && ObjectId.isValid(licenseToSave))
        licenseToSave = new ObjectId(licenseToSave);
      let currentUserIdToSave = this.model.user?._id || BaseModel.loggedUser || null;
      if (typeof currentUserIdToSave === 'string' && ObjectId.isValid(currentUserIdToSave))
        currentUserIdToSave = new ObjectId(currentUserIdToSave);
      const registerId = new ObjectId(data.register_Id);
      const deviceId = String(data.lock_device_id || 'unknown');

      if (typeof collection.createIndex === 'function') {
        try {
          await collection.createIndex(
            { register_id: 1, branch_id: 1, license: 1 },
            {
              unique: true,
              partialFilterExpression: { register_status: REGISTER_STATUS.OPENED },
              name: 'one_open_session_per_register',
            }
          );
        } catch (indexError) {
          if (indexError?.code !== 11000) throw indexError;
          console.error(
            'Existing duplicate open register sessions must be closed:',
            indexError.message
          );
        }
      }

      // Check if register is already opened
      const document = await collection.findOne({
        register_id: registerId,
        branch_id: branchIdToSave,
        license: licenseToSave,
        register_status: REGISTER_STATUS.OPENED,
      });

      if (document) {
        const ownerId = document.current_user_id ? String(document.current_user_id) : '';
        const requesterId = currentUserIdToSave ? String(currentUserIdToSave) : '';
        const ownerDevice = document.lock_device_id || '';
        if (ownerId && (ownerId !== requesterId || (ownerDevice && ownerDevice !== deviceId))) {
          return {
            status: false,
            statusCode: 409,
            data: { register_id: String(document._id), current_user: document.current_user || '' },
            message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
          };
        }

        // Adopt legacy open sessions once; subsequent devices cannot take over.
        await collection.updateOne(
          { _id: document._id, register_status: REGISTER_STATUS.OPENED },
          {
            $set: {
              current_user_id: currentUserIdToSave,
              lock_device_id: deviceId,
              lock_acquired_at: document.lock_acquired_at || new Date(),
            },
          }
        );

        return {
          status: true,
          data: String(document._id),
          message: SUCCESS_MESSAGES.REGISTER_OPENED,
        };
      }

      const registerCollectionData = {
        register_name: (data.register_name || '').trim(),
        register_id: registerId,
        date: new Date(),
        branch_id: branchIdToSave,
        branch_name: this.model.branchName || BaseModel.currentBranchName || '',
        opening_float: parseFloat(data.opening_float) || 0,
        register_status: REGISTER_STATUS.OPENED,
        register_opendate: new Date(),
        register_closedate: '',
        register_sales: [],
        payment_note: '',
        countedAmount: [],
        current_user: this.model.user?.username || this.model.user?.firstname || 'system',
        current_user_id: currentUserIdToSave,
        lock_device_id: deviceId,
        lock_acquired_at: new Date(),
        license: licenseToSave,
      };

      const insertResult = await collection.insertOne(registerCollectionData);

      return {
        status: true,
        data: String(insertResult.insertedId),
        message: SUCCESS_MESSAGES.REGISTER_OPENED,
      };
    } catch (error) {
      console.error('Error in registeraddInsert:', error);
      if (error?.code === 11000) {
        return {
          status: false,
          statusCode: 409,
          data: '',
          message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
        };
      }
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registerUpdateList(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      if (!data.cash_register_id || !ObjectId.isValid(data.cash_register_id)) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.INVALID_REGISTER_ID,
        };
      }

      const updateFields = {};

      if (typeof data.register_name === 'string') {
        updateFields.register_name = data.register_name.trim();
      }

      if (data.opening_float !== undefined) {
        const opening = parseFloat(data.opening_float);
        if (!Number.isNaN(opening)) {
          updateFields.opening_float = opening;
        }
      }

      if (data.payment_note !== undefined) {
        updateFields.payment_note = (data.payment_note || '').toString();
      }

      if (Object.keys(updateFields).length === 0) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.NOT_VALID_INPUT,
        };
      }

      const filter = {
        _id: new ObjectId(data.cash_register_id),
        register_status: REGISTER_STATUS.OPENED,
        current_user_id: this.model.user?._id || BaseModel.loggedUser,
        lock_device_id: String(data.lock_device_id || 'unknown'),
      };

      // Branch context
      let branchIdToMatch = this.model.branchId || BaseModel.currentBranch;
      if (typeof branchIdToMatch === 'string' && ObjectId.isValid(branchIdToMatch)) {
        branchIdToMatch = new ObjectId(branchIdToMatch);
      }
      if (branchIdToMatch) {
        filter.branch_id = branchIdToMatch;
      }

      // License context
      let licenseToMatch = this.model.licenseId || BaseModel.license;
      if (typeof licenseToMatch === 'string' && ObjectId.isValid(licenseToMatch)) {
        licenseToMatch = new ObjectId(licenseToMatch);
      }
      if (licenseToMatch) {
        filter.license = licenseToMatch;
      }

      const result = await collection.updateOne(filter, {
        $set: updateFields,
      });

      if (result.matchedCount === 0) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.REGISTER_NOT_FOUND,
        };
      }

      return {
        status: true,
        data: updateFields,
        message: SUCCESS_MESSAGES.CHANGES_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in registerUpdateList:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registerInOutDetail(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      const cashInOutCollectionData = {
        cashin_amount: parseFloat(data.in_amount) || 0.0,
        cashout_amount: parseFloat(data.out_amount) || 0.0,
        cashin_description: (data.in_description || '').trim(),
        cashout_description: (data.out_description || '').trim(),
      };

      const filter = {
        _id: new ObjectId(data.cash_register_id),
        register_status: REGISTER_STATUS.OPENED,
        current_user_id: this.model.user?._id || BaseModel.loggedUser,
        lock_device_id: String(data.lock_device_id || 'unknown'),
      };

      // Only add branch_id and license if they exist
      if (this.model.branchId || BaseModel.currentBranch) {
        filter.branch_id = new ObjectId(this.model.branchId || BaseModel.currentBranch);
      }
      if (this.model.licenseId || BaseModel.license) {
        filter.license = new ObjectId(this.model.licenseId || BaseModel.license);
      }

      const result = await collection.updateOne(filter, {
        $push: {
          cashInOutDetail: cashInOutCollectionData,
        },
      });

      if (!result.matchedCount) {
        return {
          status: false,
          statusCode: 409,
          data: '',
          message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
        };
      }

      return {
        status: true,
        data: cashInOutCollectionData,
        message: SUCCESS_MESSAGES.REGISTER_CASHDETAIL_UPDATED,
      };
    } catch (error) {
      console.error('Error in registerInOutDetail:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async deleteCashInOut(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      const filter = {
        _id: new ObjectId(data.register_id),
        register_status: REGISTER_STATUS.OPENED,
        current_user_id: this.model.user?._id || BaseModel.loggedUser,
        lock_device_id: String(data.lock_device_id || 'unknown'),
      };

      // Use $unset to remove the specific array element by index
      const result = await collection.updateOne(filter, {
        $unset: {
          [`cashInOutDetail.${data.index}`]: 1,
        },
      });

      if (!result.matchedCount) {
        return {
          status: false,
          statusCode: 409,
          data: '',
          message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
        };
      }

      // Pull null values to compact the array
      await collection.updateOne(filter, {
        $pull: {
          cashInOutDetail: null,
        },
      });

      return {
        status: true,
        data: {},
        message: SUCCESS_MESSAGES.REGISTER_CASH_ENTRY_DELETED,
      };
    } catch (error) {
      console.error('Error in deleteCashInOut:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registercloseUpdate(data) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const mongoDate = new Date();
      const cashRegisterRowId = new ObjectId(data.cash_register_id);

      // Convert branch_id to ObjectId if it's a string
      let branchIdToMatch = this.model.branchId || BaseModel.currentBranch;
      if (typeof branchIdToMatch === 'string' && ObjectId.isValid(branchIdToMatch)) {
        branchIdToMatch = new ObjectId(branchIdToMatch);
      }

      // Convert license to ObjectId if it's a string
      let licenseToMatch = this.model.licenseId || BaseModel.license;
      if (typeof licenseToMatch === 'string' && ObjectId.isValid(licenseToMatch)) {
        licenseToMatch = new ObjectId(licenseToMatch);
      }

      const registerCollectionData = {
        register_status: REGISTER_STATUS.CLOSED,
        register_closedate: mongoDate,
      };

      let currentUserId = this.model.user?._id || BaseModel.loggedUser || null;
      if (typeof currentUserId === 'string' && ObjectId.isValid(currentUserId))
        currentUserId = new ObjectId(currentUserId);
      const role = String(
        data.request_user_role || this.model.user?.usertype || this.model.user?.role || ''
      ).toLowerCase();
      const managerOverride = ['manager', 'admin', 'super_admin'].includes(role);

      const updateResult = await collection.updateOne(
        {
          _id: cashRegisterRowId,
          branch_id: branchIdToMatch,
          license: licenseToMatch,
          register_status: REGISTER_STATUS.OPENED,
          ...(managerOverride
            ? {}
            : {
                current_user_id: currentUserId,
                lock_device_id: String(data.lock_device_id || 'unknown'),
              }),
        },
        { $set: registerCollectionData }
      );

      if (!updateResult.matchedCount) {
        return {
          status: false,
          statusCode: 409,
          data: '',
          message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
        };
      }

      return {
        status: true,
        data: registerCollectionData,
        message: SUCCESS_MESSAGES.REGISTER_CLOSED,
      };
    } catch (error) {
      console.error('Error in registercloseUpdate:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async cashRegisterOpenManualModel(id) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const fields = this.model.getSelectFields(this.model.fields);
      const document = await collection.findOne(
        {
          register_id: new ObjectId(id),
        },
        {
          projection: fields,
          sort: { date: -1 },
        }
      );

      if (!document) {
        throw new Error(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
      }

      // Check if register is opened - if closed, frontend should show register selection
      if (document.register_status !== REGISTER_STATUS.OPENED) {
        throw new Error(ERROR_MESSAGES.REGISTER_NOT_OPENED);
      }

      // Calculate payment tally dynamically for all payment methods
      const paymentTally = {};

      if (document.register_sales && Array.isArray(document.register_sales)) {
        for (const regSale of document.register_sales) {
          let hasMultiPayment = false;

          if (regSale.multi_payment) {
            let multiPayment = regSale.multi_payment;

            // Parse if string
            if (typeof multiPayment === 'string') {
              try {
                multiPayment = JSON.parse(multiPayment);
              } catch (e) {
                multiPayment = {};
              }
            }

            // Check if multi_payment has any keys (not empty object)
            if (
              typeof multiPayment === 'object' &&
              multiPayment !== null &&
              Object.keys(multiPayment).length > 0
            ) {
              hasMultiPayment = true;
              for (const [method, amount] of Object.entries(multiPayment)) {
                const amt = parseFloat(amount) || 0;
                if (amt > 0) {
                  const methodKey = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
                  paymentTally[methodKey] = (paymentTally[methodKey] || 0) + amt;
                }
              }
            }
          }

          // Use single payment mode if no multi_payment
          if (!hasMultiPayment) {
            const paymentMode = regSale.register_paymentmode || '';
            const amount = parseFloat(regSale.register_amount) || 0;

            if (amount > 0 && paymentMode) {
              let methodKey =
                paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();
              if (methodKey === 'Creditcard') {
                methodKey = 'Card';
              }
              paymentTally[methodKey] = (paymentTally[methodKey] || 0) + amount;
            }
          }
        }
      }

      // Add cash in/out to Cash expected (PHP lines 246-260)
      let cashInAmount = 0;
      let cashOutAmount = 0;
      if (document.cashInOutDetail && Array.isArray(document.cashInOutDetail)) {
        for (const cashInOut of document.cashInOutDetail) {
          cashInAmount += parseFloat(cashInOut.cashin_amount) || 0;
          cashOutAmount += parseFloat(cashInOut.cashout_amount) || 0;
        }
      }

      const openingFloat = parseFloat(document.opening_float) || 0;
      if (paymentTally['Cash']) {
        paymentTally['Cash'] = openingFloat + paymentTally['Cash'] + cashInAmount - cashOutAmount;
      } else if (openingFloat > 0 || cashInAmount > 0 || cashOutAmount > 0) {
        paymentTally['Cash'] = openingFloat + cashInAmount - cashOutAmount;
      }

      // Round all values
      for (const method in paymentTally) {
        paymentTally[method] = Math.round(paymentTally[method] * 100) / 100;
      }

      const simplifiedDoc = BaseModel.simplifyFields(document);
      simplifiedDoc.paymentTally = paymentTally;

      // Add register_id to response for frontend use
      simplifiedDoc.register_id = id;

      return {
        status: true,
        data: simplifiedDoc,
        message: SUCCESS_MESSAGES.REGISTER_FETCHED,
      };
    } catch (error) {
      console.error('Error in cashRegisterOpenManualModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getCashRegisterModel(id) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const fields = this.model.getSelectFields(this.model.fields);

      const document = await collection.findOne({ _id: new ObjectId(id) }, { projection: fields });

      if (!document) {
        throw new Error(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
      }

      return {
        status: true,
        data: BaseModel.simplifyFields(document),
        message: SUCCESS_MESSAGES.REGISTER_FETCHED,
      };
    } catch (error) {
      console.error('Error in getCashRegisterModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async registerCountedAmount(data) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const registerRowId = new ObjectId(data.register_row_Id);

      // Check if payment type already exists in countedAmount array
      const existingRecord = await collection.findOne({
        _id: registerRowId,
        'countedAmount.paymenttype': data.payment_Type,
      });

      if (existingRecord) {
        // Update existing payment type
        await collection.updateOne(
          {
            _id: registerRowId,
            'countedAmount.paymenttype': data.payment_Type,
          },
          { $set: { 'countedAmount.$.value': parseFloat(data.countedAmount) } }
        );
      } else {
        // Add new payment type to countedAmount array
        await collection.updateOne(
          { _id: registerRowId },
          {
            $push: {
              countedAmount: {
                paymenttype: data.payment_Type,
                value: parseFloat(data.countedAmount),
              },
            },
          }
        );
      }

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.AMOUNT_UPDATED,
      };
    } catch (error) {
      console.error('Error in registerCountedAmount:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registerPaymentNoteModel(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      await collection.updateOne(
        { _id: new ObjectId(data.id) },
        { $set: { payment_note: data.note } }
      );

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.PAYMENT_NOTE_UPDATED,
      };
    } catch (error) {
      console.error('Error in registerPaymentNoteModel:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async registerSaleDetailsPage(data, options) {
    try {
      if (!data.id || !ObjectId.isValid(data.id)) {
        return {
          status: false,
          list: [],
          message: ERROR_MESSAGES.INVALID_REGISTER_ID,
        };
      }

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const collection = await this.model.getCollection('cashregister');

      // Find the register by ID
      const register = await collection.findOne({
        _id: new ObjectId(data.id),
      });

      if (!register) {
        return {
          status: false,
          list: [],
          message: ERROR_MESSAGES.REGISTER_NOT_FOUND,
        };
      }

      // Format register details
      const openDate = register.register_opendate
        ? new Date(register.register_opendate)
            .toLocaleDateString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
            .replace(/\//g, '/') +
          ' ' +
          new Date(register.register_opendate)
            .toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
            .toLowerCase()
        : '';

      const closeDate = register.register_closedate
        ? new Date(register.register_closedate)
            .toLocaleDateString('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
            .replace(/\//g, '/') +
          ' ' +
          new Date(register.register_closedate)
            .toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
            .toLowerCase()
        : '';

      const details = {
        current_user: register.current_user || '',
        register_name: register.register_name || '',
        branch_name: register.branch_name || '',
        register_status: register.register_status || '',
        register_opendate: openDate,
        register_closedate: closeDate,
      };

      // Get sales from register_sales array
      const sales = register.register_sales || [];
      const totalCount = sales.length;

      // Apply pagination
      const paginatedSales = sales.slice(skip, skip + limit);

      // Build a lookup map of sale ObjectId -> human-readable sales_id
      // using the main sales collection so we can show friendly IDs in
      // register reports instead of raw ObjectId strings.
      const saleIdMap = new Map();
      try {
        const rawSaleIds = paginatedSales.map((sale) => sale.sales_id).filter((id) => !!id);

        const uniqueObjectIds = [];
        const seen = new Set();

        rawSaleIds.forEach((id) => {
          let key = null;
          if (typeof id === 'string') {
            if (!ObjectId.isValid(id)) {
              return;
            }
            key = id;
          } else if (id && typeof id === 'object' && id.toString) {
            key = id.toString();
          }

          if (key && !seen.has(key)) {
            seen.add(key);
            uniqueObjectIds.push(new ObjectId(key));
          }
        });

        if (uniqueObjectIds.length > 0) {
          const salesModel = new BaseModel('sales');
          const salesCollection = await salesModel.getCollection('sales');
          const salesDocs = await salesCollection
            .find(
              { _id: { $in: uniqueObjectIds } },
              { projection: { _id: 1, sales_id: 1, invoice_number: 1 } }
            )
            .toArray();

          salesDocs.forEach((doc) => {
            const key = doc._id.toString();
            const humanId =
              (doc.sales_id && doc.sales_id.toString()) ||
              (doc.invoice_number && doc.invoice_number.toString()) ||
              key;
            saleIdMap.set(key, humanId);
          });
        }
      } catch (mapError) {
        console.error('Error building saleIdMap in registerSaleDetailsPage:', mapError);
      }

      // Format sales data
      const list = paginatedSales.map((sale) => {
        const saleDate = sale.date
          ? new Date(sale.date)
              .toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })
              .replace(/\//g, '/') +
            ' ' +
            new Date(sale.date)
              .toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              })
              .toLowerCase()
          : '';

        // Prefer human-readable sale number stored on the
        // register_sales entry; fall back to lookup from the
        // sales collection, and finally the raw ObjectId.
        let displaySaleId = '';
        if (typeof sale.sale_no === 'string' && sale.sale_no.trim()) {
          displaySaleId = sale.sale_no.trim();
        } else if (sale.sales_id) {
          let key = null;
          if (typeof sale.sales_id === 'string') {
            key = sale.sales_id;
          } else if (sale.sales_id && typeof sale.sales_id === 'object' && sale.sales_id.toString) {
            key = sale.sales_id.toString();
          }

          if (key) {
            displaySaleId = saleIdMap.get(key) || key;
          }
        }

        return {
          sale_id: displaySaleId,
          date: saleDate,
          register_paymentmode: sale.register_paymentmode || '',
          register_amount: parseFloat(sale.register_amount || 0),
          register_return_total: parseFloat(sale.registerItems_return_total || 0),
        };
      });

      // Calculate payment tally - DYNAMIC for all payment types
      const expectedAmounts = {};
      const countedAmounts = {};

      const normalizePaymentMethod = (method) => {
        const normalized = method.toLowerCase().trim();
        if (normalized === 'creditcard' || normalized === 'credit card') return 'card';
        return normalized;
      };

      // Expected amounts from sales
      if (register.register_sales && Array.isArray(register.register_sales)) {
        register.register_sales.forEach((sale, idx) => {
          let hasMultiPayment = false;

          if (sale.multi_payment) {
            let multiPayment = sale.multi_payment;

            if (typeof multiPayment === 'string') {
              try {
                multiPayment = JSON.parse(multiPayment);
              } catch (e) {
                multiPayment = {};
              }
            }

            if (
              typeof multiPayment === 'object' &&
              multiPayment !== null &&
              Object.keys(multiPayment).length > 0
            ) {
              hasMultiPayment = true;

              for (const [method, amount] of Object.entries(multiPayment)) {
                const amt = parseFloat(amount) || 0;
                const methodNormalized = normalizePaymentMethod(method);
                if (amt > 0) {
                  expectedAmounts[methodNormalized] =
                    (expectedAmounts[methodNormalized] || 0) + amt;
                }
              }
            }
          }

          if (!hasMultiPayment) {
            const paymentMode = sale.register_paymentmode || '';
            const amount = parseFloat(sale.register_amount || 0);
            const methodNormalized = normalizePaymentMethod(paymentMode);

            if (amount > 0 && methodNormalized) {
              expectedAmounts[methodNormalized] = (expectedAmounts[methodNormalized] || 0) + amount;
            }
          }
        });
      }

      // Counted amounts from countedAmount array
      if (register.countedAmount && Array.isArray(register.countedAmount)) {
        register.countedAmount.forEach((counted) => {
          const paymentType = counted.paymenttype || '';
          const value = parseFloat(counted.value || 0);
          const methodNormalized = normalizePaymentMethod(paymentType);
          if (value > 0 && methodNormalized) {
            countedAmounts[methodNormalized] = (countedAmounts[methodNormalized] || 0) + value;
          }
        });
      }

      const paymentTally = {};
      const allPaymentMethods = new Set([
        ...Object.keys(expectedAmounts),
        ...Object.keys(countedAmounts),
      ]);

      allPaymentMethods.forEach((method) => {
        const expected = expectedAmounts[method] || 0;
        const counted = countedAmounts[method] || 0;

        if (expected > 0 || counted > 0) {
          paymentTally[`${method}-expected-amount`] = parseFloat(expected.toFixed(2));
          paymentTally[`${method}-counted-amount`] = parseFloat(counted.toFixed(2));
          paymentTally[`${method}-difference-amount`] = parseFloat((expected - counted).toFixed(2));
        }
      });

      return {
        status: true,
        total: totalCount,
        current_page: page,
        total_pages: limit ? Math.ceil(totalCount / limit) : 0,
        per_page: limit,
        details,
        list,
        paymentTally,
      };
    } catch (error) {
      console.error('Error in registerSaleDetailsPage:', error);
      return {
        status: false,
        list: [],
        message: error.message || ERROR_MESSAGES.FAILED_FETCH_REGISTER_SALE_DETAILS,
      };
    }
  }

  async getRegisterReportDetailsPage(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      const fromDate = BaseModel.startingDate(
        data.starting_date,
        this.model.timeZone || 'Asia/Kolkata'
      );
      const toDate = BaseModel.endingDate(data.ending_date, this.model.timeZone || 'Asia/Kolkata');

      const filters = {
        $and: [
          { register_opendate: { $gte: new Date(fromDate) } },
          { register_closedate: { $lte: new Date(toDate) } },
          { register_id: new ObjectId(data.register_id) },
          {
            current_user_id: this.model.loggedUserId || BaseModel.loggedUser,
          },
          { license: this.model.licenseId || BaseModel.license },
        ],
      };

      // Sales aggregation
      const salesList = await collection
        .aggregate([
          { $unwind: '$register_sales' },
          { $match: filters },
          {
            $group: {
              _id: {
                register_id: '$register_sales.register_id',
                register_paymentmode: '$register_sales.register_paymentmode',
              },
              register_amount: {
                $sum: '$register_sales.register_amount',
              },
              register_return_total: {
                $sum: '$register_sales.registerItems_return_total',
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { register_amount: 1 } },
        ])
        .toArray();

      const tableData = salesList.map((doc) => ({
        payment_mode: doc._id.register_paymentmode,
        sale_total: doc.register_amount,
        return_total: doc.register_return_total,
        count: doc.count,
      }));

      // Cash in/out aggregation
      const cashList = await collection
        .aggregate([
          { $unwind: '$cashInOutDetail' },
          { $match: filters },
          {
            $group: {
              _id: { register_id: '$register_id' },
              cashin_amount: {
                $sum: '$cashInOutDetail.cashin_amount',
              },
              cashout_amount: {
                $sum: '$cashInOutDetail.cashout_amount',
              },
            },
          },
          { $sort: { cashin_amount: 1 } },
        ])
        .toArray();

      const cashData = cashList.map((doc) => ({
        cashin_amount: doc.cashin_amount,
        cashout_amount: doc.cashout_amount,
      }));

      // Common details aggregation
      const commonList = await collection
        .aggregate([
          { $match: filters },
          // Counted cash lives in the countedAmount[] array ({paymenttype, value}),
          // not a top-level `counted_amount` field. Total it per register first
          // (the old `$sum: '$counted_amount'` always resolved to 0), then sum
          // across the matched registers.
          { $addFields: { _counted_total: { $sum: '$countedAmount.value' } } },
          {
            $group: {
              _id: {
                register_id: '$register_id',
                register_name: '$register_name',
                branch_name: '$branch_name',
                current_user: '$current_user',
              },
              counted_amount: { $sum: '$_counted_total' },
              opening_float: { $sum: '$opening_float' },
              mindate: { $first: '$register_opendate' },
              maxdate: { $last: '$register_closedate' },
            },
          },
        ])
        .toArray();

      let commonData = {};
      if (commonList.length > 0) {
        const aggData = commonList[0];
        commonData = {
          opening_float: aggData.opening_float,
          starting_date: formatRegisterDate(aggData.mindate),
          close_date: formatRegisterDate(aggData.maxdate),
          branch_name: aggData._id.branch_name,
          register_name: aggData._id.register_name,
          counted_amount: aggData.counted_amount,
        };
      }

      const responseValue = {
        common_details: commonData,
        cash_details: cashData,
        sale_details: tableData,
      };

      return {
        status: true,
        data: responseValue,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getRegisterReportDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async registerDenomsubmitModel(data) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const registerId = new ObjectId(data.register_id);

      // Remove existing denomination for this register
      const pullResult = await collection.updateOne(
        {
          _id: registerId,
          register_status: REGISTER_STATUS.OPENED,
          current_user_id: this.model.user?._id || BaseModel.loggedUser,
          lock_device_id: String(data.lock_device_id || 'unknown'),
        },
        {
          $pull: {
            cashDenomDetail: {
              remove_id: registerId,
            },
          },
        }
      );

      // Convert denomination_values array to object with numeric keys
      // Each denomination should be wrapped in an array for frontend compatibility
      const denomObject = {};
      if (Array.isArray(data.denomination_values)) {
        data.denomination_values.forEach((item, index) => {
          denomObject[index] = [item];
        });
      }

      // Add new denomination data
      const pushData = {
        remove_id: registerId,
        ...denomObject,
      };

      const pushResult = await collection.updateOne(
        {
          _id: registerId,
          register_status: REGISTER_STATUS.OPENED,
          current_user_id: this.model.user?._id || BaseModel.loggedUser,
          lock_device_id: String(data.lock_device_id || 'unknown'),
        },
        {
          $push: {
            cashDenomDetail: pushData,
          },
        }
      );

      if (!pullResult.matchedCount || !pushResult.matchedCount) {
        return {
          status: false,
          statusCode: 409,
          data: '',
          message: ERROR_MESSAGES.REGISTER_SESSION_LOCKED,
        };
      }

      // Get the updated denomination data
      const filters = {
        _id: registerId,
      };

      const denomList = await collection
        .aggregate([{ $match: filters }, { $unwind: '$cashDenomDetail' }])
        .toArray();

      let denomData = {};
      if (denomList.length > 0) {
        denomData = {
          cashfield: denomList[0].cashDenomDetail,
        };
      }

      return {
        status: true,
        data: denomData,
        message: 'Cash added successfully',
      };
    } catch (error) {
      console.error('Error in registerDenomsubmitModel:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async editCashDenominationModel(id) {
    try {
      const collection = await this.model.getCollection('cashregister');

      const registerId = new ObjectId(id);

      const filters = {
        _id: registerId,
      };

      const denomList = await collection
        .aggregate([{ $match: filters }, { $unwind: '$cashDenomDetail' }])
        .toArray();

      let denomData = {};

      if (denomList.length > 0) {
        denomData = {
          cashfield: denomList[0].cashDenomDetail,
        };
      }

      return {
        status: true,
        data: denomData,
        message: 'denomination data get successfully',
      };
    } catch (error) {
      console.error('Error in RegisterRepository.editCashDenominationModel:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async deleteCashDenominationModel(data) {
    try {
      const collection = await this.model.getCollection('cashregister');

      const rawId = data?.register_id || data?.id;

      if (!rawId || !ObjectId.isValid(rawId)) {
        return {
          status: false,
          data: '',
          message: ERROR_MESSAGES.INVALID_REGISTER_ID,
        };
      }

      const registerId = new ObjectId(rawId);

      // Build filter with branch and license context (mirror PHP model)
      const filter = {
        _id: registerId,
      };

      // Branch context
      let branchIdToMatch = this.model.branchId || BaseModel.currentBranch;
      if (typeof branchIdToMatch === 'string' && ObjectId.isValid(branchIdToMatch)) {
        branchIdToMatch = new ObjectId(branchIdToMatch);
      }
      if (branchIdToMatch) {
        filter.branch_id = branchIdToMatch;
      }

      // License context
      let licenseToMatch = this.model.licenseId || BaseModel.license;
      if (typeof licenseToMatch === 'string' && ObjectId.isValid(licenseToMatch)) {
        licenseToMatch = new ObjectId(licenseToMatch);
      }
      if (licenseToMatch) {
        filter.license = licenseToMatch;
      }

      await collection.updateOne(filter, {
        $pull: {
          cashDenomDetail: {
            remove_id: registerId,
          },
        },
      });

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.DELETE_SUCCESS,
      };
    } catch (error) {
      console.error('Error in RegisterRepository.deleteCashDenominationModel:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  async addSaleRegisterEntry({ registerId, licenseId, registerData }) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const _id = new ObjectId(registerId);

      await collection.updateOne(
        { _id, license: licenseId },
        { $push: { register_sales: registerData } }
      );

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.CHANGES_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in RegisterRepository.addSaleRegisterEntry:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async updateSaleRegisterEntry({ saleId, licenseId, registerData }) {
    try {
      const collection = await this.model.getCollection('cashregister');
      const saleObjectId = new ObjectId(saleId);

      await collection.updateOne(
        { 'register_sales.sale_id': saleObjectId, license: licenseId },
        {
          $set: {
            'register_sales.$.sales_id': saleObjectId,
            'register_sales.$.date': registerData.date,
            'register_sales.$.register_amount': registerData.register_amount,
            'register_sales.$.register_discount': registerData.register_discount,
            'register_sales.$.register_tax': registerData.register_tax,
            'register_sales.$.register_paymentmode': registerData.register_paymentmode,
            'register_sales.$.multi_payment': registerData.multi_payment || [],
          },
        }
      );

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.CHANGES_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in RegisterRepository.updateSaleRegisterEntry:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = RegisterRepository;
