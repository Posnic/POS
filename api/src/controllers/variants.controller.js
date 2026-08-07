/**
 * Variants Controller
 * Following layered architecture: Routes -> Controller -> Service -> Repository -> Model
 */

const variantsService = require('../services/variant.service');
const { createActivityLog } = require('../utils/activityLogger');
const { HTTP_STATUS, RESPONSE_TYPES } = require('../constants/variants.constants');
const { Types } = require('mongoose');
const Branch = require('../models/branch.model');

// Best-effort wrapper for activity logging
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

// Helper to resolve branch ID from various sources
const resolveBranchIdCandidate = (value) => {
  if (!value) return null;

  const asObjectId = (candidate) => {
    if (!candidate) return null;
    if (Types.ObjectId.isValid(candidate)) {
      return candidate.toString(); // Return string for consistency
    }
    return null;
  };

  const directObjectId = asObjectId(value);
  if (directObjectId) {
    return directObjectId;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveBranchIdCandidate(entry);
      if (resolved) return resolved;
    }
    return null;
  }

  if (typeof value === 'object' && value._id) {
    return asObjectId(value._id);
  }

  if (typeof value === 'object' && value.id) {
    return asObjectId(value.id);
  }

  return null;
};

// Comprehensive branch context resolution
const resolveBranchContext = async (req) => {
  if (req.tenantContext?.branchId) {
    return {
      branch_id: req.tenantContext.branchId.toString(),
      branch_name: req.tenantContext.branchName || '',
    };
  }

  const branchAccess = Array.isArray(req.user?.branch_access) ? req.user.branch_access : [];

  const branchCandidates = [
    req.session?.selectedBranchId,
    req.session?.branch_id,
    req.body?.branch_id,
    req.body?.branchId,
    req.body?.branch,
    req.body?.branch?._id,
    req.body?.branch?.id,
    req.query?.branch_id,
    req.query?.branch,
    req.query?.branch?._id,
    req.query?.branch?.id,
    req.user?.branch_id,
    req.user?.branch,
    req.user?.branch?._id,
    req.user?.branch?.id,
    req.user?.default_branch_id,
  ];

  let branch_id = null;
  for (const candidate of branchCandidates) {
    branch_id = resolveBranchIdCandidate(candidate);
    if (branch_id) break;
  }

  // Use branch_access as fallback if no branch found
  if (!branch_id) {
    for (const candidate of branchAccess) {
      branch_id = resolveBranchIdCandidate(candidate);
      if (branch_id) break;
    }
  }

  const branchNameCandidates = [
    req.session?.branch_name,
    req.body?.branch_name,
    req.body?.branch?.name,
    req.body?.branch?.branch_name,
    req.query?.branch_name,
    req.query?.branch?.name,
    req.query?.branch?.branch_name,
    req.user?.branch_name,
    req.user?.branch?.name,
    req.user?.branch?.branch_name,
    ...(branchAccess || []).map((entry) => entry?.branch_name),
  ];

  let branch_name =
    branchNameCandidates.find((name) => typeof name === 'string' && name.trim()) || '';

  // If branch_id exists but branch_name is empty, fetch from database
  // Matches PHP: trim($_SESSION['PosnicPro']['settings']['branch_name'])
  if (branch_id && !branch_name) {
    try {
      const branch = await (
        req.tenantContext
          ? Branch.findOne({ _id: branch_id, license: req.tenantContext.licenseId })
          : Branch.findById(branch_id)
      )
        .select('branch_name')
        .lean();
      if (branch?.branch_name) {
        branch_name = branch.branch_name.trim();
      }
    } catch (error) {
      console.error('Error fetching branch name:', error);
    }
  }

  return { branch_id, branch_name };
};

// Helper to extract IDs from various request body formats
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
  if (values.length > 0 && values.every((v) => typeof v === 'string')) {
    return values;
  }

  return [];
};

class VariantsController {
  /**
   * Get all variants with pagination
   * Matches PHP: getAll()
   */
  static async getAll(req, res) {
    try {
      // Extract branch_id from user session (matches PHP self::$currentBranch behavior)
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.getAllVariants(req.query, branch_id);

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          type: result.type,
          message: result.message,
          errors: result.error,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Get single variant by ID
   * Matches PHP: getOne()
   */
  static async getOne(req, res) {
    try {
      const id = req.params.id || req.query.id;
      const result = await variantsService.getVariantById(id);

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Get variant details
   * Matches PHP: getVariantDetails()
   */
  static async getVariantDetails(req, res) {
    try {
      const id = req.query.id || req.params.id;
      const result = await variantsService.getVariantById(id);

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Create new variant
   * Matches PHP: add()
   */
  static async create(req, res) {
    try {
      // Extract branch_id from user session using comprehensive resolver
      const { branch_id, branch_name } = await resolveBranchContext(req);

      const result = await variantsService.createVariant(req.body, branch_id, branch_name);

      if (result.status === true) {
        await safeCreateActivityLog({
          action: 'CREATE',
          entity: 'Variant',
          entityId: result.data,
          description: `Variant ${req.body.name} created`,
          user: req.user?._id,
        });

        return res.status(HTTP_STATUS.CREATED).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else if (result.status === 'exist') {
        return res.status(HTTP_STATUS.NOT_ACCEPTABLE).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      } else {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Update variant
   * Matches PHP: edit()
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      // Extract branch_id from user session for verification
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.updateVariant(id, req.body, branch_id);

      if (result.status === true) {
        await safeCreateActivityLog({
          action: 'UPDATE',
          entity: 'Variant',
          entityId: id,
          description: `Variant ${req.body.name} updated`,
          user: req.user?._id,
          changes: req.body,
        });

        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else if (result.status === 'exist') {
        return res.status(HTTP_STATUS.NOT_ACCEPTABLE).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      } else {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Delete single variant
   */
  static async delete(req, res) {
    try {
      const id = req.params.id || req.query.id;
      // Extract branch_id from user session for verification
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.deleteVariant(id, branch_id);

      if (result.status) {
        await safeCreateActivityLog({
          action: 'DELETE',
          entity: 'Variant',
          entityId: id,
          description: 'Variant deleted',
          user: req.user?._id,
        });

        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
        });
      } else {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Legacy bulk delete
   * Matches PHP: delete()
   */
  static async legacyDelete(req, res) {
    try {
      const ids = req.body?.data || [];
      // Extract branch_id from user session for verification
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.deleteVariants(ids, branch_id);

      if (result.status) {
        await safeCreateActivityLog({
          action: 'BULK_DELETE',
          entity: 'Variant',
          description: `${result.data} variants deleted`,
          user: req.user?._id,
        });

        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Bulk delete (new-style API)
   */
  static async bulkDelete(req, res) {
    try {
      const { ids } = req.body || {};
      // Extract branch_id from user session for verification
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.deleteVariants(ids, branch_id);

      if (result.status) {
        await safeCreateActivityLog({
          action: 'BULK_DELETE',
          entity: 'Variant',
          description: `${result.data} variants deleted`,
          user: req.user?._id,
        });

        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: { deleted: result.data },
        });
      } else {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Get variants for AJAX autocomplete
   * Matches PHP: getVariantsAjaxList()
   */
  static async getVariantsAjaxList(req, res) {
    try {
      const query = req.query.query || '';
      const branchId = req.query.branch_id || null;
      const result = await variantsService.getVariantsAjaxList(query, branchId);

      if (result.status) {
        // Legacy format: direct JSON response
        return res.json(result.data);
      } else {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Export variants
   * Matches PHP: exportVariants()
   */
  static async exportVariants(req, res) {
    try {
      const ids = extractIds(req.body);
      // Extract branch_id from user session for verification
      const { branch_id } = await resolveBranchContext(req);

      const result = await variantsService.exportVariants(ids, branch_id);

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Get variants by field
   */
  static async getByField(req, res) {
    try {
      const { field } = req.params;
      const result = await variantsService.getVariantsByField(field);

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Search variants
   */
  static async search(req, res) {
    try {
      const { q, limit = 20 } = req.query;
      const result = await variantsService.searchVariants(q, parseInt(limit, 10));

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Get variant statistics
   */
  static async getStats(req, res) {
    try {
      const result = await variantsService.getVariantStats();

      if (result.status) {
        return res.status(HTTP_STATUS.OK).json({
          success: true,
          type: result.type,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          type: result.type,
          message: result.message,
        });
      }
    } catch (error) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        type: RESPONSE_TYPES.ERROR,
        message: error.message,
      });
    }
  }
}

module.exports = VariantsController;
