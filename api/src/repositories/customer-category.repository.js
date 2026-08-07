// src/repositories/customer-category.repository.js
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

/**
 * Customer Category Repository
 * Handles all database operations for customer categories
 * Separates data access logic from business logic
 */
class CustomerCategoryRepository extends BaseModel {
  constructor() {
    super('customer_category');
  }

  /**
   * Find all customer categories with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    const { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);

    const [categories, total] = await Promise.all([
      collection
        .find(query)
        .sort(sort)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: categories,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find customer category by ID
   */
  async findById(id) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
      branch_id: BaseModel.currentBranch,
      branch_name: BaseModel.currentBranchName,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Find customer category by name
   */
  async findByName(name, branchId) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      branch_id: new ObjectId(branchId),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });
  }

  /**
   * Search customer categories by query
   */
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 10, branchId = null } = options;

    const query = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      $or: [{ name: new RegExp(searchTerm, 'i') }, { description: new RegExp(searchTerm, 'i') }],
    };

    if (branchId) {
      query.branch_id = new ObjectId(branchId);
    }

    const collection = await this.getCollection(this.collectionName);

    const [categories, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: categories,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Create new customer category
   */
  async create(categoryData) {
    const collection = await this.getCollection(this.collectionName);

    const mongoDate = new Date();
    const insertData = {
      ...categoryData,
      branch_id: BaseModel.currentBranch,
      branch_name: BaseModel.currentBranchName,
      license: BaseModel.license,
      created_date: mongoDate,
      updated_date: mongoDate,
      is_deleted: false,
    };

    const result = await collection.insertOne(insertData);
    return await collection.findOne({
      _id: result.insertedId,
      ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      ...(BaseModel.license ? { license: BaseModel.license } : {}),
    });
  }

  /**
   * Update customer category
   */
  async update(id, updateData) {
    const collection = await this.getCollection(this.collectionName);

    const mongoDate = new Date();
    const update = {
      $set: {
        ...updateData,
        updated_date: mongoDate,
        updated_by: BaseModel.loggedUserName,
        updated_by_id: BaseModel.loggedUser,
      },
    };

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        license: BaseModel.license,
        branch_id: BaseModel.currentBranch,
        branch_name: BaseModel.currentBranchName,
        is_deleted: { $ne: true },
      },
      update,
      { returnDocument: 'after' }
    );

    return result;
  }

  /**
   * Hard delete customer category (physically remove from database)
   */
  async softDelete(id) {
    const collection = await this.getCollection(this.collectionName);

    // Log deletion
    await this.changeLog(this.collectionName, BaseModel.loggedUser, new ObjectId(id), 'delete');

    // Backup before deletion
    const category = await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    if (category) {
      await this.deletedDocumentBackup('customer_category', category);
    }

    const result = await collection.deleteOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    return result.deletedCount;
  }

  /**
   * Hard delete multiple customer categories (physically remove from database)
   */
  async softDeleteMany(ids) {
    const collection = await this.getCollection(this.collectionName);

    const objectIds = ids.map((id) => new ObjectId(id));

    // Log deletions
    for (const objectId of objectIds) {
      await this.changeLog(this.collectionName, BaseModel.loggedUser, objectId, 'delete');
    }

    const condition = {
      $and: [{ _id: { $in: objectIds } }, { license: BaseModel.license }],
    };

    // Backup before deletion
    const categories = await collection.find(condition).toArray();

    for (const category of categories) {
      await this.deletedDocumentBackup('customer_category', category);
    }

    const result = await collection.deleteMany(condition);

    return result.deletedCount;
  }

  /**
   * Get customer categories count
   */
  async count(filters = {}) {
    const collection = await this.getCollection(this.collectionName);

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    return await collection.countDocuments(query);
  }

  /**
   * Check if customer category exists
   */
  async exists(id) {
    const collection = await this.getCollection(this.collectionName);

    const count = await collection.countDocuments({
      _id: new ObjectId(id),
      license: BaseModel.license,
      is_deleted: { $ne: true },
    });

    return count > 0;
  }
}

module.exports = CustomerCategoryRepository;
