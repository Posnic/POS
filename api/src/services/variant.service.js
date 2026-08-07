/**
 * Variants Service
 * Business logic layer for variants module
 */

const variantsRepository = require('../repositories/variant.repository');
const {
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
  RESPONSE_TYPES,
  DEFAULT_VALUES,
} = require('../constants/variants.constants');

class VariantsService {
  /**
   * Format variant document to legacy-friendly shape
   */
  formatVariant(variant) {
    if (!variant) return null;

    const rawFields =
      Array.isArray(variant.fields) && variant.fields.length
        ? variant.fields
        : Array.isArray(variant.product_type)
          ? variant.product_type
          : [];

    const fields = rawFields
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          const name = entry.trim();
          return name ? { name } : null;
        }
        if (typeof entry === 'object' && entry.name) {
          return { name: String(entry.name).trim() };
        }
        return null;
      })
      .filter(Boolean);

    const product_type = fields.map((f) => f.name);

    return {
      _id: variant._id?.toString?.() || variant._id,
      name: variant.name || '',
      fields,
      product_type,
      description: variant.description || '',
      created_date: variant.created_date || variant.createdAt,
      updated_date: variant.updated_date || variant.updatedAt,
    };
  }

  /**
   * Parse filters from query string or object
   */
  parseFilters(rawFilters) {
    if (!rawFilters) return {};

    if (typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
      return rawFilters;
    }

    if (typeof rawFilters === 'string') {
      const trimmed = rawFilters.trim();
      if (!trimmed) return {};

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        return {};
      }
    }

    return {};
  }

  /**
   * Parse legacy date format
   */
  parseLegacyDate(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Build query from parsed filters
   */
  buildQueryFromFilters(parsedFilters) {
    const query = {};

    // Date range on updated_date
    if (parsedFilters.updated_date && typeof parsedFilters.updated_date === 'object') {
      const { $gte, $lte } = parsedFilters.updated_date;
      const dateFilter = {};
      const from = this.parseLegacyDate($gte);
      const to = this.parseLegacyDate($lte);
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;
      if (Object.keys(dateFilter).length) {
        query.updated_date = dateFilter;
      }
    }

    // Date range on created_date
    if (parsedFilters.created_date && typeof parsedFilters.created_date === 'object') {
      const { $gte, $lte } = parsedFilters.created_date;
      const createdFilter = {};
      const from = this.parseLegacyDate($gte);
      const to = this.parseLegacyDate($lte);
      if (from) createdFilter.$gte = from;
      if (to) createdFilter.$lte = to;
      if (Object.keys(createdFilter).length) {
        query.created_date = createdFilter;
      }
    }

    // Name filter
    if (parsedFilters.name) {
      if (typeof parsedFilters.name === 'object' && parsedFilters.name.$regex) {
        query.name = {
          $regex: parsedFilters.name.$regex,
          $options: parsedFilters.name.$options || 'i',
        };
      } else if (typeof parsedFilters.name === 'string' && parsedFilters.name.trim()) {
        query.name = {
          $regex: parsedFilters.name.trim(),
          $options: 'i',
        };
      }
    }

    // Copy any remaining simple filters
    Object.entries(parsedFilters || {}).forEach(([key, value]) => {
      if (['name', 'updated_date', 'created_date'].includes(key) || value === undefined) {
        return;
      }
      if (query[key] === undefined) {
        query[key] = value;
      }
    });

    return query;
  }

  /**
   * Get all variants with pagination
   * Matches PHP: getAll() + variantPage()
   */
  async getAllVariants(queryParams, branch_id = null) {
    try {
      const { page = 1, limit = 5, sort = '_id', order = 'desc', filters } = queryParams;

      const pageNumber = Number(page) > 0 ? Number(page) : 1;
      const limitNumber = Number(limit) > 0 ? Number(limit) : 5;

      const parsedFilters = this.parseFilters(filters);
      const query = this.buildQueryFromFilters(parsedFilters);

      // Add branch_id filter matching PHP: $filters['branch_id'] = self::$currentBranch;
      if (branch_id) {
        query.branch_id = branch_id;
      }

      const result = await variantsRepository.findAll(query, {
        page: pageNumber,
        limit: limitNumber,
        sort: sort || '_id',
        order: order || 'desc',
      });

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANTS_RETRIEVED,
        data: {
          total: result.total,
          total_pages: result.totalPages,
          current_page: result.page,
          per_page: result.limit,
          list: result.variants.map((v) => this.formatVariant(v)),
        },
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_RETRIEVE_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Get single variant by ID
   * Matches PHP: getOne()
   */
  async getVariantById(id) {
    try {
      const variant = await variantsRepository.findById(id);

      if (!variant) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_NOT_FOUND,
          data: null,
        };
      }

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANT_RETRIEVED,
        data: this.formatVariant(variant),
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_LOAD_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Create a new variant
   * Matches PHP: add() / variantInsertUpdate() insert
   */
  async createVariant(data, branch_id = null, branch_name = '') {
    try {
      const { name, product_type = [], description } = data;

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_NAME_REQUIRED,
          data: null,
        };
      }

      const rawTypes = Array.isArray(product_type) ? product_type : [];
      const fields = rawTypes
        .map((val) => (val != null ? String(val).trim() : ''))
        .filter(Boolean)
        .map((val) => ({ name: val }));

      if (!fields.length) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_VALUE_REQUIRED,
          data: null,
        };
      }

      // Check for duplicate name in same branch (matches PHP line 43-46)
      const exists = await variantsRepository.existsByName(trimmedName, null, branch_id);
      if (exists) {
        return {
          status: 'exist',
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_EXISTS,
          data: null,
        };
      }

      const variantData = {
        name: trimmedName,
        fields,
        description: description ? String(description).trim() : DEFAULT_VALUES.DESCRIPTION,
        branch_id: branch_id,
        branch_name: branch_name,
      };

      const variant = await variantsRepository.create(variantData);

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANT_CREATED,
        data: variant._id?.toString?.() || variant._id,
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_CREATE_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Update a variant
   * Matches PHP: edit() / variantInsertUpdate() update
   */
  async updateVariant(id, data, branch_id = null) {
    try {
      const { name, product_type = [], description } = data;

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_NAME_REQUIRED,
          data: null,
        };
      }

      const rawTypes = Array.isArray(product_type) ? product_type : [];
      const fields = rawTypes
        .map((val) => (val != null ? String(val).trim() : ''))
        .filter(Boolean)
        .map((val) => ({ name: val }));

      if (!fields.length) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_VALUE_REQUIRED,
          data: null,
        };
      }

      // Check for duplicate name in same branch (excluding current variant)
      const exists = await variantsRepository.existsByName(trimmedName, id, branch_id);
      if (exists) {
        return {
          status: 'exist',
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_EXISTS,
          data: null,
        };
      }

      const updateData = {
        name: trimmedName,
        fields,
        description: description ? String(description).trim() : DEFAULT_VALUES.DESCRIPTION,
      };

      // Verify variant belongs to user's branch before updating
      const variant = await variantsRepository.update(id, updateData, branch_id);

      if (!variant) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_NOT_FOUND,
          data: null,
        };
      }

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANT_UPDATED,
        data: this.formatVariant(variant.toObject ? variant.toObject() : variant),
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_UPDATE_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Delete a variant
   */
  async deleteVariant(id, branch_id = null) {
    try {
      // Verify variant belongs to user's branch before deleting
      const variant = await variantsRepository.delete(id, branch_id);

      if (!variant) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.VARIANT_NOT_FOUND,
          data: null,
        };
      }

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANT_DELETED,
        data: null,
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_DELETE_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Delete multiple variants
   * Matches PHP: delete()
   */
  async deleteVariants(ids, branch_id = null) {
    try {
      if (!Array.isArray(ids) || !ids.length) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.UID_MISSING,
          data: null,
        };
      }

      // Verify variants belong to user's branch before deleting
      const result = await variantsRepository.deleteMany(ids, branch_id);

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANTS_DELETED,
        data: result.deletedCount,
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_NOT_DELETED,
        error: error.message,
      };
    }
  }

  /**
   * Get variants for AJAX autocomplete
   * Matches PHP: getVariantsAjaxList()
   */
  async getVariantsAjaxList(query, branchId = null) {
    try {
      const variants = await variantsRepository.findForAutocomplete(query, branchId);

      const suggestions = variants.map((variant) => ({
        id: variant._id?.toString(),
        name: variant.name,
        fields: variant.fields || [],
      }));

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANTS_RETRIEVED,
        data: { query, suggestions },
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_SUGGESTIONS_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Export variants
   * Matches PHP: exportVariants()
   */
  async exportVariants(ids, branch_id = null) {
    try {
      if (!Array.isArray(ids) || !ids.length) {
        return {
          status: false,
          type: RESPONSE_TYPES.ERROR,
          message: ERROR_MESSAGES.NO_VARIANTS_SELECTED,
          data: null,
        };
      }

      // Filter by branch to only export variants from user's branch
      const variants = await variantsRepository.findByIdsForExport(ids, branch_id);

      const rows = variants.map((variant) => ({
        name: variant.name || '',
        fields: Array.isArray(variant.fields)
          ? variant.fields
              .map((f) => (f && f.name ? String(f.name).trim() : ''))
              .filter(Boolean)
              .join(', ')
          : '',
        description: variant.description || '',
      }));

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANTS_EXPORTED,
        data: rows,
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANTS_EXPORT_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Get variants by field
   */
  async getVariantsByField(fieldName) {
    try {
      const variants = await variantsRepository.findByField(fieldName);

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANTS_RETRIEVED,
        data: variants.map((v) => this.formatVariant(v)),
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANTS_BY_FIELD_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Search variants
   */
  async searchVariants(searchQuery, limit = 20) {
    try {
      const variants = await variantsRepository.search(searchQuery, limit);

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.SEARCH_RESULTS_RETRIEVED,
        data: variants.map((v) => this.formatVariant(v)),
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANTS_SEARCH_FAILED,
        error: error.message,
      };
    }
  }

  /**
   * Get variant statistics
   */
  async getVariantStats() {
    try {
      const total = await variantsRepository.count();

      return {
        status: true,
        type: RESPONSE_TYPES.SUCCESS,
        message: SUCCESS_MESSAGES.VARIANT_STATS_RETRIEVED,
        data: { total },
      };
    } catch (error) {
      return {
        status: false,
        type: RESPONSE_TYPES.ERROR,
        message: ERROR_MESSAGES.VARIANT_STATS_FAILED,
        error: error.message,
      };
    }
  }
}

module.exports = new VariantsService();
