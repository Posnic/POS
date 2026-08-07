const branchesRepository = require('../repositories/branch.repository');
const BranchModel = require('../models/branch.model');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  BRANCH_STATUS,
} = require('../constants/branches.constants');

/**
 * Branches Service
 * Business logic layer for branch operations
 */
class BranchesService {
  constructor() {
    this.repository = branchesRepository;
    this.branchModel = new BranchModel.BranchModel();
  }

  /**
   * Get branch statistics
   */
  async getBranchStatistics() {
    try {
      const stats = await this.repository.getBranchStats();

      return {
        status: true,
        message: SUCCESS_MESSAGES.RETRIEVED,
        data: stats,
      };
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Search branches
   */
  async searchBranches(query, limit = 10) {
    try {
      /*
       * The search term has to be a string, and it has to be inert.
       *
       * `query.length < 2` looked like a length check and was really a type
       * check that anything could pass. Express parses ?query[]=a&query[]=b
       * into an array, whose .length is 2, and ?query[$ne]=x into an object,
       * whose .length is undefined - and `undefined < 2` is false. Either way
       * the guard let it through, and the repository puts this straight into
       * { $regex: query }, so a Mongo operator arrived where a pattern was
       * expected.
       *
       * Escaping matters as much as the type. Without it a shop's own search
       * box accepts an arbitrary regular expression, which is a way to read
       * more than intended and a way to hang the database on a pattern like
       * (a+)+$ - CodeQL flags that separately as ReDoS.
       */
      const term = typeof query === 'string' ? query.trim() : '';
      if (term.length < 2) {
        return {
          status: false,
          message: 'Search query must be at least 2 characters',
          data: null,
        };
      }
      /*
       * Escaping happens once, in the repository, where the value actually
       * meets $regex. Doing it here too would double-escape - "a.b" becomes
       * "a\\.b" and then "a\\\\\\.b", which matches nothing - and a search box
       * that silently returns no results for anything containing a full stop
       * is worse than the hole this was closing.
       */

      const branches = await this.repository.searchBranches(term, limit);

      return {
        status: true,
        message: SUCCESS_MESSAGES.LIST_RETRIEVED,
        data: branches,
      };
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Toggle branch status
   */
  async toggleBranchStatus(branchId) {
    try {
      const branch = await this.repository.findById(branchId);

      if (!branch) {
        return {
          status: false,
          message: ERROR_MESSAGES.NOT_FOUND,
          data: null,
        };
      }

      const newStatus =
        branch.status === BRANCH_STATUS.ACTIVE ? BRANCH_STATUS.INACTIVE : BRANCH_STATUS.ACTIVE;

      branch.status = newStatus;
      await branch.save();

      return {
        status: true,
        message: SUCCESS_MESSAGES.STATUS_TOGGLED,
        data: branch,
      };
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get branch options for dropdown
   */
  async getBranchOptions() {
    try {
      const options = await this.repository.getBranchOptions();

      return {
        status: true,
        message: SUCCESS_MESSAGES.LIST_RETRIEVED,
        data: options,
      };
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Get first branch (fallback helper)
   */
  async getFirstBranch() {
    try {
      const branch = await this.repository.getFirstBranch();
      return branch;
    } catch (error) {
      return null;
    }
  }

  /**
   * Normalize branch ID from various sources
   */
  normalizeBranchId(candidates) {
    const normalizeId = (value) => {
      if (!value) return null;

      const mongoose = require('mongoose');
      const isObjectIdLike =
        value instanceof mongoose.Types.ObjectId ||
        (value && typeof value === 'object' && value._bsontype === 'ObjectID');

      if (isObjectIdLike) {
        return value.toString();
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed.length) return null;

        const lower = trimmed.toLowerCase();
        if (lower === 'null' || lower === 'undefined') {
          return null;
        }

        const objectIdMatch = trimmed.match(/ObjectId\(["']?([a-f0-9]{24})["']?\)/i);
        if (objectIdMatch) {
          return objectIdMatch[1];
        }

        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('%7B') && trimmed.endsWith('%7D'))
        ) {
          try {
            const decoded =
              trimmed.startsWith('%7B') && trimmed.endsWith('%7D')
                ? decodeURIComponent(trimmed)
                : trimmed;
            const parsed = JSON.parse(decoded);
            return normalizeId(parsed);
          } catch (error) {
            // Fall through
          }
        }

        return trimmed;
      }

      if (typeof value === 'object') {
        if (value.$oid) return value.$oid;
        if (value._id) {
          if (value._id === value) {
            return typeof value.toString === 'function' ? value.toString() : null;
          }
          return normalizeId(value._id);
        }
        if (value.id) return normalizeId(value.id);
        if (typeof value.toString === 'function') {
          const str = value.toString();
          if (str && str !== '[object Object]') {
            return str;
          }
        }
      }

      return null;
    };

    return candidates.map((candidate) => normalizeId(candidate)).find(Boolean) || null;
  }

  /**
   * Resolve a branch document for the current context based on an explicit
   * branchId (from user/session) or a licenseId. This mirrors the legacy
   * Branch.findOne behaviour used in item controllers but routes access
   * through the repository layer.
   */
  async resolveBranchForContext({ userBranchId, licenseId } = {}) {
    try {
      if (userBranchId) {
        return await this.repository.findById(userBranchId, { lean: true });
      }

      const filter = licenseId ? { license: licenseId } : {};
      return await this.repository.findOne(filter, { lean: true });
    } catch (error) {
      return null;
    }
  }

  /**
   * Get a single branch by ID (lean by default). Used by consumers that need
   * branch-level configuration such as notification_range.
   */
  async getBranchById(id, { lean = true } = {}) {
    try {
      return await this.repository.findById(id, { lean });
    } catch (error) {
      return null;
    }
  }
}

module.exports = new BranchesService();
