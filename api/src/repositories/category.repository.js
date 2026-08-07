// src/repositories/category.repository.js
const { Types } = require('mongoose');
const Category = require('../models/category.model');
const BaseModel = require('../models/base.model');

/**
 * Category Repository
 * Handles all database operations for categories
 * Separates data access logic from business logic
 */
class CategoryRepository extends BaseModel {
  constructor() {
    super('categories');
    this.model = Category;
  }

  /**
   * Find all categories with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    let { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    // Ensure page is at least 1 to prevent negative skip values
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.max(1, parseInt(limit) || 10);

    const query = {
      ...filters,
    };

    const [categories, total] = await Promise.all([
      this.model
        .find(query)
        .sort(sort)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .lean(),
      this.model.countDocuments(query),
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
   * Find category by ID
   */
  async findById(id) {
    return await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
      })
      .lean();
  }

  /**
   * Find category by name and branch
   */
  async findByName(name, branchId) {
    return await this.model
      .findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        branch_id: new Types.ObjectId(branchId),
      })
      .lean();
  }

  /**
   * Find category by exact name, branch, and license
   */
  async findByNameBranchLicense(name, branchId, licenseId = null) {
    const query = {
      name,
      is_deleted: { $ne: true },
    };

    if (branchId) {
      const branchValue =
        branchId instanceof Types.ObjectId ? branchId : new Types.ObjectId(branchId);
      query.branch_id = branchValue;
    }

    const licenseValue = licenseId || BaseModel.license;
    if (licenseValue) {
      query.license =
        licenseValue instanceof Types.ObjectId ? licenseValue : new Types.ObjectId(licenseValue);
    }

    return await this.model.findOne(query).lean();
  }

  /**
   * Search categories by query
   */
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 10, branchId = null, status = null, license = null } = options;

    const query = {
      $or: [{ name: new RegExp(searchTerm, 'i') }, { description: new RegExp(searchTerm, 'i') }],
      is_deleted: { $ne: true },
    };

    if (branchId) {
      query.branch_id = new Types.ObjectId(branchId);
    }

    if (license) {
      query.license = new Types.ObjectId(license);
    }

    if (status !== null && status !== 'all') {
      query.is_active = status === 'active';
    }

    const [categories, total] = await Promise.all([
      this.model
        .find(query)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .lean(),
      this.model.countDocuments(query),
    ]);

    return { data: categories, total };
  }

  /**
   * Create new category
   */
  async create(categoryData) {
    const category = new this.model({
      ...categoryData,
      created_date: new Date(),
      updated_date: new Date(),
    });

    await category.save();
    return category.toObject();
  }

  /**
   * Update category
   */
  async update(id, updateData) {
    const category = await this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        is_deleted: { $ne: true },
      },
      {
        $set: {
          ...updateData,
          updated_date: new Date(),
        },
      },
      { new: true, lean: true }
    );

    return category;
  }

  /**
   * Soft delete category
   */
  async softDelete(id) {
    const category = await this.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
      },
      {
        $set: {
          is_deleted: true,
          deleted_date: new Date(),
        },
      },
      { new: true, lean: true }
    );

    return category;
  }

  /**
   * Bulk soft delete categories
   */
  async bulkSoftDelete(ids) {
    const objectIds = ids.map((id) => new Types.ObjectId(id));

    const result = await this.model.updateMany(
      {
        _id: { $in: objectIds },
      },
      {
        $set: {
          is_deleted: true,
          deleted_date: new Date(),
        },
      }
    );

    return result;
  }

  /**
   * Bulk hard delete categories with backup to recycle bin
   */
  async bulkHardDelete(ids) {
    const collection = await this.getCollection(this.collectionName);
    const objectIds = ids.map((id) => new Types.ObjectId(id));

    // Convert license to ObjectId if it's a string
    const licenseId = BaseModel.license
      ? typeof BaseModel.license === 'string'
        ? new Types.ObjectId(BaseModel.license)
        : BaseModel.license
      : null;

    // Build condition - try with license filter first
    const condition = {
      $and: [{ _id: { $in: objectIds } }, { license: licenseId }],
    };

    // Find all categories to be deleted
    const categories = await collection.find(condition).toArray();

    if (categories.length === 0) {
      return { deletedCount: 0 };
    }

    // Log deletions
    for (const category of categories) {
      await this.changeLog('categories', BaseModel.loggedUser, category._id, 'delete');
    }

    // Backup to recycle bin using deletedDocumentBackup method
    for (const doc of categories) {
      await this.deletedDocumentBackup('categories', doc);
    }

    // Hard delete from main collection
    const result = await collection.deleteMany(condition);

    return { deletedCount: result.deletedCount };
  }

  /**
   * Get categories by branch
   */
  async findByBranch(branchId, options = {}) {
    const { activeOnly = false, license = null } = options;

    const query = {
      branch_id: new Types.ObjectId(branchId),
      is_deleted: { $ne: true },
    };

    if (license) {
      query.license = new Types.ObjectId(license);
    }

    if (activeOnly) {
      // Treat undefined is_active as true (active by default)
      query.$or = [{ is_active: true }, { is_active: { $exists: false } }];
    }

    return await this.model.find(query).sort({ sort_order: 1, name: 1 }).lean();
  }

  /**
   * Get category with item count
   */
  async getCategoryWithItemCount(id) {
    const category = await this.findById(id);
    if (!category) return null;

    // Get item count from items collection
    const Item = require('../models/item.model');
    const itemCount = await Item.countDocuments({
      category_id: new Types.ObjectId(id),
      is_deleted: { $ne: true },
    });

    return {
      ...category,
      item_count: itemCount,
    };
  }

  /**
   * Check if category has items
   */
  async hasItems(id) {
    const Item = require('../models/item.model');
    const count = await Item.countDocuments({
      category_id: new Types.ObjectId(id),
      is_deleted: { $ne: true },
    });

    return count > 0;
  }

  /**
   * Get categories by branch that have items
   *
   * This mirrors legacy PHP categoryListWithValidItems +
   * ItemModel::getCategoriesWithStockedItems and is aligned with
   * ItemRepository.getOnlineSalesItems:
   *  - Same branch & license scoping
   *  - Only items that are sellable (respecting track_inventory,
   *    negative_stock, available_quantity, item_status, sales_channel)
   *
   * As a result, Sales "Categories" tab will only show categories that
   * actually have valid items for the current branch/license.
   */
  async findByBranchWithItems(branchId, options = {}) {
    const { activeOnly = false, license = null } = options;

    const branchObjectId = new Types.ObjectId(branchId);
    const licenseObjectId =
      license && Types.ObjectId.isValid(license) ? new Types.ObjectId(license) : license || null;

    const matchStage = {
      branch_id: branchObjectId,
      is_deleted: { $ne: true },
      ...(licenseObjectId ? { license: licenseObjectId } : {}),
    };

    if (activeOnly) {
      // Treat undefined is_active as true (active by default)
      matchStage.$or = [{ is_active: true }, { is_active: { $exists: false } }];
    }

    // Aggregation pipeline to get only categories with at least one
    // sellable item for the current branch/license
    return await this.model.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'items',
          let: { categoryId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$category_id', '$$categoryId'],
                },
                // Match legacy PHP & getOnlineSalesItems branch scoping
                'branch_access.branch_id': branchObjectId,
                ...(licenseObjectId ? { license: licenseObjectId } : {}),
                item_status: { $ne: 'instant' },
                sales_channel: true,
                is_deleted: { $ne: true },
                $or: [
                  // Case 1: Inventory not tracked — always allowed
                  { track_inventory: false },

                  // Case 2: Negative stock allowed — quantity >= 0
                  {
                    $and: [{ negative_stock: true }, { available_quantity: { $gte: 0 } }],
                  },

                  // Case 3: Normal stock — quantity > 0
                  {
                    $and: [
                      {
                        $or: [{ negative_stock: false }, { negative_stock: { $exists: false } }],
                      },
                      { available_quantity: { $gt: 0 } },
                    ],
                  },
                ],
              },
            },
            { $limit: 1 },
          ],
          as: 'items',
        },
      },
      {
        $match: {
          'items.0': { $exists: true },
        },
      },
      {
        $project: {
          items: 0,
        },
      },
      { $sort: { sort_order: 1, name: 1 } },
    ]);
  }

  /**
   * Get data changes for sync
   */
  async getDataChanges(fromDate, branchId) {
    const query = {
      branch_id: new Types.ObjectId(branchId),
      updated_date: { $gte: new Date(fromDate) },
    };

    return await this.model.find(query).lean();
  }

  /**
   * Bulk import categories
   */
  async bulkCreate(categoriesData) {
    const categories = categoriesData.map((cat) => ({
      ...cat,
      image: cat.image || 'category.svg',
      created_date: new Date(),
      updated_date: new Date(),
      is_deleted: false,
    }));

    const result = await this.model.insertMany(categories);
    return result;
  }

  /**
   * Export categories data
   */
  async exportData(filters = {}) {
    const query = {
      ...filters,
      is_deleted: { $ne: true },
    };

    return await this.model
      .find(query)
      .select('name discount_amount discount_percentage description')
      .lean();
  }

  /**
   * Get active categories for dropdown
   */
  async getActiveCategories(branchId) {
    return await this.model
      .find({
        branch_id: new Types.ObjectId(branchId),
        is_active: true,
        is_deleted: { $ne: true },
      })
      .select('_id name image discount_amount discount_percentage')
      .sort({ sort_order: 1, name: 1 })
      .lean();
  }

  /**
   * Update category sort order
   */
  async updateSortOrder(id, sortOrder) {
    return await this.model.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $set: { sort_order: sortOrder, updated_date: new Date() } },
      { new: true, lean: true }
    );
  }

  /**
   * Toggle category active status
   */
  async toggleActive(id) {
    const category = await this.findById(id);
    if (!category) return null;

    return await this.model.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      { $set: { is_active: !category.is_active, updated_date: new Date() } },
      { new: true, lean: true }
    );
  }
}

module.exports = CategoryRepository;
