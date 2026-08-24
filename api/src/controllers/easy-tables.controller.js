const { searchPattern } = require('../utils/safe-search');
// src/controllers/easyTable_controller.js
const BaseController = require('./base.controller');
const { ObjectId } = require('mongodb');

const tenantFields = (req) =>
  req.tenantContext
    ? {
        branch_id: new ObjectId(String(req.tenantContext.branchId)),
        branch_name: req.tenantContext.branchName,
        license: new ObjectId(String(req.tenantContext.licenseId)),
      }
    : {};

/*
 * Which collections this endpoint may read, and which fields it may touch.
 *
 * getTableData takes tableName, where, columns and searchColumns straight from
 * req.body. The tenant scoping is right - tenantFields is spread after `where`
 * so a caller cannot widen it past their own branch and licence - but within a
 * tenant it was "read any collection, any filter, any field". A cashier could
 * ask for the users collection and get password hashes back in the rows, or
 * put a hash field in searchColumns and recover it a character at a time with
 * regular expressions, since $regex accepts a prefix and reports a match.
 *
 * An allowlist rather than a denylist of sensitive names. A denylist has to
 * anticipate every collection anybody adds later; an allowlist fails closed
 * for the ones nobody thought about, which is the correct direction for a
 * generic query endpoint.
 *
 * The list is the business data a table grid would legitimately show. Nothing
 * here holds a credential. Adding to it should be a deliberate decision with
 * that sentence in mind.
 */
const READABLE_TABLES = new Set([
  'items',
  'sales',
  'customers',
  'customer_category',
  'suppliers',
  'categories',
  'branches',
  'expenses',
  'receivings',
  'variants',
  'taxes',
  'units',
  'stock_logs',
  'easytables',
]);

/*
 * Field names that must never be searched or returned, whatever collection
 * they turn up in. Belt and braces beside the allowlist: a business collection
 * that gains a token column later should not quietly become readable.
 */
const FORBIDDEN_FIELD = /pass(word|wd)?|secret|token|apikey|api_key|hash|salt|otp|credential/i;

/*
 * Operators that run code, or read the whole collection to answer.
 *
 * `where` is spread into the filter, so a caller could send
 * { "$where": "sleep(5000)" } and have the server evaluate it - JavaScript
 * executed inside the database, which at best occupies a connection for five
 * seconds per request and at worst is a way to read documents the query was
 * never scoped to. $function and $accumulator are the same class.
 *
 * This rule was written here first and was needed in nine other places: the
 * list endpoints take their filter as a JSON string, which the app-level '$'
 * sanitiser cannot see inside. It now lives in utils/mongo-guard.js and is
 * enforced for every query parameter in app.js, so this file uses the shared
 * one rather than keeping the second copy that would only be fixed here.
 */
const { findCodeOperator } = require('../utils/mongo-guard');

class EasyTableController extends BaseController {
  constructor() {
    super();
  }

  /**
   * Get data for EasyTable
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getTableData(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.forbidden(res, 'You do not have permission to view this table data');
      }

      const {
        tableName,
        columns = '*',
        where = {},
        orderBy = { _id: -1 },
        limit = 10,
        skip = 0,
        search = '',
        searchColumns = [],
      } = req.body;

      if (!tableName) {
        return this.error(res, 'Table name is required', 400);
      }

      /* Fails closed: a collection nobody has declared readable is refused,
         rather than read because nobody remembered to forbid it. */
      if (!READABLE_TABLES.has(String(tableName))) {
        return this.error(res, 'That table cannot be read through this endpoint', 403);
      }

      const codeOperator = findCodeOperator(where);
      if (codeOperator) {
        return this.error(res, `The ${codeOperator} operator is not allowed here`, 403);
      }

      const requestedFields = [
        ...(Array.isArray(searchColumns) ? searchColumns : []),
        ...(Array.isArray(columns) ? columns : []),
      ].map(String);
      const offending = requestedFields.find((f) => FORBIDDEN_FIELD.test(f));
      if (offending) {
        /* Named in the reply on purpose - this is far more likely to be a
           developer using the wrong column than an attack, and a silent empty
           result would waste an afternoon. */
        return this.error(res, `The field "${offending}" cannot be read or searched`, 403);
      }

      // Convert string IDs to ObjectId if needed
      if (where._id) {
        where._id = new ObjectId(where._id);
      }

      // Build query
      const query = { ...where, ...tenantFields(req) };

      // Add search functionality
      if (search && searchColumns.length > 0) {
        query.$or = searchColumns.map((field) => ({
          [field]: { $regex: searchPattern(search), $options: 'i' },
        }));
      }

      // Get total count for pagination
      const total = await req.db.collection(tableName).countDocuments(query);

      // Get data with pagination and sorting
      const data = await req.db
        .collection(tableName)
        .find(query)
        .sort(orderBy)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .toArray();

      // If specific columns are requested, filter the results
      let filteredData = data;
      if (columns !== '*') {
        const columnList = Array.isArray(columns) ? columns : columns.split(',');
        filteredData = data.map((item) => {
          const filteredItem = {};
          columnList.forEach((col) => {
            // Called on Object.prototype rather than on item: a document from Mongo
            // can carry a field literally named hasOwnProperty, and calling the
            // method off the object itself would then invoke the data.
            if (Object.prototype.hasOwnProperty.call(item, col)) {
              filteredItem[col] = item[col];
            }
          });
          return filteredItem;
        });
      }

      this.success(res, {
        data: filteredData,
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
      });
    } catch (error) {
      console.error('Error in getTableData:', error);
      this.error(res, 'Failed to fetch table data', 500);
    }
  }

  /**
   * Insert data into a table
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async insertData(req, res) {
    try {
      if (!this.checkPermission('report', 'create', req.user)) {
        return this.forbidden(res, 'You do not have permission to insert data');
      }

      const { tableName, data } = req.body;

      if (!tableName || !data) {
        return this.error(res, 'Table name and data are required', 400);
      }

      // Add timestamps
      const now = new Date();
      const document = {
        ...data,
        ...tenantFields(req),
        created_at: now,
        updated_at: now,
        created_by: req.user._id,
      };

      const result = await req.db.collection(tableName).insertOne(document);

      if (result.acknowledged) {
        this.success(
          res,
          {
            _id: result.insertedId,
            ...document,
          },
          'Data inserted successfully',
          201
        );
      } else {
        this.error(res, 'Failed to insert data');
      }
    } catch (error) {
      console.error('Error in insertData:', error);
      this.error(res, 'Failed to insert data', 500);
    }
  }

  /**
   * Update data in a table
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateData(req, res) {
    try {
      if (!this.checkPermission('report', 'update', req.user)) {
        return this.forbidden(res, 'You do not have permission to update data');
      }

      const { tableName, id, data } = req.body;

      if (!tableName || !id || !data) {
        return this.error(res, 'Table name, ID, and data are required', 400);
      }

      // Add updated_at timestamp
      const updateDoc = {
        $set: {
          ...data,
          ...tenantFields(req),
          updated_at: new Date(),
          updated_by: req.user._id,
        },
      };

      const result = await req.db
        .collection(tableName)
        .updateOne({ _id: new ObjectId(id), ...tenantFields(req) }, updateDoc);

      if (result.matchedCount === 0) {
        return this.error(res, 'Document not found', 404);
      }

      const updatedDoc = await req.db
        .collection(tableName)
        .findOne({ _id: new ObjectId(id), ...tenantFields(req) });
      this.success(res, updatedDoc, 'Data updated successfully');
    } catch (error) {
      console.error('Error in updateData:', error);
      this.error(res, 'Failed to update data', 500);
    }
  }

  /**
   * Delete data from a table
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteData(req, res) {
    try {
      if (!this.checkPermission('report', 'delete', req.user)) {
        return this.forbidden(res, 'You do not have permission to delete data');
      }

      const { tableName, id } = req.body;

      if (!tableName || !id) {
        return this.error(res, 'Table name and ID are required', 400);
      }

      const result = await req.db.collection(tableName).deleteOne({
        _id: new ObjectId(id),
        ...tenantFields(req),
      });

      if (result.deletedCount === 0) {
        return this.error(res, 'Document not found', 404);
      }

      this.success(res, null, 'Data deleted successfully');
    } catch (error) {
      console.error('Error in deleteData:', error);
      this.error(res, 'Failed to delete data', 500);
    }
  }

  /**
   * Get table schema/columns
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getTableSchema(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.forbidden(res, 'You do not have permission to view table schema');
      }

      const { tableName } = req.query;

      if (!tableName) {
        return this.error(res, 'Table name is required', 400);
      }

      // Get one document to determine schema
      const sampleDoc = await req.db.collection(tableName).findOne(tenantFields(req));

      if (!sampleDoc) {
        return this.success(res, { columns: [] });
      }

      // Extract column names and their types
      const columns = Object.entries(sampleDoc).map(([key, value]) => ({
        name: key,
        type: this.determineType(value),
        required: false, // This would need to be determined from your schema
      }));

      this.success(res, { columns });
    } catch (error) {
      console.error('Error in getTableSchema:', error);
      this.error(res, 'Failed to get table schema', 500);
    }
  }

  /**
   * Helper to determine the type of a value
   * @private
   */
  determineType(value) {
    if (value === null || value === undefined) return 'string';
    if (value instanceof Date) return 'date';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
  }
}

module.exports = new EasyTableController();
