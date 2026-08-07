const { searchPattern, isSearchable } = require('../utils/safe-search');
// src/models/customerCategory_model.js
const { ObjectId } = require('mongodb');
const BaseModel = require('./base.model');

class CustomerCategoryModel extends BaseModel {
  static collectionName = 'customer_category';

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: false },
    branch_name: { type: 'String', select: false },
    name: { type: 'String', select: true },
    description: { type: 'String', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by_id: { type: 'ObjectId', select: false },
    created_by: { type: 'String', select: false },
    updated_by_id: { type: 'ObjectId', select: false },
    updated_by: { type: 'String', select: false },
    license: { type: 'ObjectId', select: false },
  };

  static importFields = {
    name: { type: 'String', select: true },
    description: { type: 'String', select: true },
  };

  constructor() {
    super(CustomerCategoryModel.collectionName);
  }

  /**
   * Get select fields for projection
   */
  getSelectFields(fields, includeId = true) {
    const projection = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value.select === true) {
        projection[key] = 1;
      }
    }
    if (!includeId) {
      projection._id = 0;
    }
    return projection;
  }

  /**
   * Insert or update customer category
   */
  async categoryInsertUpdate(data, id = '') {
    try {
      const collection = await this.getCollection();
      const BaseModel = require('./base.model');

      // Validate required context
      if (!BaseModel.currentBranch) {
        return {
          status: false,
          data: null,
          message:
            'Branch information is required. Please ensure you are logged in with a valid branch.',
        };
      }

      if (!BaseModel.license) {
        return {
          status: false,
          data: null,
          message: 'License information is required.',
        };
      }

      // Check if category already exists
      const existingRecord = await collection.findOne({
        license: BaseModel.license,
        branch_id: BaseModel.currentBranch,
        name: data.name,
      });

      if (existingRecord && String(existingRecord._id) !== id) {
        return {
          status: 'exist',
          data: null,
          message: 'This category details already exist in our system',
        };
      }

      const mongoDate = new Date();
      const insertData = {
        branch_id: BaseModel.currentBranch,
        branch_name: BaseModel.currentBranchName,
        created_date: mongoDate,
        created_by: BaseModel.loggedUserName,
        created_by_id: BaseModel.loggedUser,
        license: BaseModel.license,
      };

      const updateData = {
        name: (data.name || '').trim(),
        description: (data.description || '').trim(),
        updated_date: mongoDate,
        updated_by: BaseModel.loggedUserName,
        updated_by_id: BaseModel.loggedUser,
        license: BaseModel.license,
      };

      if (!id) {
        // Insert new customer category
        const categoryData = { ...insertData, ...updateData };
        const result = await collection.insertOne(categoryData);
        const insertedId = result.insertedId;

        await this.changeLog(
          CustomerCategoryModel.collectionName,
          BaseModel.loggedUser,
          insertedId,
          'insert'
        );

        return {
          status: true,
          data: String(insertedId),
          message: 'Customer category added successfully',
        };
      } else {
        // Update existing customer category
        const categoryObjectId = new ObjectId(id);
        const result = await collection.updateOne(
          { _id: categoryObjectId, license: BaseModel.license },
          { $set: updateData }
        );

        await this.changeLog(
          CustomerCategoryModel.collectionName,
          BaseModel.loggedUser,
          categoryObjectId,
          'update'
        );

        return {
          status: true,
          data: { category_update: result.modifiedCount },
          message: 'Customer category updated successfully',
        };
      }
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer category by ID
   */
  async getCustomerCategoryTableRow(id) {
    try {
      const result = await this.getOneRow(
        id,
        CustomerCategoryModel.collectionName,
        this.getSelectFields(CustomerCategoryModel.fields)
      );

      if (result.status === true) {
        return {
          status: true,
          data: result.data,
          message: 'success',
        };
      } else {
        return {
          status: false,
          data: null,
          message: 'error',
        };
      }
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get data changes for synchronization
   */
  async getDataChanges(module, from) {
    return this.getAllDataChanges(
      CustomerCategoryModel.collectionName,
      module,
      from,
      this.getSelectFields(CustomerCategoryModel.fields, true)
    );
  }

  /**
   * Delete customer categories
   */
  async deleteCustomerCategoryCollectionData(ids) {
    try {
      const collection = await this.getCollection();
      const BaseModel = require('./base.model');
      const objectIds = ids.map((id) => new ObjectId(id));

      // Log deletions
      for (const objectId of objectIds) {
        await this.changeLog(
          CustomerCategoryModel.collectionName,
          BaseModel.loggedUser,
          objectId,
          'delete'
        );
      }

      const condition = {
        $and: [{ _id: { $in: objectIds } }, { license: BaseModel.license }],
      };

      // Backup before delete
      const documents = await collection.find(condition).toArray();
      for (const doc of documents) {
        await this.deletedDocumentBackup(CustomerCategoryModel.collectionName, doc);
      }

      const result = await collection.deleteMany(condition);

      return {
        status: true,
        data: result.deletedCount,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Import customer categories from CSV/Excel
   */
  async importCustomerCategoryModel(data) {
    try {
      const collection = await this.getCollection();
      const uniqueValue = [];
      const validationErrors = [];
      const uniqueCSVRecords = {};

      // Filter unique records from input data
      for (const item of data) {
        if (!uniqueValue.some((v) => JSON.stringify(v) === JSON.stringify(item))) {
          uniqueValue.push(item);
        }
      }

      // Filter unique records from CSV data based on 'name'
      for (const item of uniqueValue) {
        const normalizedItem = {
          name: item.name || '',
          description: item.description || '',
        };
        const key = normalizedItem.name;
        if (!uniqueCSVRecords[key]) {
          uniqueCSVRecords[key] = normalizedItem;
        }
      }

      // Validate records for required fields
      const requiredFields = ['name'];
      for (const item of Object.values(uniqueCSVRecords)) {
        const errorFields = [];
        for (const field of requiredFields) {
          if (!item[field] && item[field] !== '0') {
            errorFields.push(field);
          }
        }
        if (errorFields.length > 0) {
          item.status = errorFields.join(', ');
          validationErrors.push(item);
        }
      }

      // Handle validation errors
      if (validationErrors.length > 0) {
        return {
          status: true,
          data: validationErrors,
          message: 'CSV',
        };
      }

      // Check for existing data
      const BaseModel = require('./base.model');
      const alreadyData = [];
      const newData = [];
      for (const item of Object.values(uniqueCSVRecords)) {
        const existingRecord = await collection.findOne({
          branch_id: BaseModel.currentBranch,
          name: item.name,
          license: BaseModel.license,
        });

        if (existingRecord) {
          alreadyData.push({
            name: existingRecord.name,
            description: existingRecord.description || '',
          });
        } else {
          newData.push(item);
        }
      }

      // Check if there is no new data to import
      if (newData.length === 0) {
        return {
          status: false,
          data: alreadyData,
          message: 'Customer category data already imported',
        };
      }

      // Prepare data for insertion
      const mongoDate = new Date();
      const insertDataTemplate = {
        branch_id: BaseModel.currentBranch,
        branch_name: BaseModel.currentBranchName,
        created_date: mongoDate,
        created_by: BaseModel.loggedUserName,
        created_by_id: BaseModel.loggedUser,
        license: BaseModel.license,
      };

      const updateDataTemplate = {
        updated_date: mongoDate,
        updated_by: BaseModel.loggedUserName,
        updated_by_id: BaseModel.loggedUser,
        license: BaseModel.license,
      };

      const documentsToInsert = newData.map((item) => ({
        ...insertDataTemplate,
        name: item.name,
        description: item.description || '',
        ...updateDataTemplate,
      }));

      // Insert new records
      const insertResult = await collection.insertMany(documentsToInsert);
      const insertedIds = Object.values(insertResult.insertedIds);

      // Retrieve and return inserted records
      const cursor = await collection.find(
        { _id: { $in: insertedIds }, license: BaseModel.license },
        { projection: this.getSelectFields(CustomerCategoryModel.importFields) }
      );
      const insertedRecords = await cursor.toArray();

      return {
        status: true,
        data: insertedRecords,
        message: 'Customer category data imported successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer category ajax list for autocomplete
   */
  async getSelectCustomerCategoryAjaxList(query = '') {
    try {
      const collection = await this.getCollection();
      const BaseModel = require('./base.model');
      /*
       * No search term means no restriction, not "match nothing".
       *
       * This is the autocomplete list: opening the dropdown calls it with no
       * query and expects every category back. It used { $regex: '' }, which
       * happens to match everything - so the behaviour was right by accident,
       * through the same empty-pattern default that makes a bad input return
       * the whole collection.
       *
       * Saying it by leaving the clause out is both safe and honest about the
       * intent, and it is why searchPattern has isSearchable beside it rather
       * than one function that has to guess.
       */
      const where = {
        branch_id: BaseModel.currentBranch,
        license: BaseModel.license,
      };
      if (isSearchable(query)) {
        where.name = { $regex: searchPattern(query), $options: 'i' };
      }

      const data = await collection.find(where).sort({ _id: 1 }).toArray();
      const categories = data.map((item) => ({
        id: String(item._id),
        name: item.name,
      }));

      return {
        status: true,
        data: categories,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get paginated customer categories
   */
  async categoryPage(filters = {}, options = {}) {
    try {
      const BaseModel = require('./base.model');

      // Check plan limits like PHP does
      const checkResponse = await this.checkPlan(CustomerCategoryModel.collectionName, 'getAll');
      const limitCheck = { limit: checkResponse };

      // Add branch filter
      filters.branch_id = BaseModel.currentBranch;
      filters = this.assignFilterObjects(filters, CustomerCategoryModel.fields);

      // Pass parameters in correct order: page(collectionName, filter, options, fields)
      const response = await this.page(
        CustomerCategoryModel.collectionName,
        limitCheck,
        filters,
        options,
        this.getSelectFields(CustomerCategoryModel.fields)
      );

      return response;
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export customer categories
   */
  async exportCustomerCategoriesOrder(data) {
    try {
      const collection = await this.getCollection();
      const BaseModel = require('./base.model');
      const objectIds = data.map((id) => new ObjectId(id));

      const cursor = await collection.find(
        { _id: { $in: objectIds }, license: BaseModel.license },
        {
          projection: this.getSelectFields(CustomerCategoryModel.importFields),
          sort: { _id: -1 },
        }
      );
      const result = await cursor.toArray();

      return {
        status: true,
        data: result,
        message: 'Customer Category Data Exported',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = CustomerCategoryModel;
