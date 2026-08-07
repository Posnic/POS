const { searchPattern } = require('../utils/safe-search');
const Variant = require('../models/variant.model');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const { createActivityLog } = require('../utils/activityLogger');

const escapeRegExp = (str = '') => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tenantQuery = (req) =>
  req.tenantContext
    ? {
        branch_id: req.tenantContext.branchId,
        branch_name: req.tenantContext.branchName,
        license: req.tenantContext.licenseId,
      }
    : {};

const findTenantVariant = (req, id) =>
  req.tenantContext ? Variant.findOne({ _id: id, ...tenantQuery(req) }) : Variant.findById(id);

const deleteTenantVariant = (req, id) =>
  req.tenantContext
    ? Variant.findOneAndDelete({ _id: id, ...tenantQuery(req) })
    : Variant.findByIdAndDelete(id);

// Normalize variant document to legacy-friendly shape
const formatVariant = (variant = {}) => {
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
};

const sendSuccess = (res, data, message = 'Operation completed successfully', status = 200) => {
  res.status(status).json({
    success: true,
    type: 'success',
    message,
    data,
  });
};

const sendError = (res, message, status = 500, errors = null) => {
  res.status(status).json({
    success: false,
    type: 'error',
    message,
    errors,
  });
};

// Best-effort wrapper so logging failures never break core flows
const safeCreateActivityLog = async (payload) => {
  if (typeof createActivityLog !== 'function') {
    console.error(
      'createActivityLog is not a function; skipping activity logging for',
      payload?.entity
    );
    return;
  }
  try {
    await createActivityLog(payload);
  } catch (error) {
    console.error('Error logging activity:', error);
  }
};

class VariantControllerV2 {
  // GET /variants
  static async getAll(req, res) {
    try {
      const {
        page = 1,
        limit = 5,
        // PHP: $options = ['limit' => $limit, 'page' => $page, 'sort' => ['_id' => -1]]
        // so default to newest first when the frontend does not specify
        // custom sorting.
        sort = '_id',
        order = 'desc',
        filters,
      } = req.query;

      const pageNumber = Number(page) > 0 ? Number(page) : 1;
      const limitNumber = Number(limit) > 0 ? Number(limit) : 5;

      const query = tenantQuery(req);

      // Parse legacy filters JSON
      let parsedFilters = {};
      if (filters) {
        if (typeof filters === 'string') {
          const trimmed = filters.trim();
          if (trimmed) {
            try {
              parsedFilters = JSON.parse(trimmed);
            } catch (e) {
              return sendError(res, 'Incorrect format of filter', 404, e.message);
            }
          }
        } else if (typeof filters === 'object' && !Array.isArray(filters)) {
          parsedFilters = filters;
        }
      }

      const parseLegacyDate = (value) => {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const d = new Date(trimmed);
        return Number.isNaN(d.getTime()) ? null : d;
      };

      if (parsedFilters.updated_date && typeof parsedFilters.updated_date === 'object') {
        const { $gte, $lte } = parsedFilters.updated_date;
        const dateFilter = {};
        const from = parseLegacyDate($gte);
        const to = parseLegacyDate($lte);
        if (from) dateFilter.$gte = from;
        if (to) dateFilter.$lte = to;
        if (Object.keys(dateFilter).length) query.updated_date = dateFilter;
      }

      if (parsedFilters.created_date && typeof parsedFilters.created_date === 'object') {
        const { $gte, $lte } = parsedFilters.created_date;
        const createdFilter = {};
        const from = parseLegacyDate($gte);
        const to = parseLegacyDate($lte);
        if (from) createdFilter.$gte = from;
        if (to) createdFilter.$lte = to;
        if (Object.keys(createdFilter).length) query.created_date = createdFilter;
      }

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

      Object.entries(parsedFilters || {}).forEach(([key, value]) => {
        if (['name', 'updated_date', 'created_date'].includes(key)) return;
        if (value === undefined) return;
        if (query[key] === undefined) query[key] = value;
      });

      const sortField = typeof sort === 'string' && sort.trim() ? sort : '_id';
      const sortOptions = { [sortField]: order === 'desc' ? -1 : 1 };

      const count = await Variant.countDocuments(query);
      const result = await Variant.find(query)
        .sort(sortOptions)
        .limit(limitNumber)
        .skip((pageNumber - 1) * limitNumber)
        .lean();

      const payload = {
        total: count,
        total_pages: Math.ceil(count / limitNumber) || 0,
        current_page: pageNumber,
        per_page: limitNumber,
        list: result.map(formatVariant),
      };

      return sendSuccess(res, payload, 'Variants retrieved successfully');
    } catch (error) {
      return sendError(
        res,
        'Failed to retrieve variants. Please try again later.',
        500,
        error.message
      );
    }
  }

  // GET /variants/:id
  static async getOne(req, res) {
    try {
      const variant = await findTenantVariant(req, req.params.id);
      if (!variant) return sendError(res, 'Variant not found', 404);
      return sendSuccess(res, formatVariant(variant), 'Variant retrieved successfully');
    } catch (error) {
      return sendError(res, 'Unable to load variant. Please try again later.', 500, error.message);
    }
  }

  // POST /variants
  static async create(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Validation failed', 400, errors.array());
      }

      const { name, product_type = [], description } = req.body || {};
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return sendError(res, 'Variant name is required', 400);
      }

      const rawTypes = Array.isArray(product_type) ? product_type : [];
      const fields = rawTypes
        .map((val) => (val != null ? String(val).trim() : ''))
        .filter(Boolean)
        .map((val) => ({ name: val }));

      if (!fields.length) {
        return sendError(res, 'At least one variant value is required', 400);
      }

      const existing = await Variant.findOne({
        ...tenantQuery(req),
        name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
      }).lean();
      if (existing) {
        return sendError(res, 'This variant details already exist in our system', 406);
      }

      const variant = new Variant({
        ...tenantQuery(req),
        name: trimmedName,
        fields,
        description: description ? String(description).trim() : '',
      });
      await variant.save();

      await safeCreateActivityLog({
        action: 'CREATE',
        entity: 'Variant',
        entityId: variant._id,
        description: `Variant ${variant.name} created`,
        user: req.user?._id,
      });

      return sendSuccess(
        res,
        variant._id?.toString?.() || variant._id,
        'variant added successfully',
        201
      );
    } catch (error) {
      return sendError(
        res,
        'Failed to create variant. Please try again later.',
        500,
        error.message
      );
    }
  }

  // PUT /variants/:id
  static async update(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 'Validation failed', 400, errors.array());
      }

      const { id } = req.params;
      const { name, product_type = [], description } = req.body || {};

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendError(res, 'Invalid variant ID', 400);
      }

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return sendError(res, 'Variant name is required', 400);
      }

      const rawTypes = Array.isArray(product_type) ? product_type : [];
      const fields = rawTypes
        .map((val) => (val != null ? String(val).trim() : ''))
        .filter(Boolean)
        .map((val) => ({ name: val }));

      if (!fields.length) {
        return sendError(res, 'At least one variant value is required', 400);
      }

      const existing = await Variant.findOne({
        ...tenantQuery(req),
        _id: { $ne: new mongoose.Types.ObjectId(id) },
        name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i'),
      }).lean();
      if (existing) {
        return sendError(res, 'This variant details already exist in our system', 406);
      }

      const variant = await findTenantVariant(req, id);
      if (!variant) return sendError(res, 'Variant not found', 404);

      variant.name = trimmedName;
      variant.description = description ? String(description).trim() : '';
      variant.fields = fields;
      variant.updated_date = new Date();

      await variant.save();

      await safeCreateActivityLog({
        action: 'UPDATE',
        entity: 'Variant',
        entityId: variant._id,
        description: `Variant ${variant.name} updated`,
        user: req.user?._id,
        changes: req.body,
      });

      return sendSuccess(
        res,
        formatVariant(variant.toObject ? variant.toObject() : variant),
        'variant updated successfully'
      );
    } catch (error) {
      return sendError(
        res,
        'Failed to update variant. Please try again later.',
        500,
        error.message
      );
    }
  }

  // DELETE /variants/:id
  static async remove(req, res) {
    try {
      const variant = await deleteTenantVariant(req, req.params.id);
      if (!variant) return sendError(res, 'Variant not found', 404);

      await safeCreateActivityLog({
        action: 'DELETE',
        entity: 'Variant',
        entityId: variant._id,
        description: `Variant ${variant.name} deleted`,
        user: req.user?._id,
      });

      return sendSuccess(res, null, 'Variant deleted successfully');
    } catch (error) {
      return sendError(
        res,
        'Failed to delete variant. Please try again later.',
        500,
        error.message
      );
    }
  }

  // Legacy bulk delete: DELETE /variants/delete with { data: [ids] }
  static async legacyDelete(req, res) {
    try {
      const ids = Array.isArray(req.body?.data) ? req.body.data : [];
      if (!ids.length) return sendError(res, 'UID is missing', 400);

      const objectIds = ids
        .filter((id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (!objectIds.length) {
        return sendError(res, 'Invalid ID format', 400, ids);
      }

      const result = await Variant.deleteMany({ _id: { $in: objectIds }, ...tenantQuery(req) });

      await safeCreateActivityLog({
        action: 'BULK_DELETE',
        entity: 'Variant',
        description: `${result.deletedCount} variants deleted`,
        user: req.user?._id,
      });

      return sendSuccess(res, result.deletedCount, 'variant deleted successfully');
    } catch (error) {
      return sendError(res, 'variant Not deleted: ' + error.message, 500);
    }
  }

  // Legacy AJAX endpoint
  static async getVariantsAjaxList(req, res) {
    try {
      const query = (req.query.query || '').trim();
      const filter = {
        ...tenantQuery(req),
        ...(query ? { name: { $regex: searchPattern(query), $options: 'i' } } : {}),
      };

      const variants = await Variant.find(filter).select('name fields').limit(20).lean();

      const suggestions = variants.map((variant) => ({
        id: variant._id?.toString(),
        name: variant.name,
        fields: variant.fields || [],
      }));

      return sendSuccess(
        res,
        {
          query,
          suggestions,
        },
        'Variants retrieved successfully'
      );
    } catch (error) {
      return sendError(res, 'Failed to load variant suggestions.', 500, error.message);
    }
  }

  // PHP: getVariantDetails() - used by edit form
  static async getVariantDetails(req, res) {
    try {
      const id = req.query.id || req.params.id;
      if (!id) return sendError(res, 'Variant Id Not Found', 400);

      const variant = await findTenantVariant(req, id);
      if (!variant) return sendError(res, 'Variant not found', 404);

      return sendSuccess(res, formatVariant(variant), 'Variant details retrieved successfully');
    } catch (error) {
      return sendError(
        res,
        'Unable to load variant details. Please try again later.',
        500,
        error.message
      );
    }
  }

  // POST /variants/exportVariants
  static async exportVariants(req, res) {
    try {
      const rawBody = req.body;

      const extractIds = (body) => {
        if (!body) return [];
        if (Array.isArray(body)) return body;
        if (Array.isArray(body.data)) return body.data;

        if (typeof body.data === 'string') {
          const trimmed = body.data.trim();
          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // ignore
            }
          }
        }

        if (typeof body === 'string') {
          const trimmed = body.trim();
          if (!trimmed) return [];
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }

        const values = Object.values(body);
        if (values.length === 1 && typeof values[0] === 'string' && values[0].trim()) {
          const candidate = values[0].trim();
          try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // ignore
          }
        }

        // Fallback: body may be an object like {"0": "id1", "1": "id2"}
        // when arrays are encoded differently. In that case, treat all
        // string values as IDs.
        if (values.length > 0 && values.every((v) => typeof v === 'string')) {
          return values;
        }

        return [];
      };

      const ids = extractIds(rawBody);
      if (!Array.isArray(ids) || !ids.length) {
        return sendError(res, 'No variants selected for export', 400);
      }

      const objectIds = ids
        .filter((id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (!objectIds.length) {
        return sendError(res, 'Invalid ID format', 400, ids);
      }

      const variants = await Variant.find({ _id: { $in: objectIds }, ...tenantQuery(req) })
        .sort({ _id: -1 })
        .select('name fields description')
        .lean();

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

      return sendSuccess(res, rows, 'Variants Exported Successfully');
    } catch (error) {
      return sendError(
        res,
        'Failed to export variants. Please try again later.',
        500,
        error.message
      );
    }
  }

  // GET /variants/field/:field
  static async getByField(req, res) {
    try {
      const { field } = req.params;
      const variants = await Variant.find({
        ...tenantQuery(req),
        'fields.name': field,
      })
        .sort({ name: 1 })
        .lean();

      return sendSuccess(res, variants.map(formatVariant), 'Variants retrieved successfully');
    } catch (error) {
      return sendError(res, 'Failed to retrieve variants by field.', 500, error.message);
    }
  }

  // GET /variants/stats
  static async getStats(req, res) {
    try {
      const totalVariants = await Variant.countDocuments(tenantQuery(req));
      const stats = {
        total: totalVariants,
      };
      return sendSuccess(res, stats, 'Variant statistics retrieved successfully');
    } catch (error) {
      return sendError(res, 'Failed to retrieve variant statistics.', 500, error.message);
    }
  }

  // GET /variants/search?q=...
  static async search(req, res) {
    try {
      const { q, limit = 20 } = req.query;
      if (!q || q.trim().length < 2) {
        return sendError(res, 'Search query must be at least 2 characters', 400);
      }

      const variants = await Variant.find({
        ...tenantQuery(req),
        $or: [
          { name: { $regex: searchPattern(q), $options: 'i' } },
          { description: { $regex: searchPattern(q), $options: 'i' } },
        ],
      })
        .limit(parseInt(limit, 10))
        .lean();

      return sendSuccess(res, variants.map(formatVariant), 'Search results retrieved successfully');
    } catch (error) {
      return sendError(res, 'Failed to search variants.', 500, error.message);
    }
  }

  // POST /variants/bulk-delete { ids: [...] }
  static async bulkDelete(req, res) {
    try {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) {
        return sendError(res, 'No variant IDs provided', 400);
      }

      const objectIds = ids
        .filter((id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (!objectIds.length) {
        return sendError(res, 'Invalid ID format', 400, ids);
      }

      const result = await Variant.deleteMany({ _id: { $in: objectIds }, ...tenantQuery(req) });

      await safeCreateActivityLog({
        action: 'BULK_DELETE',
        entity: 'Variant',
        description: `${result.deletedCount} variants deleted`,
        user: req.user?._id,
      });

      return sendSuccess(res, { deleted: result.deletedCount }, 'Variants deleted successfully');
    } catch (error) {
      return sendError(res, 'Failed to delete variants.', 500, error.message);
    }
  }
}

module.exports = {
  getAll: VariantControllerV2.getAll,
  getOne: VariantControllerV2.getOne,
  create: VariantControllerV2.create,
  update: VariantControllerV2.update,
  delete: VariantControllerV2.remove,
  legacyDelete: VariantControllerV2.legacyDelete,
  getVariantsAjaxList: VariantControllerV2.getVariantsAjaxList,
  getVariantDetails: VariantControllerV2.getVariantDetails,
  exportVariants: VariantControllerV2.exportVariants,
  getByField: VariantControllerV2.getByField,
  getStats: VariantControllerV2.getStats,
  search: VariantControllerV2.search,
  bulkDelete: VariantControllerV2.bulkDelete,
};
