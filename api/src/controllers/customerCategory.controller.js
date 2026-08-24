// src/controllers/customerCategory.controller.js
const BaseController = require('./base.controller');
const CustomerCategoryModel = require('../models/customer-category.model');
const { validationResult } = require('express-validator');

class CustomerCategoryController extends BaseController {
  constructor() {
    super();
  }

  /**
   * PHP: getAll()
   * Get paginated list of customer categories
   */
  async getAll(req, res) {
    try {
      if (!this.checkPermission('category', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) || 5;
      const pageParam = parseInt(req.query.page);
      const page = pageParam && pageParam > 0 ? pageParam : 1;
      const filters = req.query.filters ? JSON.parse(req.query.filters) : {};

      const options = {
        limit: limit,
        page: page,
        sort: { _id: -1 },
      };

      const model = new CustomerCategoryModel();
      const result = await model.categoryPage(filters, options);

      if (result.status === true) {
        /*
         * this.MongoIDFilter never existed - not here, not on the base - so
         * this line has thrown into the catch and answered 500 on every call
         * since it was written. Found by the phantom-helper sweep, which was
         * itself written because three demo handlers shipped the same way.
         * The ObjectId-to-string job it named is real, so it is done inline:
         * one field, no invented helper to go phantom again.
         */
        result.data.list = (result.data.list || []).map((row) =>
          row && row._id ? { ...row, _id: String(row._id) } : row
        );
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, 'Details Not Found', 404, result.data);
      }
    } catch (error) {
      console.error('Error in getAll:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: add()
   * Create new customer category
   */
  async create(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const readableErrors = errors.array().map((err) => `${err.path}: ${err.msg}`);
        return this.error(res, 'Validation Error', 400, readableErrors);
      }

      if (!this.checkPermission('category', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const { name, description } = req.body;

      const model = new CustomerCategoryModel();
      const response = await model.categoryInsertUpdate({ name, description }, '');

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else if (response.status === 'exist') {
        return this.error(res, response.message, 406, response.data);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in create:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: edit()
   * Update existing customer category
   */
  async update(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const readableErrors = errors.array().map((err) => `${err.path}: ${err.msg}`);
        return this.error(res, 'Validation Error', 400, readableErrors);
      }

      if (!this.checkPermission('category', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const id = req.params.id;
      if (!id) {
        return this.error(res, 'Wrong request', 400);
      }

      const { name, description } = req.body;

      const model = new CustomerCategoryModel();
      const response = await model.categoryInsertUpdate({ name, description }, id);

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else if (response.status === 'exist') {
        return this.error(res, response.message, 406, response.data);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in update:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getOne()
   * Get single customer category by ID
   */
  async getOne(req, res) {
    try {
      const id = req.params.id || req.query.id;
      if (!id) {
        return this.error(res, 'Category Id is mandatory', 400);
      }

      // Check if access control should be applied (default yes)
      const applyAccessControl = req.query.access !== 'no';

      if (applyAccessControl && !this.checkPermission('category', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const model = new CustomerCategoryModel();
      const response = await model.getCustomerCategoryTableRow(id);

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, 'Customer category not found', 404);
      }
    } catch (error) {
      console.error('Error in getOne:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: delete()
   * Delete customer categories
   */
  async delete(req, res) {
    try {
      const ids = req.body.data;
      if (!ids || !Array.isArray(ids)) {
        return this.error(res, 'UID is missing', 400);
      }

      if (!this.checkPermission('category', 'delete', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const model = new CustomerCategoryModel();
      const response = await model.deleteCustomerCategoryCollectionData(ids);

      if (response.status === true) {
        return this.success(res, response.data, 'Customer category deleted successfully');
      } else {
        return this.error(res, 'Customer category Not deleted', 404, response.data);
      }
    } catch (error) {
      console.error('Error in delete:', error);
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

      const model = new CustomerCategoryModel();
      const response = await model.getDataChanges('customercategory', from);

      if (response.status === true) {
        return this.success(res, response.data, 'Changes Retrieved');
      } else {
        return this.error(res, 'Not valid Input', 200, response.data);
      }
    } catch (error) {
      console.error('Error in getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: customercategoryImport()
   * Import customer categories from CSV/Excel
   */
  async importCustomerCategory(req, res) {
    try {
      if (!this.checkPermission('category', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const result = req.body.result;
      if (!result) {
        return this.error(res, 'Import data is missing', 400);
      }

      const model = new CustomerCategoryModel();
      const response = await model.importCustomerCategoryModel(result);

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 200, response.data);
      }
    } catch (error) {
      console.error('Error in importCustomerCategory:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportCustomerCategory()
   * Export customer categories
   */
  async exportCustomerCategory(req, res) {
    try {
      if (!this.checkPermission('category', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const ids = req.body;
      if (!ids || !Array.isArray(ids)) {
        return this.error(res, 'Category IDs are required', 400);
      }

      const model = new CustomerCategoryModel();
      const response = await model.exportCustomerCategoriesOrder(ids);

      if (response.status === true) {
        return this.success(res, response.data, 'customerCategory Exported Successfully');
      } else {
        return this.error(res, 'customerCategory Exported Unsuccessfully', 404, response.data);
      }
    } catch (error) {
      console.error('Error in exportCustomerCategory:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getCustomerCategoryAjaxList()
   * Get customer category list for autocomplete
   */
  async getCustomerCategoryAjaxList(req, res) {
    try {
      const query = req.query.query || '';

      const model = new CustomerCategoryModel();
      const response = await model.getSelectCustomerCategoryAjaxList(query);

      if (response.status === true) {
        const result = {
          query: query,
          suggestions: response.data,
        };
        return res.json(result);
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in getCustomerCategoryAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }
}

module.exports = new CustomerCategoryController();
