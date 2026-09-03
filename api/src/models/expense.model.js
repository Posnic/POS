const BaseModel = require('./base.model');
const { ObjectId } = require('mongodb');

class ExpenseModel extends BaseModel {
  constructor() {
    super('expenses');
    this.fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      branch_id: { type: 'ObjectId', select: false },
      branch_name: { type: 'String', select: false },
      amount: { type: 'Double', select: true },
      type: { type: 'String', select: true },
      category: { type: 'String', select: true },
      recipientname: { type: 'String', select: true },
      approvedby: { type: 'String', select: true },
      description: { type: 'String', select: true },
      date: { type: 'Date', select: true },
      created_date: { type: 'Date', select: true },
      updated_date: { type: 'Date', select: true },
      created_by_id: { type: 'ObjectId', select: false },
      created_by: { type: 'String', select: false },
      updated_by_id: { type: 'ObjectId', select: false },
      updated_by: { type: 'String', select: false },
      license: { type: 'ObjectId', select: false },
    };
  }

  /**
   * Create or update an expense
   * @param {Object} data - Expense data
   * @param {string} [id] - Expense ID for update (optional for create)
   * @returns {Promise<Object>} - Result of the operation
   */
  async expensesInsertUpdate(data, id = '') {
    try {
      const collection = await this.getCollection();
      const now = new Date();
      // Robust date handling: accept legacy UI date strings and fall back to now
      let expenseDate = now;
      if (data.date) {
        const parsed = new Date(data.date);
        expenseDate = isNaN(parsed.getTime()) ? now : parsed;
      }

      const expenseData = {
        amount: parseFloat(data.amount),
        type: data.type,
        date: expenseDate,
        category: data.category,
        recipientname: data.recipientname,
        approvedby: data.approvedby,
        description: data.description || '',
        updated_date: now,
        updated_by: this.user?.username || 'system',
        updated_by_id: this.user?._id || null,
        license: this.licenseId,
      };

      if (!id) {
        // Convert branch_id to ObjectId if it's a string
        let branchIdToSave = this.branchId;
        if (typeof this.branchId === 'string' && ObjectId.isValid(this.branchId)) {
          branchIdToSave = new ObjectId(this.branchId);
        } else if (
          !(this.branchId instanceof ObjectId) &&
          ObjectId.isValid(String(this.branchId))
        ) {
          branchIdToSave = new ObjectId(String(this.branchId));
        }

        const insertData = {
          ...expenseData,
          branch_id: branchIdToSave,
          branch_name: this.branchName,
          created_date: now,
          created_by: this.user?.username || 'system',
          created_by_id: this.user?._id || null,
        };

        const result = await collection.insertOne(insertData);
        return {
          status: true,
          data: result.insertedId.toString(),
          message: 'Expense added successfully',
        };
      } else {
        // Update existing expense - never modify created_date/created_by fields
        delete expenseData.created_date;
        delete expenseData.created_by;
        delete expenseData.created_by_id;
        const result = await collection.updateOne(
          { _id: new ObjectId(id), license: this.licenseId },
          { $set: expenseData }
        );

        return {
          status: true,
          data: result.modifiedCount,
          message: 'Expense updated successfully',
        };
      }
    } catch (error) {
      console.error('Error in expensesInsertUpdate:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete expense records
   * @param {Array} ids - Array of expense IDs to delete
   * @returns {Promise<Object>} - Result of the operation
   */
  async deleteExpenseCollectionData(ids) {
    try {
      const BaseModel = require('./base.model');
      const collection = await this.getCollection();
      const objectIds = ids.map((id) => new ObjectId(id));

      // Get documents before deletion for backup
      const documents = await collection
        .find({
          _id: { $in: objectIds },
          license: this.licenseId,
        })
        .toArray();

      // Backup each expense to recycle_bin before deletion
      for (const expense of documents) {
        await BaseModel.deletedDocumentBackup('expenses', expense);
      }
      console.log(
        '🗑️ deleteExpenseCollectionData - Backed up',
        documents.length,
        'expenses to recycle_bin'
      );

      // Delete the documents
      const result = await collection.deleteMany({
        _id: { $in: objectIds },
        license: this.licenseId,
      });

      return {
        status: true,
        data: result.deletedCount,
        message: 'Expenses deleted successfully',
      };
    } catch (error) {
      console.error('Error in deleteExpenseCollectionData:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * PHP: importExpensesModel()
   * Import expenses from CSV/Excel dataset.
   */
  async importExpensesModel(data) {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        return { status: false, data: null, message: 'No expenses to import' };
      }

      const collection = await this.getCollection();

      // Step 1: Check the max import limit from the plan
      let maxImport = -1;
      try {
        maxImport = await this.checkPlan(this.collectionName, 'import');
      } catch (e) {
        maxImport = -1;
      }
      const count =
        typeof maxImport === 'number' && maxImport > 0
          ? Math.min(maxImport, data.length)
          : data.length;

      // Step 2: Filter unique records from input data (normalize amount)
      const uniqueMap = new Map();
      for (let i = 0; i < count; i++) {
        const row = { ...data[i] };
        row.amount =
          row.amount !== undefined && row.amount !== null && row.amount !== ''
            ? parseFloat(row.amount)
            : '';
        const key = JSON.stringify(row);
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, row);
        }
      }
      const uniqueValue = Array.from(uniqueMap.values());

      // Step 3: Filter unique records from CSV data based on
      // amount-type-category-recipientname-approvedby-description
      const uniqueCSVRecords = {};
      for (const src of uniqueValue) {
        const item = {
          amount: src.amount ?? '',
          type: src.type ?? '',
          category: src.category ?? '',
          recipientname: src.recipientname ?? '',
          approvedby: src.approvedby ?? '',
          description: src.description ?? '',
        };
        const key = [
          item.amount,
          item.type,
          item.category,
          item.recipientname,
          item.approvedby,
          item.description,
        ].join('-');
        if (!uniqueCSVRecords[key]) {
          uniqueCSVRecords[key] = item;
        }
      }

      // Step 4: Validate CSV data for required fields
      // In practice users often leave description empty, so only
      // enforce amount and type as required here.
      const requiredFields = ['amount', 'type'];
      const validationErrors = [];

      for (const key of Object.keys(uniqueCSVRecords)) {
        const item = uniqueCSVRecords[key];
        const errorFields = [];

        for (const field of requiredFields) {
          const value = item[field];
          if (
            (value === undefined || value === null || value === '') &&
            value !== 0 &&
            value !== '0'
          ) {
            errorFields.push(field);
          }
        }

        if (errorFields.length > 0) {
          validationErrors.push({
            ...item,
            status: errorFields.join(', '),
          });
        }
      }

      // If there are validation errors, return them with message "CSV"
      if (validationErrors.length > 0) {
        return {
          status: true,
          data: validationErrors,
          message: 'CSV',
        };
      }

      // Step 5: Prepare final dataset
      const newData = [];
      for (const key of Object.keys(uniqueCSVRecords)) {
        const item = uniqueCSVRecords[key];
        if (
          item.amount === undefined ||
          item.amount === null ||
          item.amount === '' ||
          item.type === undefined ||
          item.type === null ||
          item.type === ''
        ) {
          continue;
        }
        newData.push(item);
      }

      if (newData.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No valid expenses to import',
        };
      }

      // Step 6: Build documents with branch/license/user context
      const branchId = this.toObjectId(this.branchId) || this.branchId;
      const licenseId = this.toObjectId(this.licenseId) || this.licenseId;

      if (!branchId || !licenseId) {
        return {
          status: false,
          data: null,
          message: 'Branch and license context required',
        };
      }

      const now = new Date();
      const user = this.user || {};
      const userName =
        user.username || user.name || user.email || BaseModel.loggedUserName || 'system';
      const userId = this.toObjectId(user._id) || BaseModel.loggedUser || user._id || null;

      const baseDoc = {
        branch_id: branchId,
        branch_name: this.branchName || BaseModel.currentBranchName || '',
        date: now,
        created_date: now,
        updated_date: now,
        created_by: userName,
        created_by_id: userId,
        updated_by: userName,
        updated_by_id: userId,
        license: licenseId,
      };

      const documents = newData.map((item) => ({
        ...baseDoc,
        amount: parseFloat(item.amount) || 0,
        type: item.type || '',
        category: item.category || '',
        recipientname: item.recipientname || '',
        approvedby: item.approvedby || '',
        description: item.description || '',
      }));

      const result = await collection.insertMany(documents);
      const insertedIds = Object.values(result.insertedIds || {});

      if (insertedIds.length === 0) {
        return {
          status: true,
          data: [],
          message: 'Expense data imported successfully',
        };
      }

      const inserted = await collection.find({ _id: { $in: insertedIds } }).toArray();

      return {
        status: true,
        data: inserted.map((d) => BaseModel.simplifyFields(d)),
        message: 'Expense data imported successfully',
      };
    } catch (error) {
      console.error('Error in importExpensesModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get a single expense by ID
   * @param {string} id - Expense ID
   * @returns {Promise<Object>} - Expense data
   */
  async getExpenseById(id) {
    try {
      const result = await this.getOneRow(
        id,
        this.collectionName,
        this.getSelectFields(this.fields)
      );

      if (result.status === true) {
        return {
          status: true,
          data: result.data,
          message: result.message,
        };
      }

      return {
        status: false,
        data: null,
        message: result.message || 'error',
      };
    } catch (error) {
      console.error('Error in getExpenseById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * PHP: getDataChanges()
   * Get data changes for sync (expenses collection)
   */
  async getDataChanges(module, from) {
    return this.getAllDataChanges(
      this.collectionName,
      module,
      from,
      this.getSelectFields(this.fields, true)
    );
  }

  /**
   * Get paginated list of expenses with filters
   * @param {Object} filters - Filters to apply
   * @param {Object} options - Pagination and sorting options
   * @returns {Promise<Object>} - Paginated list of expenses
   */
  async getExpensesPage(filters = {}, options = {}) {
    try {
      // Check plan limits (PHP line 233)
      const checkResponse = await this.checkPlan(this.collectionName, 'getAll');
      const limitCheck = { limit: checkResponse };

      // Apply default filters and pagination
      const defaultFilters = {};

      // Branch filter: handle both string and ObjectId forms so that
      // records created by legacy PHP (ObjectId), Node create (string),
      // and import (typically ObjectId) are all visible for the
      // currently selected branch.
      const branchVal = this.branchId;
      if (branchVal) {
        // When we have a valid ObjectId string, query for both the raw
        // string and the ObjectId representation.
        if (typeof branchVal === 'string' && ObjectId.isValid(branchVal)) {
          defaultFilters.branch_id = {
            $in: [branchVal, new ObjectId(branchVal)],
          };
        } else if (branchVal instanceof ObjectId) {
          defaultFilters.branch_id = {
            $in: [branchVal, branchVal.toString()],
          };
        } else {
          // Fallback: use whatever value we have
          defaultFilters.branch_id = branchVal;
        }
      }
      const defaultOptions = {
        page: 1,
        limit: 10,
        sort: { _id: -1 }, // Default sort by most recent
      };

      // Convert user-provided filters (e.g. date ranges) to proper types
      // using the field metadata, similar to PHP assignFilterObjects.
      const typedFilters = this.assignFilterObjects(filters, this.fields);

      // Merge provided filters and options with defaults
      const mergedFilters = { ...defaultFilters, ...typedFilters };
      const mergedOptions = { ...defaultOptions, ...options };

      // PHP line 238: parent::page(self::$collectionName, $limitCheck, $filters, $options, $this->getSelectFields($this->fields))
      return await this.page(
        this.collectionName,
        limitCheck,
        mergedFilters,
        mergedOptions,
        this.getSelectFields(this.fields)
      );
    } catch (error) {
      console.error('Error in getExpensesPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get expenses report page data (ported from PHP)
   * PHP: public function expensesReportPage($data, $options = [])
   * @param {Object} data - Filter data including branchid, starting_date, ending_date
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Result of the operation
   */
  async expensesReportPage(data, options = {}) {
    try {
      // Use BaseModel helper methods for date conversion (matches PHP exactly)
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const FromDate = this.startingDate(data.starting_date, timeZone);
      const ToDate = this.endingDate(data.ending_date, timeZone);

      // Convert branch IDs to ObjectIds (matches PHP foreach loop)
      const array_merge = [];
      if (Array.isArray(data.branchid)) {
        data.branchid.forEach((value) => {
          if (value && ObjectId.isValid(value)) {
            array_merge.push(new ObjectId(value));
          }
        });
      }
      // Build filters exactly as PHP does
      // PHP: ['branch_id' => ['$in' => $array_merge]], ['created_date' => [...], 'license' => ...]
      const filters = {
        branch_id: { $in: array_merge },
        created_date: { $gte: new Date(FromDate), $lte: new Date(ToDate) },
      };
      // Check if any records exist with these filters
      const collection = await this.getCollection('expenses');
      const testQuery = { ...filters, license: this.licenseId };
      const testCount = await collection.countDocuments(testQuery);

      // License will be added by BaseModel.page() method automatically

      // Check plan limit (matches PHP checkPlan call)
      const checkResponse = await this.checkPlan('expenses', 'getAll');
      const limitCheck = { limit: checkResponse };

      // Call parent::page() method exactly as PHP does
      // PHP line 453: parent::page(self::$collectionName, $limitCheck, $filters, $options, $this->getSelectFields($this->fields))
      const response = await this.page(
        'expenses',
        limitCheck,
        filters,
        options,
        this.getSelectFields(this.fields)
      );

      // BaseModel.page() returns { status, data: { list, total, ... }, message }
      // We need to flatten it to { status, list, pagination: { total, ... }, message }
      if (response.status && response.data) {
        return {
          status: response.status,
          list: response.data.list || [],
          pagination: {
            total: response.data.total || 0,
            page: response.data.current_page || 1,
            limit: response.data.per_page || 5,
            pages: response.data.total_pages || 1,
          },
          message: response.message,
        };
      }

      return response;
    } catch (error) {
      console.error('Error in expensesReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * PHP: exportExpensesOrder()
   * Export selected expenses by IDs for CSV/Excel (frontend builds CSV).
   */
  async exportExpensesOrder(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No IDs provided',
        };
      }

      const collection = await this.getCollection();

      const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

      if (objectIds.length === 0) {
        return {
          status: true,
          data: [],
          message: 'No matching expenses found',
        };
      }

      const filter = { _id: { $in: objectIds } };

      // Respect license scoping if available (similar to PHP self::$license)
      const licenseId = this.toObjectId(this.licenseId) || BaseModel.license;
      if (licenseId) {
        filter.license = licenseId;
      }

      const expenses = await collection
        .find(filter, {
          projection: {
            _id: 0,
            amount: 1,
            type: 1,
            category: 1,
            recipientname: 1,
            approvedby: 1,
            description: 1,
          },
        })
        .sort({ _id: -1 })
        .toArray();

      return {
        status: true,
        data: expenses.map((e) => {
          const simplified = BaseModel.simplifyFields(e);
          // Remove _id and id fields from export
          delete simplified._id;
          delete simplified.id;
          return simplified;
        }),
        message: 'Expense Data Exported',
      };
    } catch (error) {
      console.error('Error in exportExpensesOrder:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = ExpenseModel;
