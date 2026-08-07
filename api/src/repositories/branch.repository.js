const { searchPattern } = require('../utils/safe-search');
const Branch = require('../models/branch.model');

/**
 * Branches Repository
 * Handles all data access operations for branches
 */
class BranchesRepository {
  constructor() {
    this.branchModel = Branch;
  }

  /**
   * Find branch by ID
   */
  async findById(id, options = {}) {
    try {
      let query = this.branchModel.findById(id);

      if (options.select) {
        query = query.select(options.select);
      }

      if (options.lean) {
        query = query.lean();
      }

      return await query;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find one branch by filter
   */
  async findOne(filter, options = {}) {
    try {
      let query = this.branchModel.findOne(filter);

      if (options.select) {
        query = query.select(options.select);
      }

      if (options.lean) {
        query = query.lean();
      }

      if (options.sort) {
        query = query.sort(options.sort);
      }

      return await query;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find multiple branches
   */
  async find(filter = {}, options = {}) {
    try {
      let query = this.branchModel.find(filter);

      if (options.select) {
        query = query.select(options.select);
      }

      if (options.lean) {
        query = query.lean();
      }

      if (options.sort) {
        query = query.sort(options.sort);
      }

      if (options.skip) {
        query = query.skip(options.skip);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      return await query;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Count documents
   */
  async countDocuments(filter = {}) {
    try {
      return await this.branchModel.countDocuments(filter);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create new branch
   */
  async create(data) {
    try {
      const branch = new this.branchModel(data);
      return await branch.save();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update branch by ID
   */
  async updateById(id, data, options = {}) {
    try {
      return await this.branchModel.findByIdAndUpdate(id, data, {
        new: true,
        runValidators: true,
        ...options,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete branch by ID
   */
  async deleteById(id) {
    try {
      return await this.branchModel.findByIdAndDelete(id);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get branch options for dropdown
   */
  async getBranchOptions() {
    try {
      const branches = await this.branchModel.find({}, 'branch_name _id').lean();

      return branches.map((branch) => ({
        label: branch.branch_name,
        value: branch._id.toString(),
      }));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Search branches by query
   */
  async searchBranches(query, limit = 10) {
    try {
      return await this.branchModel
        .find({
          $or: [
            { branch_name: { $regex: searchPattern(query), $options: 'i' } },
            { address: { $regex: searchPattern(query), $options: 'i' } },
            { store_email: { $regex: searchPattern(query), $options: 'i' } },
          ],
        })
        .limit(limit)
        .lean();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get first branch (fallback)
   */
  async getFirstBranch() {
    try {
      return await this.branchModel.findOne({}, '_id').sort({ created_date: 1 }).lean();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get branch statistics
   */
  async getBranchStats() {
    try {
      const total = await this.countDocuments();
      const active = await this.countDocuments({ status: 'active' });
      const inactive = await this.countDocuments({ status: 'inactive' });

      return {
        total,
        active,
        inactive,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Direct model access for complex operations
   */
  get model() {
    return this.branchModel;
  }
}

module.exports = new BranchesRepository();
