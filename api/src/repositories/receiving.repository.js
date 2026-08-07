// src/repositories/receiving.repository.js
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const StockLogsRepository = require('./stock-log.repository');

/**
 * Receiving Repository
 * Handles all database operations for receivings/purchase orders
 * Separates data access logic from business logic
 */
class ReceivingRepository extends BaseModel {
  constructor() {
    super('receivings');
  }

  /**
   * Find all receivings with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    const { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    // Normalize pagination to prevent negative skip values
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, parseInt(limit) || 10);

    const query = {
      ...filters,
      license: BaseModel.license,
    };

    const collection = await this.getCollection(this.collectionName);

    const [receivings, total] = await Promise.all([
      collection
        .find(query)
        .sort(sort)
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: receivings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Find receiving by ID
   */
  async findById(id) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
      ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
    });
  }

  /**
   * Find receiving by receiving_id (human-readable ID)
   */
  async findByReceivingId(receivingId) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      receiving_id: receivingId,
      license: BaseModel.license,
    });
  }

  /**
   * Find receivings by supplier ID
   */
  async findBySupplier(supplierId, options = {}) {
    const { page = 1, limit = 10 } = options;

    // Normalize pagination to prevent negative skip values
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, parseInt(limit) || 10);

    const query = {
      supplier: new ObjectId(supplierId),
      license: BaseModel.license,
    };

    const collection = await this.getCollection(this.collectionName);

    const [receivings, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: receivings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Find receivings by branch ID
   */
  async findByBranch(branchId, options = {}) {
    const { page = 1, limit = 10 } = options;

    // Normalize pagination to prevent negative skip values
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, parseInt(limit) || 10);

    const query = {
      branch_id: new ObjectId(branchId),
      license: BaseModel.license,
    };

    const collection = await this.getCollection(this.collectionName);

    const [receivings, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: receivings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Create a new receiving
   */
  async create(receivingData) {
    const collection = await this.getCollection(this.collectionName);

    const dataToInsert = {
      ...receivingData,
      license: BaseModel.license,
      created_date: new Date(),
      updated_date: new Date(),
    };

    const result = await collection.insertOne(dataToInsert);
    return await this.findById(result.insertedId);
  }

  /**
   * Update a receiving
   */
  async update(id, updateData) {
    const collection = await this.getCollection(this.collectionName);

    const dataToUpdate = {
      ...updateData,
      updated_date: new Date(),
      updated_by: BaseModel.loggedUser,
      updated_by_id: BaseModel.loggedUser,
    };

    await collection.updateOne(
      {
        _id: new ObjectId(id),
        license: BaseModel.license,
      },
      { $set: dataToUpdate }
    );

    return await this.findById(id);
  }

  /**
   * Hard delete receiving with backup to recycle bin
   * Includes stock log integration (mirrors PHP line 950-965)
   */
  async hardDelete(id) {
    const collection = await this.getCollection(this.collectionName);

    // Find the receiving document first
    const receiving = await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    if (!receiving) {
      throw new Error('Receiving not found');
    }

    // Get branch to check stock_management setting (PHP line 950)
    const branchesCollection = await this.getCollection('branches');
    const branchDoc = await branchesCollection.findOne({
      _id: BaseModel.currentBranch,
    });

    const stockManagement = branchDoc?.stock_management === true;
    const stockLogStatus = branchDoc?.stock_management_log !== false;

    console.log('[RECEIVING DELETE DEBUG] Stock log context:', {
      stockManagement: stockManagement,
      stockLogStatus: stockLogStatus,
      receiving_status: receiving.receiving_status,
      itemCount: receiving.items?.length || 0,
    });

    // Stock log integration (PHP line 950-965)
    // Only log if receiving_status is 'Received' AND stock_management is enabled
    if (stockManagement && receiving.receiving_status === 'Received' && receiving.items) {
      const stockLogsRepository = new StockLogsRepository();
      const itemsCollection = await this.getCollection('items');
      const now = new Date();
      const receivingId = receiving.receiving_id || id;

      for (const item of receiving.items) {
        if (!item.item_id || !item.item_quantity) continue;

        try {
          const itemObjectId = new ObjectId(item.item_id);
          const itemDoc = await itemsCollection.findOne({
            _id: itemObjectId,
            license: BaseModel.license,
          });

          console.log('[RECEIVING DELETE DEBUG] Item check:', {
            item_id: item.item_id,
            track_inventory: itemDoc?.track_inventory,
            track_inventory_type: typeof itemDoc?.track_inventory,
          });

          // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
          if (!itemDoc || !(itemDoc.track_inventory === true || itemDoc.track_inventory === 'true'))
            continue;

          const itemQuantity = Number(item.item_quantity);
          const openingBalance = Number(itemDoc.available_quantity || 0);
          const closingBalance = openingBalance - itemQuantity;
          const count = String(-itemQuantity);

          console.log('[RECEIVING DELETE DEBUG] Creating stock log for item:', item.item_id);

          // Create stock log (PHP line 962)
          await stockLogsRepository.createStockLog({
            stocklog: stockLogStatus,
            branch_id: BaseModel.currentBranch,
            view_item_id: itemObjectId,
            item_barcode_id: item.barcode_id || itemDoc.barcode_id || '',
            item_name: item.item_name || itemDoc.name || '',
            item_quantity: count,
            process: 'Delete Receiving',
            reference: receivingId,
            opening_balance: openingBalance,
            closing_balance: closingBalance,
            count: count,
            date: now,
            action: 'Subtract',
            changed_by_userid: BaseModel.loggedUser,
            changed_by: BaseModel.loggedUserName || 'System',
          });

          console.log('[RECEIVING DELETE] Stock log created successfully');

          // Update item quantity (PHP line 963)
          await itemsCollection.updateOne(
            { _id: itemObjectId, license: BaseModel.license },
            { $set: { available_quantity: closingBalance } }
          );
        } catch (itemError) {
          console.error(`Error processing stock log for item ${item.item_id}:`, itemError);
        }
      }
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection('recycle_bin');
    await recycleCollection.insertOne({
      collection_name: 'receivings',
      document: receiving,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUserName || 'system',
      deleted_by_id: BaseModel.loggedUser || null,
      license: BaseModel.license,
    });

    // Hard delete from main collection
    await collection.deleteOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    return receiving;
  }

  /**
   * Bulk hard delete receivings with backup
   */
  async bulkHardDelete(ids) {
    const collection = await this.getCollection(this.collectionName);
    const objectIds = ids.map((id) => new ObjectId(id));

    // Find all receivings to be deleted
    const receivings = await collection
      .find({
        _id: { $in: objectIds },
        license: BaseModel.license,
      })
      .toArray();

    if (receivings.length === 0) {
      return { deletedCount: 0 };
    }

    // Backup to recycle bin collection
    const recycleCollection = await this.getCollection('recycle_bin');
    const backupDocs = receivings.map((receiving) => ({
      collection_name: 'receivings',
      document: receiving,
      deleted_date: new Date(),
      deleted_by: BaseModel.loggedUserName || 'system',
      deleted_by_id: BaseModel.loggedUser || null,
      license: BaseModel.license,
    }));
    await recycleCollection.insertMany(backupDocs);

    // Hard delete from main collection
    const result = await collection.deleteMany({
      _id: { $in: objectIds },
      license: BaseModel.license,
    });

    return { deletedCount: result.deletedCount };
  }

  /**
   * Get last receiving ID for generating next sequence
   */
  async getLastReceivingId(branchId) {
    const collection = await this.getCollection(this.collectionName);

    const query = {
      license: BaseModel.license,
    };

    if (branchId) {
      query.branch_id = new ObjectId(branchId);
    }

    const lastReceiving = await collection.find(query).sort({ _id: -1 }).limit(1).toArray();

    return lastReceiving.length > 0 ? lastReceiving[0] : null;
  }

  /**
   * Find receivings by status
   */
  async findByStatus(status, options = {}) {
    const { page = 1, limit = 10 } = options;

    // Normalize pagination to prevent negative skip values
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, parseInt(limit) || 10);

    const query = {
      status: status,
      license: BaseModel.license,
    };

    const collection = await this.getCollection(this.collectionName);

    const [receivings, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: receivings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Find receivings by payment status
   */
  async findByPaymentStatus(paymentStatus, options = {}) {
    const { page = 1, limit = 10 } = options;

    // Normalize pagination to prevent negative skip values
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, parseInt(limit) || 10);

    const query = {
      payment_status: paymentStatus,
      license: BaseModel.license,
    };

    const collection = await this.getCollection(this.collectionName);

    const [receivings, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: receivings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Bulk create receivings (for import)
   */
  async bulkCreate(receivingsData) {
    const collection = await this.getCollection(this.collectionName);

    const dataToInsert = receivingsData.map((receiving) => ({
      ...receiving,
      license: BaseModel.license,
      created_date: new Date(),
      updated_date: new Date(),
    }));

    const result = await collection.insertMany(dataToInsert);
    const insertedIds = Object.values(result.insertedIds);

    return await collection
      .find({
        _id: { $in: insertedIds },
      })
      .toArray();
  }

  /**
   * Export receivings by IDs
   */
  async exportByIds(ids) {
    const collection = await this.getCollection(this.collectionName);
    const objectIds = ids.map((id) => new ObjectId(id));

    return await collection
      .find({
        _id: { $in: objectIds },
        license: BaseModel.license,
      })
      .select({
        receiving_id: 1,
        supplier_name: 1,
        date: 1,
        items_total: 1,
        receiving_status: 1,
        payment_mode: 1,
        branch_name: 1,
      })
      .sort({ _id: -1 })
      .toArray();
  }
}

module.exports = ReceivingRepository;
