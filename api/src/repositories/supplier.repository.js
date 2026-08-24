// src/repositories/supplier.repository.js
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const { withBranchScope } = require('../services/branch-scope');
const dataSharing = require('../services/data-sharing');

/**
 * Supplier Repository
 * Handles all database operations for suppliers
 * Separates data access logic from business logic
 */
class SupplierRepository extends BaseModel {
  constructor() {
    super('suppliers');
  }

  /**
   * Find all suppliers with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    const { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);

    const [suppliers, total] = await Promise.all([
      collection
        .find(query)
        .sort(sort)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: suppliers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find supplier by ID
   */
  async findById(id) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne(
      withBranchScope(
        {
          _id: new ObjectId(id),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        },
        await dataSharing.scopeBranch('suppliers', BaseModel.currentBranch, {
          licenseId: BaseModel.license,
          branchId: BaseModel.currentBranch,
        })
      )
    );
  }

  /**
   * Find supplier by email
   */
  async findByEmail(email) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      email,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Find supplier by phone
   */
  async findByPhone(phone) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      phone,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  async findByNamePhoneBranch(name, phone, branchId) {
    const collection = await this.getCollection(this.collectionName);
    const query = {
      name,
      phone: phone || '',
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };
    if (branchId) {
      query.branch_id = branchId instanceof ObjectId ? branchId : new ObjectId(branchId);
    }
    return await collection.findOne(query);
  }

  /**
   * Search suppliers by query
   */
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 10, branchId = null } = options;

    let query = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      $or: [
        { name: new RegExp(searchTerm, 'i') },
        { company_name: new RegExp(searchTerm, 'i') },
        { email: new RegExp(searchTerm, 'i') },
        { phone: new RegExp(searchTerm, 'i') },
      ],
    };

    /* Under $and, not a second top-level $or - this query already owns one
       for name/company/email/phone, and replacing it would turn a search into
       a full-table read. */
    if (branchId) {
      query = withBranchScope(
        query,
        await dataSharing.scopeBranch('suppliers', branchId, {
          licenseId: BaseModel.license,
          branchId,
        })
      );
    }

    const collection = await this.getCollection(this.collectionName);

    const [suppliers, total] = await Promise.all([
      collection
        .find(query)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return { data: suppliers, total };
  }

  /**
   * Create new supplier
   */
  async create(supplierData) {
    const collection = await this.getCollection(this.collectionName);
    const normalizedData = { ...supplierData };
    if (typeof normalizedData.email !== 'string' || !normalizedData.email.trim()) {
      delete normalizedData.email;
    }
    const document = {
      ...normalizedData,
      license: BaseModel.license,
      created_date: new Date(),
      updated_date: new Date(),
      is_deleted: false,
    };

    /* S7 (D5), as for customers: record the branch that owns this supplier in
       the account-level relation, alongside the legacy branch_id. Access lists
       only that branch, so nothing becomes visible anywhere new - purchase
       reporting across branches becomes POSSIBLE, it does not just happen. */
    if (!Array.isArray(document.branch_access)) {
      const owning = document.branch_id || BaseModel.currentBranch || null;
      document.branch_access = owning
        ? [{ branch_id: owning, branch_name: document.branch_name || '' }]
        : [];
    }

    const result = await collection.insertOne(document);
    return await this.findById(result.insertedId);
  }

  /**
   * Update supplier
   */
  async update(id, updateData) {
    const collection = await this.getCollection(this.collectionName);
    const normalizedData = { ...updateData };
    const unsetEmail =
      Object.prototype.hasOwnProperty.call(normalizedData, 'email') &&
      (typeof normalizedData.email !== 'string' || !normalizedData.email.trim());
    if (unsetEmail) delete normalizedData.email;
    const updateOperation = {
      $set: { ...normalizedData, updated_date: new Date() },
    };
    if (unsetEmail) updateOperation.$unset = { email: '' };

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        license: BaseModel.license,
        is_deleted: { $ne: true },
      },
      updateOperation,
      { returnDocument: 'after' }
    );

    return result.value;
  }

  /**
   * Hard delete supplier with backup (matching PHP implementation)
   */
  async softDelete(id) {
    const collection = await this.getCollection(this.collectionName);

    // Find the supplier document first
    const supplier = await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    if (!supplier) {
      throw new Error('Supplier not found');
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection(this.collectionName + '_recycle_bin');
    await recycleCollection.insertOne({
      ...supplier,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUser || 'system',
    });

    // Hard delete from main collection
    await collection.deleteOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    return supplier;
  }

  /**
   * Bulk hard delete suppliers with backup (matching PHP implementation)
   */
  async bulkSoftDelete(ids) {
    const collection = await this.getCollection(this.collectionName);
    const objectIds = ids.map((id) => new ObjectId(id));

    // Find all suppliers to be deleted
    const suppliers = await collection
      .find({
        _id: { $in: objectIds },
        license: BaseModel.license,
      })
      .toArray();

    if (suppliers.length === 0) {
      return { deletedCount: 0 };
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection(this.collectionName + '_recycle_bin');
    const backupDocs = suppliers.map((supplier) => ({
      ...supplier,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUser || 'system',
    }));
    await recycleCollection.insertMany(backupDocs);

    // Hard delete from main collection
    const result = await collection.deleteMany({
      _id: { $in: objectIds },
      license: BaseModel.license,
    });

    return { deletedCount: result.deletedCount, modifiedCount: result.deletedCount };
  }

  /**
   * Get supplier summary/statistics
   */
  async getSummary(supplierId) {
    const collection = await this.getCollection(this.collectionName);

    const supplier = await collection.findOne({
      _id: new ObjectId(supplierId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });

    if (!supplier) {
      return null;
    }

    // Get receiving collection for purchase summary
    const receivingCollection = await this.getCollection('receiving');

    const purchaseSummary = await receivingCollection
      .aggregate([
        {
          $match: {
            supplier_id: new ObjectId(supplierId),
            license: BaseModel.license,
            is_deleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalPurchases: { $sum: 1 },
            totalAmount: { $sum: '$grand_total' },
            totalPaid: { $sum: '$paid_amount' },
            totalDue: { $sum: '$due_amount' },
          },
        },
      ])
      .toArray();

    const summary = purchaseSummary[0] || {
      totalPurchases: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalDue: 0,
    };

    return {
      supplier,
      ...summary,
    };
  }

  /**
   * Get supplier outstanding report
   */
  async getOutstandingReport(filters = {}, options = {}) {
    const { page = 1, limit = 10, branchIds = [] } = options;

    const receivingCollection = await this.getCollection('receiving');

    const matchStage = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      due_amount: { $gt: 0 },
    };

    if (branchIds.length > 0) {
      matchStage.branch_id = { $in: branchIds.map((id) => new ObjectId(id)) };
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: '$supplier_id',
          totalDue: { $sum: '$due_amount' },
          totalPurchases: { $sum: 1 },
          supplierName: { $first: '$supplier_name' },
          supplierPhone: { $first: '$supplier_phone' },
        },
      },
      { $sort: { totalDue: -1 } },
      { $skip: Math.max(0, (page - 1) * limit) },
      { $limit: limit },
    ];

    const results = await receivingCollection.aggregate(pipeline).toArray();

    return results;
  }

  /**
   * Get data changes for sync
   */
  async getDataChanges(fromDate) {
    const collection = await this.getCollection(this.collectionName);

    const query = {
      license: BaseModel.license,
      updated_date: { $gte: new Date(fromDate) },
    };

    return await collection.find(query).toArray();
  }

  /**
   * Bulk import suppliers
   */
  async bulkCreate(suppliersData) {
    const collection = await this.getCollection(this.collectionName);

    const documents = suppliersData.map((supplier) => {
      const normalized = { ...supplier };
      if (typeof normalized.email !== 'string' || !normalized.email.trim()) {
        delete normalized.email;
      }
      return {
        ...normalized,
        license: BaseModel.license,
        created_date: new Date(),
        updated_date: new Date(),
        is_deleted: false,
      };
    });

    const result = await collection.insertMany(documents);

    // Return the inserted documents for response formatting
    const insertedIds = Object.values(result.insertedIds);
    const insertedDocs = await collection
      .find({
        _id: { $in: insertedIds },
      })
      .toArray();

    return insertedDocs;
  }

  /**
   * Export suppliers data
   */
  async exportData(filters = {}) {
    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);
    return await collection
      .find(query, {
        projection: {
          name: 1,
          email: 1,
          phone: 1,
          address: 1,
        },
      })
      .toArray();
  }

  /**
   * Get supplier payment details
   */
  async getPaymentDetails(supplierId) {
    const receivingCollection = await this.getCollection('receiving');

    const pipeline = [
      {
        $match: {
          supplier_id: new ObjectId(supplierId),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$grand_total' },
          paidAmount: { $sum: '$paid_amount' },
          dueAmount: { $sum: '$due_amount' },
        },
      },
    ];

    const results = await receivingCollection.aggregate(pipeline).toArray();
    return results[0] || { totalAmount: 0, paidAmount: 0, dueAmount: 0 };
  }

  /**
   * Get supplier transactions
   */
  async getTransactions(supplierId, options = {}) {
    const { page = 1, limit = 10 } = options;

    const receivingCollection = await this.getCollection('receiving');

    const query = {
      supplier_id: new ObjectId(supplierId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const [transactions, total] = await Promise.all([
      receivingCollection
        .find(query)
        .sort({ created_date: -1 })
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      receivingCollection.countDocuments(query),
    ]);

    return { data: transactions, total };
  }
}

module.exports = SupplierRepository;
