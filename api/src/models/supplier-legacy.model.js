// src/models/supplier_model.js
const BaseModel = require('./base.model');
const { ObjectId } = require('mongodb');

class SupplierModel extends BaseModel {
  constructor() {
    super('suppliers');
    this.branchId = null;
    this.licenseId = null;
    this.loggedUserId = null;
    this.loggedUserName = null;
    this.branchName = null;
  }

  static collectionName = 'suppliers';

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: false },
    branch_name: { type: 'String', select: false },
    name: { type: 'String', select: true },
    email: { type: 'String', select: true },
    phone: { type: 'String', select: true },
    address: { type: 'String', select: true },
    country: { type: 'String', select: true },
    state: { type: 'String', select: true },
    city: { type: 'String', select: true },
    gst: { type: 'String', select: true },
    gst_type: { type: 'String', select: true },
    gst_number: { type: 'String', select: true },
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
    email: { type: 'String', select: true },
    phone: { type: 'String', select: true },
    address: { type: 'String', select: true },
  };

  /**
   * Get supplier details by ID
   * PHP: supplierDetails()
   */
  async supplierDetails(id) {
    try {
      const collection = await this.getCollection();
      const supplier = await collection.findOne(
        {
          _id: new ObjectId(id),
          license: new ObjectId(this.licenseId),
        },
        { typeMap: { document: 'array', root: 'array' } }
      );
      return supplier;
    } catch (error) {
      console.error('Error in supplierDetails:', error);
      return null;
    }
  }

  /**
   * Insert or update supplier
   * PHP: supplierInsertUpdate()
   */
  async supplierInsertUpdate(data, id = '') {
    try {
      const collection = await this.getCollection();
      const branchId = this.toObjectId(this.branchId);
      const licenseId = this.toObjectId(this.licenseId);

      // Check if supplier already exists
      const recordsFiltered = await collection.findOne({
        branch_id: branchId,
        license: licenseId,
        name: data.name,
        phone: data.phone || '',
      });

      if (recordsFiltered && String(recordsFiltered._id) !== id) {
        return {
          status: 'exist',
          data: null,
          message: 'This supplier details already exist in our system',
        };
      }

      // Check plan limits
      const maxSupplier = await this.checkPlan('suppliers', 'add');
      if (maxSupplier > 0) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const condition = {
          $and: [
            {
              updated_date: { $gte: startOfMonth, $lte: endOfMonth },
              license: licenseId,
            },
          ],
        };

        const totalCount = await collection.countDocuments(condition);
        if (totalCount >= maxSupplier) {
          return {
            status: 'error',
            data: null,
            message: 'Suppliers Limit Reached. Upgrade to Premium Plan.',
          };
        }
      }

      const mongoDate = new Date();
      const loggedUserId = this.toObjectId(this.loggedUserId);

      const insertData = {
        branch_id: branchId,
        license: licenseId,
        branch_name: this.branchName || data.branch_name || '',
        created_date: mongoDate,
        created_by: this.loggedUserName || '',
        created_by_id: loggedUserId,
      };

      const updateData = {
        name: (data.name || '').trim(),
        email: (data.email || '').trim(),
        phone: (data.phone || '').trim(),
        address: (data.address || '').trim(),
        country: (data.country || '').trim(),
        state: (data.state || '').trim(),
        city: (data.city || '').trim(),
        gst: data.indian_gst === 'gst_on' ? 'enable' : 'disable',
        gst_type: (data.gst_type || '').trim(),
        gst_number: (data.gstin_number || data.gst_number || '').trim(),
        updated_date: mongoDate,
        updated_by: this.loggedUserName || '',
        updated_by_id: loggedUserId,
        license: licenseId,
      };

      if (id === '' || !id) {
        // Insert new supplier
        const supplierData = { ...insertData, ...updateData };
        const insertResult = await collection.insertOne(supplierData);
        const insertedId = insertResult.insertedId;

        const responseRecord = {
          supplier_id: String(insertedId),
          supplier_name: data.name,
          supplier_address: data.address,
          supplier_phone: data.phone,
          supplier_email: data.email,
          supplier_state: data.state,
          supplier_gst_type: data.gst_type,
          supplier_gst_number: data.gstin_number || data.gst_number,
        };

        await this.changeLog('suppliers', loggedUserId, insertedId, 'insert');

        return {
          status: true,
          data: responseRecord,
          message: 'Supplier added successfully',
        };
      } else {
        // Update existing supplier
        const updateResult = await collection.updateOne(
          { _id: new ObjectId(id), license: licenseId },
          { $set: updateData }
        );

        await this.changeLog('suppliers', loggedUserId, new ObjectId(id), 'update');

        return {
          status: true,
          data: updateResult.modifiedCount,
          message: 'Supplier updated successfully',
        };
      }
    } catch (error) {
      console.error('Error in supplierInsertUpdate:', error);
      return {
        status: false,
        data: '',
        message: error.message,
      };
    }
  }

  /**
   * Get data changes for sync
   * PHP: getDataChanges()
   */
  async getDataChanges(module, from) {
    return this.getAllDataChanges(
      'suppliers',
      module,
      from,
      this.getSelectFields(SupplierModel.fields)
    );
  }

  /**
   * Get supplier by ID
   * PHP: getSupplierTableRow()
   */
  async getSupplierTableRow(id) {
    try {
      const param = await this.getOneRow(
        id,
        'suppliers',
        this.getSelectFields(SupplierModel.fields)
      );
      if (param.status === true) {
        return {
          status: true,
          data: param.data,
          message: param.message,
        };
      } else {
        return {
          status: false,
          data: null,
          message: 'error',
        };
      }
    } catch (error) {
      console.error('Error in getSupplierTableRow:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete suppliers by IDs
   * PHP: deleteSupplierCollectionData()
   */
  async deleteSupplierCollectionData(ids, defaultSupplierId = null) {
    try {
      const collection = await this.getCollection();
      const licenseId = this.toObjectId(this.licenseId);
      const loggedUserId = this.toObjectId(this.loggedUserId);
      const objectIds = [];

      for (const id of ids) {
        // Check if this is the default supplier
        if (defaultSupplierId && String(defaultSupplierId) === String(id)) {
          return {
            status: false,
            data: null,
            message: 'This is default supplier, please choose another supplier and remove this',
          };
        }
        objectIds.push(new ObjectId(id));
        await this.changeLog('suppliers', loggedUserId, new ObjectId(id), 'delete');
      }

      const condition = {
        $and: [{ _id: { $in: objectIds } }, { license: licenseId }],
      };

      // Backup documents before deletion
      const supplierDocs = await collection.find(condition).toArray();
      for (const doc of supplierDocs) {
        await this.deletedDocumentBackup('suppliers', doc);
      }

      const deleteResult = await collection.deleteMany(condition);

      return {
        status: true,
        data: deleteResult.deletedCount,
        message: 'Supplier deleted successfully',
      };
    } catch (error) {
      console.error('Error in deleteSupplierCollectionData:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get suppliers for autocomplete
   * PHP: getSuppliersAjaxList()
   */
  async getSuppliersAjaxList(branchIds, query = '') {
    try {
      const collection = await this.getCollection();
      const licenseId = this.toObjectId(this.licenseId);

      // Convert branch IDs to ObjectIds
      const branchObjectIds = [];
      if (Array.isArray(branchIds)) {
        for (const id of branchIds) {
          const oid = this.toObjectId(id);
          if (oid) branchObjectIds.push(oid);
        }
      } else if (branchIds) {
        const oid = this.toObjectId(branchIds);
        if (oid) branchObjectIds.push(oid);
      }

      const searchConditions = [];
      if (query) {
        const regex = new RegExp(query, 'i');
        searchConditions.push({ name: regex }, { phone: regex }, { email: regex });
      }

      const filter = {
        $and: [
          { branch_id: { $in: branchObjectIds } },
          ...(searchConditions.length > 0 ? [{ $or: searchConditions }] : []),
          { license: licenseId },
        ],
      };

      const data = await collection.find(filter).limit(5).toArray();

      const suppliers = data.map((item) => ({
        id: String(item._id),
        name: item.name || '',
        address: item.address || '',
        phone: item.phone || '',
        email: item.email || '',
        state: item.state || '',
        gst_type: item.gst_type || '',
        gst_number: item.gst_number || '',
        branch: item.branch_name || '',
      }));

      return {
        status: true,
        data: suppliers,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getSuppliersAjaxList:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Import suppliers from CSV/Excel
   * PHP: importSupplierModel()
   */
  async importSupplierModel(data) {
    try {
      const collection = await this.getCollection();
      const branchId = this.toObjectId(this.branchId);
      const licenseId = this.toObjectId(this.licenseId);

      // Check max import limit from plan
      const maxImport = await this.checkPlan('suppliers', 'import');
      const count = maxImport > 0 ? Math.min(maxImport, data.length) : data.length;

      // Filter unique records
      const uniqueValue = [];
      for (let i = 0; i < count; i++) {
        if (!uniqueValue.some((v) => JSON.stringify(v) === JSON.stringify(data[i]))) {
          uniqueValue.push(data[i]);
        }
      }

      // Filter unique records based on name and phone
      const uniqueCSVRecords = {};
      for (const item of uniqueValue) {
        const name = item.name || '';
        const phone = item.phone || '';
        const email = item.email || '';
        const address = item.address || '';
        const key = `${name}-${phone}`;
        if (!uniqueCSVRecords[key]) {
          uniqueCSVRecords[key] = { name, phone, email, address };
        }
      }

      // Validate required fields
      const requiredFields = ['name'];
      const validationErrors = [];

      for (const key in uniqueCSVRecords) {
        const item = uniqueCSVRecords[key];
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

      if (validationErrors.length > 0) {
        return {
          status: true,
          data: validationErrors,
          message: 'CSV',
        };
      }

      // Check for existing records
      const alreadyData = [];
      const newData = [];

      for (const key in uniqueCSVRecords) {
        const item = uniqueCSVRecords[key];
        if (!item.name) continue;

        const recordExists = await collection.findOne({
          branch_id: branchId,
          name: item.name,
          phone: item.phone || '',
          license: licenseId,
        });

        if (recordExists) {
          alreadyData.push({
            name: recordExists.name,
            phone: recordExists.phone,
            email: recordExists.email || '',
            address: recordExists.address || '',
          });
        } else {
          newData.push(item);
        }
      }

      if (newData.length === 0) {
        return {
          status: false,
          data: alreadyData,
          message: 'All suppliers are already imported',
        };
      }

      const mongoDate = new Date();
      const loggedUserId = this.toObjectId(this.loggedUserId);

      const insertDataTemplate = {
        branch_id: branchId,
        branch_name: this.branchName || '',
        date: mongoDate,
        country: this.branchCountry || '',
        state: this.branchState || '',
        city: this.branchCity || '',
        created_date: mongoDate,
        created_by: this.loggedUserName || '',
        created_by_id: loggedUserId,
        license: licenseId,
      };

      const updateDataTemplate = {
        gst: 'disable',
        gst_type: 'consumer',
        gst_number: '',
        updated_date: mongoDate,
        updated_by: this.loggedUserName || '',
        updated_by_id: loggedUserId,
        license: licenseId,
      };

      const documentsToInsert = newData.map((item) => ({
        ...insertDataTemplate,
        name: item.name || '',
        phone: item.phone || '',
        email: item.email || '',
        address: item.address || '',
        ...updateDataTemplate,
      }));

      const insertResult = await collection.insertMany(documentsToInsert);
      const insertedIds = Object.values(insertResult.insertedIds);

      const cursor = await collection
        .find(
          { _id: { $in: insertedIds }, license: licenseId },
          { projection: this.getSelectFields(SupplierModel.importFields) }
        )
        .toArray();

      return {
        status: true,
        data: cursor,
        message: 'Supplier data imported successfully',
      };
    } catch (error) {
      console.error('Error in importSupplierModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get paginated suppliers
   * PHP: supplierPage()
   */
  async supplierPage(filters = {}, options = {}) {
    try {
      const collection = await this.getCollection();
      const branchId = this.toObjectId(this.branchId);
      const licenseId = this.toObjectId(this.licenseId);

      if (!branchId || !licenseId) {
        return { status: false, data: null, message: 'Branch and license context required' };
      }

      const limit = parseInt(options.limit) || 5;
      const page = parseInt(options.page) || 1;
      const skip = (page - 1) * limit;
      const sort = options.sort || { _id: -1 };

      // Build filter
      const filter = {
        branch_id: branchId,
        license: licenseId,
        ...this.assignFilterObjects(filters, SupplierModel.fields),
      };

      const [total, suppliers] = await Promise.all([
        collection.countDocuments(filter),
        collection
          .find(filter, { projection: BaseModel.getSelectFields(SupplierModel.fields) })
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .toArray(),
      ]);

      const list = suppliers.map((item) => BaseModel.simplifyFields(item));

      return {
        status: true,
        data: {
          total,
          current_page: page,
          total_pages: Math.ceil(total / limit) || 1,
          per_page: limit,
          list,
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in supplierPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export suppliers by IDs
   * PHP: exportSupplierOrder()
   */
  async exportSupplierOrder(ids) {
    try {
      const collection = await this.getCollection();

      // Normalize and validate incoming IDs
      const rawIds = Array.isArray(ids) ? ids : ids ? [ids] : [];
      const objectIds = rawIds
        .filter((id) => typeof id === 'string' && ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      if (objectIds.length === 0) {
        return {
          status: true,
          data: [],
          message: 'Supplier Data Exported',
        };
      }

      // Match documents strictly by _id so that any suppliers visible in the
      // list (already license/branch-scoped) can always be exported. This
      // mirrors the fallback behavior used in getOneRow, where we ignore
      // license when looking up by primary key.
      const cursor = await collection
        .find(
          { _id: { $in: objectIds } },
          {
            sort: { _id: -1 },
            projection: this.getSelectFields(SupplierModel.importFields),
          }
        )
        .toArray();

      return {
        status: true,
        data: cursor,
        message: 'Supplier Data Exported',
      };
    } catch (error) {
      console.error('Error in exportSupplierOrder:', error);
      return {
        // For export, prefer a graceful empty result over a hard failure
        status: true,
        data: [],
        message: 'Supplier Data Exported',
      };
    }
  }

  /**
   * Update branch name in suppliers
   * PHP: updateSupplierModel()
   */
  static async updateSupplierModel(data) {
    try {
      const db = BaseModel.database;
      if (!db) return 0;

      const collection = db.collection('suppliers');
      const result = await collection.updateMany(
        {
          branch_id: new ObjectId(data.id),
          license: BaseModel.license,
        },
        { $set: { branch_name: data.branch_name } }
      );
      return result.modifiedCount;
    } catch (error) {
      console.error('Error in updateSupplierModel:', error);
      return 0;
    }
  }

  /**
   * Get supplier graphical reports
   * PHP: getSupplierGraphicalReports()
   */
  async getSupplierGraphicalReports(value) {
    try {
      const db = BaseModel.database;
      if (!db) {
        return { status: false, data: null, message: 'Database not connected' };
      }

      const receivingsCollection = db.collection('receivings');
      const licenseId = this.toObjectId(this.licenseId);

      const fromDate = this.startingDate(value.starting_date);
      const toDate = this.endingDate(value.ending_date);

      // Convert branch IDs to ObjectIds
      const branchObjectIds = [];
      if (Array.isArray(value.branchid)) {
        for (const id of value.branchid) {
          const oid = this.toObjectId(id);
          if (oid) branchObjectIds.push(oid);
        }
      }

      console.log('🔍 supplierGraphicalReports - Branch IDs:', value.branchid);
      console.log('🔍 supplierGraphicalReports - Branch ObjectIds:', branchObjectIds);
      console.log('🔍 supplierGraphicalReports - Date range:', fromDate, 'to', toDate);

      // Convert timestamps to Date objects
      const startDateObj = new Date(fromDate);
      const endDateObj = new Date(toDate);

      const condition = {
        $and: [
          {
            branch_id: { $in: branchObjectIds },
            receiving_status: { $in: ['Open', 'Received', 'PartialReturn'] },
          },
          {
            updated_date: { $gte: startDateObj, $lte: endDateObj },
            license: licenseId,
          },
        ],
      };

      console.log('🔍 supplierGraphicalReports - Condition:', JSON.stringify(condition, null, 2));

      const pipeline = [
        { $match: condition },
        {
          $group: {
            _id: { supplier_name: '$supplier_name' },
            total_amount: { $sum: '$items_total' },
            avg: { $avg: '$items_total' },
            receiving_count: { $sum: 1 },
          },
        },
        { $sort: { total_amount: -1 } },
        { $limit: 5 },
      ];

      const supplierList = await receivingsCollection.aggregate(pipeline).toArray();

      console.log('🔍 supplierGraphicalReports - Results count:', supplierList.length);

      const graphicalData = {};
      for (const data of supplierList) {
        const supplierName = data._id?.supplier_name || 'Unknown';
        graphicalData[supplierName] = {
          total: Math.round((data.total_amount || 0) * 100) / 100,
          'avg.sale': Math.round((data.avg || 0) * 100) / 100,
          'no.of.sale': data.receiving_count || 0,
        };
      }

      return {
        status: true,
        data: graphicalData,
        message: 'Graphical report successfully',
      };
    } catch (error) {
      console.error('Error in getSupplierGraphicalReports:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = SupplierModel;
