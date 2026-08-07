const { searchPattern } = require('../utils/safe-search');
/**
 * Variants Repository
 * Data access layer for variants module
 */

const Variant = require('../models/variant.model');
const mongoose = require('mongoose');
require('../constants/variants.constants');

class VariantsRepository {
  constructor() {
    this.model = Variant;
  }

  /**
   * Get all variants with pagination and filters
   * Matches PHP: variantPage()
   */
  async findAll(query = {}, options = {}) {
    const { page = 1, limit = 5, sort = '_id', order = 'desc' } = options;

    const sortOptions = { [sort]: order === 'desc' ? -1 : 1 };
    const skip = Math.max(0, (page - 1) * limit);

    const [total, variants] = await Promise.all([
      this.model.countDocuments(query),
      this.model.find(query).sort(sortOptions).limit(limit).skip(skip).lean(),
    ]);

    return {
      total,
      variants,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  /**
   * Find variant by ID
   * Matches PHP: getVariantTableRow()
   */
  async findById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }
    return await this.model.findById(id).lean();
  }

  /**
   * Find one variant by query
   */
  async findOne(query) {
    return await this.model.findOne(query).lean();
  }

  /**
   * Create a new variant
   * Matches PHP: variantInsertUpdate() - insert part
   */
  async create(data) {
    const variant = new this.model(data);
    return await variant.save();
  }

  /**
   * Update a variant by ID
   * Matches PHP: variantInsertUpdate() - update part
   */
  async update(id, data, branch_id = null) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    // Build query with branch verification
    const query = { _id: id };
    if (branch_id && mongoose.Types.ObjectId.isValid(branch_id)) {
      query.branch_id = new mongoose.Types.ObjectId(branch_id);
    }

    const variant = await this.model.findOne(query);
    if (!variant) {
      return null;
    }

    Object.assign(variant, data);
    variant.updated_date = new Date();

    return await variant.save();
  }

  /**
   * Delete a variant by ID
   */
  async delete(id, branch_id = null) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    // Build query with branch verification
    const query = { _id: id };
    if (branch_id && mongoose.Types.ObjectId.isValid(branch_id)) {
      query.branch_id = new mongoose.Types.ObjectId(branch_id);
    }

    return await this.model.findOneAndDelete(query);
  }

  /**
   * Delete multiple variants by IDs
   * Matches PHP: deleteVariantCollectionData()
   */
  async deleteMany(ids, branch_id = null) {
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!objectIds.length) {
      return { deletedCount: 0 };
    }

    // Build query with branch verification
    const query = { _id: { $in: objectIds } };
    if (branch_id && mongoose.Types.ObjectId.isValid(branch_id)) {
      query.branch_id = new mongoose.Types.ObjectId(branch_id);
    }

    return await this.model.deleteMany(query);
  }

  /**
   * Find variants for AJAX autocomplete
   * Matches PHP: getVariantsAjaxList()
   */
  async findForAutocomplete(query, branchId = null, limit = 20) {
    const filter = {};

    if (query) {
      filter.name = { $regex: searchPattern(query), $options: 'i' };
    }

    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      filter.branch_id = new mongoose.Types.ObjectId(branchId);
    }

    return await this.model.find(filter).select('name fields').limit(limit).lean();
  }

  /**
   * Find variants by IDs for export
   * Matches PHP: exportVariantsOrder()
   */
  async findByIdsForExport(ids, branch_id = null) {
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!objectIds.length) {
      return [];
    }

    // Build query with branch filter
    const query = { _id: { $in: objectIds } };
    if (branch_id && mongoose.Types.ObjectId.isValid(branch_id)) {
      query.branch_id = new mongoose.Types.ObjectId(branch_id);
    }

    return await this.model.find(query).sort({ _id: -1 }).select('name fields description').lean();
  }

  /**
   * Find variants by field name
   */
  async findByField(fieldName) {
    return await this.model.find({ 'fields.name': fieldName }).sort({ name: 1 }).lean();
  }

  /**
   * Search variants by name or description
   */
  async search(searchQuery, limit = 20) {
    return await this.model
      .find({
        $or: [
          { name: { $regex: searchPattern(searchQuery), $options: 'i' } },
          { description: { $regex: searchPattern(searchQuery), $options: 'i' } },
        ],
      })
      .limit(limit)
      .lean();
  }

  /**
   * Get total count of variants
   */
  async count(query = {}) {
    return await this.model.countDocuments(query);
  }

  /**
   * Check if variant exists by name (case-insensitive)
   * Matches PHP: Check within same branch
   */
  async existsByName(name, excludeId = null, branch_id = null) {
    const query = {
      name: new RegExp(`^${this.escapeRegExp(name)}$`, 'i'),
    };

    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }

    // Add branch filter to check duplicates within same branch only
    if (branch_id && mongoose.Types.ObjectId.isValid(branch_id)) {
      query.branch_id = new mongoose.Types.ObjectId(branch_id);
    }

    const variant = await this.model.findOne(query).lean();
    return !!variant;
  }

  /**
   * Escape special regex characters
   */
  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = new VariantsRepository();
