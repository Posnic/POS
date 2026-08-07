const BaseModel = require('../models/base.model');
require('mongodb');

/**
 * Base Repository
 * Handles all data access operations for base module and other modules
 */
class BaseRepository {
  constructor() {
    this.baseModel = new BaseModel();
  }

  /**
   * Get BaseModel class (for static access)
   */
  getBaseModel() {
    return BaseModel;
  }

  /**
   * Create new BaseModel instance
   */
  createInstance(collectionName = null) {
    return new BaseModel(collectionName);
  }

  /**
   * Get autocomplete suggestions for a table field
   * @param {string} field - Field name to search
   * @param {string} collectionName - Collection name
   * @param {string} query - Search query
   * @param {Object} context - Branch and license context
   * @returns {Promise<Object>}
   */
  async autoSuggestionTableField(field, collectionName, query, context = {}) {
    try {
      // Set context for license and branch filtering
      if (context.license) {
        BaseModel.license = context.license;
      }
      if (context.branchId) {
        BaseModel.currentBranch = context.branchId;
      }
      if (context.userId) {
        BaseModel.loggedUser = context.userId;
      }

      const result = await this.baseModel.autoSuggestionTableField(field, collectionName, query);

      return result;
    } catch (error) {
      console.error('Error in autoSuggestionTableField repository:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Get autocomplete suggestions for report fields with branch filter
   * @param {string} query - Search query
   * @param {string} field - Field name to search
   * @param {string} collectionName - Collection name
   * @param {Array|string} branchIds - Branch IDs to filter by
   * @param {Object} context - License context
   * @returns {Promise<Object>}
   */
  async autoSuggestionReportTableField(query, field, collectionName, branchIds, context = {}) {
    try {
      // Set context for license filtering
      if (context.license) {
        BaseModel.license = context.license;
      }

      const result = await this.baseModel.autoSuggestionReportTableField(
        query,
        field,
        collectionName,
        branchIds
      );

      return result;
    } catch (error) {
      console.error('Error in autoSuggestionReportTableField repository:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Get default suggestions (name/phone search)
   */
  async getDefaultSuggestion(module, query, context = {}) {
    try {
      if (context.license) BaseModel.license = context.license;
      if (context.branchId) BaseModel.currentBranch = context.branchId;

      const result = await this.baseModel.getDefaultSuggestion(module, query);
      return result;
    } catch (error) {
      console.error('Error in getDefaultSuggestion repository:', error);
      return { status: false, data: [], message: error.message };
    }
  }

  /**
   * Paginated data fetch
   */
  async page(collectionName, limitCheck = {}, filter = {}, options = {}, fields = null) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.page(collectionName, limitCheck, filter, options, fields);
    } catch (error) {
      console.error('Error in page repository:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Check plan limits
   */
  async checkPlan(collection, action, userContext = null) {
    try {
      return await this.baseModel.checkPlan(collection, action, userContext);
    } catch (error) {
      console.error('Error in checkPlan repository:', error);
      return -1;
    }
  }

  /**
   * Get single document by ID
   */
  async getOneRow(id, collectionName, fields = null) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.getOneRow(id, collectionName, fields);
    } catch (error) {
      console.error('Error in getOneRow repository:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Log data changes
   */
  async changeLog(
    module,
    changedBy,
    documentId,
    operation = 'update',
    oldDocument = null,
    newDocument = null
  ) {
    try {
      return await this.baseModel.changeLog(
        module,
        changedBy,
        documentId,
        operation,
        oldDocument,
        newDocument
      );
    } catch (error) {
      console.error('Error in changeLog repository:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Get all data changes for sync
   */
  async getAllDataChanges(collectionName, module, fromId, fields = null) {
    try {
      return await this.baseModel.getAllDataChanges(collectionName, module, fromId, fields);
    } catch (error) {
      console.error('Error in getAllDataChanges repository:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Backup deleted document to recycle bin
   */
  async deletedDocumentBackup(document, params) {
    try {
      return await BaseModel.deletedDocumentBackup(document, params);
    } catch (error) {
      console.error('Error in deletedDocumentBackup repository:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * CRUD: Find one document
   */
  async findOne(collectionName, query, options = {}) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.findOne(query, options);
    } catch (error) {
      console.error('Error in findOne repository:', error);
      throw error;
    }
  }

  /**
   * CRUD: Find multiple documents
   */
  async find(collectionName, query = {}, options = {}) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.find(query, options);
    } catch (error) {
      console.error('Error in find repository:', error);
      throw error;
    }
  }

  /**
   * CRUD: Insert one document
   */
  async insertOne(collectionName, document) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.insertOne(document);
    } catch (error) {
      console.error('Error in insertOne repository:', error);
      throw error;
    }
  }

  /**
   * CRUD: Update one document
   */
  async updateOne(collectionName, filter, update, options = {}) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.updateOne(filter, update, options);
    } catch (error) {
      console.error('Error in updateOne repository:', error);
      throw error;
    }
  }

  /**
   * CRUD: Delete one document
   */
  async deleteOne(collectionName, filter, options = {}) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.deleteOne(filter, options);
    } catch (error) {
      console.error('Error in deleteOne repository:', error);
      throw error;
    }
  }

  /**
   * Count documents
   */
  async countDocuments(collectionName, query = {}) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.countDocuments(query);
    } catch (error) {
      console.error('Error in countDocuments repository:', error);
      throw error;
    }
  }

  /**
   * Aggregate pipeline
   */
  async aggregate(collectionName, pipeline) {
    try {
      const instance = new BaseModel(collectionName);
      return await instance.aggregate(pipeline);
    } catch (error) {
      console.error('Error in aggregate repository:', error);
      throw error;
    }
  }

  /**
   * Transaction wrapper
   */
  async withTransaction(operations) {
    try {
      return await this.baseModel.withTransaction(operations);
    } catch (error) {
      console.error('Error in withTransaction repository:', error);
      throw error;
    }
  }
}

module.exports = new BaseRepository();
