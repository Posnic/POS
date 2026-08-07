const baseRepository = require('../repositories/base.repository');

/**
 * Base Service
 * Handles business logic for autocomplete/suggestion operations
 */
class BaseService {
  constructor() {
    this.repository = baseRepository;
  }

  /**
   * Get autocomplete suggestions for a table field
   * @param {string} field - Field name to search
   * @param {string} collectionName - Collection name
   * @param {string} query - Search query
   * @param {Object} user - User object for context
   * @returns {Promise<Object>}
   */
  async getAutoSuggestions(field, collectionName, query, user = null) {
    try {
      // Validate required parameters
      if (!collectionName) {
        return {
          status: false,
          data: [],
          message: 'Module is required',
        };
      }

      // Build context from user
      const context = {
        license: user?.license || user?.license_id || null,
        branchId: user?.branch_id || user?.default_branch_id || null,
        userId: user?._id || user?.id || null,
      };

      const result = await this.repository.autoSuggestionTableField(
        field,
        collectionName,
        query,
        context
      );

      return result;
    } catch (error) {
      console.error('Error in getAutoSuggestions service:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Get autocomplete suggestions for report fields with branch filter
   * @param {string} query - Search query
   * @param {string} field - Field name to search
   * @param {string} collectionName - Collection name
   * @param {Array|string} branchIds - Branch IDs to filter by
   * @param {Object} user - User object for context
   * @returns {Promise<Object>}
   */
  async getReportAutoSuggestions(query, field, collectionName, branchIds, user = null) {
    try {
      // Build context from user
      const context = {
        license: user?.license || user?.license_id || null,
      };

      const result = await this.repository.autoSuggestionReportTableField(
        query,
        field,
        collectionName,
        branchIds,
        context
      );

      return result;
    } catch (error) {
      console.error('Error in getReportAutoSuggestions service:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }

  /**
   * Get default suggestions (name/phone search)
   * @param {string} module - Module/collection name
   * @param {string} query - Search query
   * @param {Object} user - User object for context
   * @returns {Promise<Object>}
   */
  async getDefaultSuggestions(module, query, user = null) {
    try {
      // Build context from user
      const context = {
        license: user?.license || user?.license_id || null,
        branchId: user?.branch_id || user?.default_branch_id || null,
      };

      const result = await this.repository.getDefaultSuggestion(module, query, context);

      return result;
    } catch (error) {
      console.error('Error in getDefaultSuggestions service:', error);
      return {
        status: false,
        data: [],
        message: error.message,
      };
    }
  }
}

module.exports = new BaseService();
