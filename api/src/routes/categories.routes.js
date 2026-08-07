const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types } = mongoose;
const Category = require('../models/category.model');
const Item = require('../models/item.model');
const Branch = require('../models/branch.model');

const categoriesController = require('../controllers/categories.controller');

const resolveObjectId = (value) => {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveObjectId(entry);
      if (resolved) return resolved;
    }
    return null;
  }

  if (Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Attempt to parse JSON array
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            const resolved = resolveObjectId(entry);
            if (resolved) {
              return resolved;
            }
          }
        }
      } catch {
        const splitValues = trimmed.split(',').map((item) => item.trim());
        for (const entry of splitValues) {
          const resolved = resolveObjectId(entry);
          if (resolved) {
            return resolved;
          }
        }
      }
    }

    if (Types.ObjectId.isValid(trimmed)) {
      return new Types.ObjectId(trimmed);
    }
  }

  if (typeof value === 'object') {
    if (value._id && Types.ObjectId.isValid(value._id)) {
      return new Types.ObjectId(value._id);
    }
    if (value.id && Types.ObjectId.isValid(value.id)) {
      return new Types.ObjectId(value.id);
    }
    if (value.$oid && Types.ObjectId.isValid(value.$oid)) {
      return new Types.ObjectId(value.$oid);
    }
  }

  if (typeof value === 'string' && Types.ObjectId.isValid(value.trim())) {
    return new Types.ObjectId(value.trim());
  }

  return null;
};

const resolveLicenseId = (req) =>
  resolveObjectId([
    req.query?.license,
    req.query?.license_id,
    req.body?.license,
    req.body?.license_id,
    req.user?.license,
    req.user?.license_id,
    req.user?.license?._id,
  ]);

const resolveBranchCandidates = (req) => {
  const branchAccess =
    Array.isArray(req.user?.branch_access) && req.user.branch_access.length
      ? req.user.branch_access
      : [];

  return [
    req.query?.branch_id,
    req.query?.branch,
    req.query?.branch?.id,
    req.query?.branch?._id,
    req.query?.['branch_id[]'],
    req.body?.branch_id,
    req.body?.branch,
    req.body?.['branch_id[]'],
    req.user?.branch_id,
    req.user?.branch,
    req.user?.branch?._id,
    req.user?.branch?.id,
    req.user?.default_branch_id,
    req.user?.settings?.branch_id,
    req.user?.settings?.branch,
    ...branchAccess.map(
      (entry) => entry?.branch_id || entry?.branch?._id || entry?.branch || entry?._id || entry?.id
    ),
  ];
};

const findFallbackBranchId = async (req) => {
  const licenseId = resolveLicenseId(req);
  const query = licenseId ? { license: licenseId } : {};
  const branchDoc = await Branch.findOne(query).select('_id').lean();
  return branchDoc?._id ? new Types.ObjectId(branchDoc._id) : null;
};

const resolveBranchId = async (req) => {
  const branchId = resolveObjectId(resolveBranchCandidates(req));
  if (branchId) {
    return branchId;
  }
  return await findFallbackBranchId(req);
};

/**
 * Detail URLs used by the legacy frontend do not include branch_id. The list
 * URL does, so the UI can display a category from a selected branch while the
 * persisted session still points at another accessible branch. Resolve the
 * detail scope from the authenticated user's branch access and pair each ID
 * with the authoritative branch name from the branches collection.
 */
const findAccessibleCategory = async (req, categoryId) => {
  const license = resolveObjectId(
    req.tenantContext?.licenseId || req.user?.license || req.user?.license_id
  );
  if (!license) return null;

  const candidates = [
    req.tenantContext?.branchId,
    req.user?.branch_id,
    req.user?.default_branch_id,
    ...(Array.isArray(req.user?.branch_access)
      ? req.user.branch_access.map((entry) => entry?.branch_id || entry?._id)
      : []),
  ];
  const branchIds = candidates
    .map(resolveObjectId)
    .filter(Boolean)
    .filter(
      (value, index, values) =>
        values.findIndex((other) => other.toString() === value.toString()) === index
    );
  if (!branchIds.length) return null;

  const branches = await Branch.find({
    _id: { $in: branchIds },
    license,
  })
    .select('_id branch_name')
    .lean();
  if (!branches.length) return null;

  return Category.findOne({
    _id: categoryId,
    license,
    $or: branches.map((branch) => ({
      branch_id: branch._id,
      branch_name: String(branch.branch_name || '').trim(),
    })),
  }).lean();
};
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  validateCreateCategory,
  validateUpdateCategory,
  validateCategoryId,
  validateBulkDelete,
  validateSearch,
  validateImport,
} = require('../middleware/categories.validation');

// Apply authentication middleware to all routes
router.use(protect);

// GET /api/categories - Get all categories with pagination and filters (PHP-compatible)
router.get('/', validateSearch, async (req, res) => {
  return categoriesController.getAll(req, res);
});

// GET /api/categories/options - Get category options for dropdown
router.get('/options', async (req, res) => {
  try {
    const categories = await Category.find({
      branch_id: req.user.branch_id,
      is_active: true,
    })
      .select('_id name')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category options',
      error: error.message,
    });
  }
});

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', async (req, res) => {
  return categoriesController.getDataChanges(req, res);
});

// PHP: categoriesImport() - Bulk import
router.post('/categoriesImport', validateImport, async (req, res) => {
  return categoriesController.categoriesImport(req, res);
});

// PHP: exportCategories() - Excel export
router.post('/exportCategories', async (req, res) => {
  return categoriesController.exportCategories(req, res);
});

// PHP: uploadCategoryImage() - Upload image
router.post('/uploadCategoryImage', upload.single('ImageCategory'), async (req, res) => {
  return categoriesController.uploadCategoryImage(req, res);
});

// PHP: categoryImageDelete() - Delete category image
router.delete('/categoryImageDelete', async (req, res) => {
  return categoriesController.categoryImageDelete(req, res);
});

// Legacy AJAX route for autocomplete (matches PHP path)
router.get('/getCategoryAjaxList', async (req, res) => {
  return categoriesController.getCategoryAjaxList(req, res);
});

// Legacy route: GET /categories/getCategoriesWithValidItems
router.get('/getCategoriesWithValidItems', async (req, res) => {
  return categoriesController.getCategoriesWithValidItems(req, res);
});

// Legacy bulk delete endpoint: DELETE /categories/delete
// Frontend sends: { data: [id1, id2, ...] }
router.delete('/delete', validateBulkDelete, async (req, res) => {
  return categoriesController.bulkDelete(req, res);
});

// Legacy: GET /categories/getCategoryDetails?id=... - used by edit form
router.get('/getCategoryDetails', async (req, res) => {
  try {
    const id = req.query.id;

    if (!id) {
      return categoriesController.error(res, 'Category Id Not Found', 400);
    }

    const category = await findAccessibleCategory(req, id);

    if (!category) {
      return categoriesController.error(res, 'Category not found', 404);
    }

    // Match legacy PHP getCategoryDetails -> getOne('no') shape
    return categoriesController.success(res, category, 'success');
  } catch (error) {
    return categoriesController.error(res, 'Error retrieving category: ' + error.message, 500);
  }
});

// GET /categories/:id - Get category by ID (PHP-compatible response)
router.get('/:id', validateCategoryId, async (req, res) => {
  try {
    const category = await findAccessibleCategory(req, req.params.id);

    if (!category) {
      return categoriesController.error(res, 'Category not found', 404);
    }

    // Match legacy PHP shape: { type: 'success', message: 'success', data: {...} }
    return categoriesController.success(res, category, 'success');
  } catch (error) {
    return categoriesController.error(res, 'Error retrieving category: ' + error.message, 500);
  }
});

// POST /api/categories - Create new category (PHP-compatible response)
router.post('/', validateCreateCategory, async (req, res) => {
  // Delegate to CategoriesController.create so we reuse validation,
  // branch resolution, and PHP-style { type, message, data } responses
  return categoriesController.create(req, res);
});

// PUT /api/categories/:id - Update category
router.put('/:id', validateUpdateCategory, async (req, res) => {
  // Delegate to CategoriesController.update so we reuse validation,
  // branch resolution, uniqueness checks, and PHP-style { type, message, data } responses
  return categoriesController.update(req, res);
});

// PATCH /api/categories/:id/toggle-status - Toggle category status
router.patch('/:id/toggle-status', validateCategoryId, async (req, res) => {
  try {
    const { branch_id } = await categoriesController.resolveBranchContext(req);
    if (!branch_id) {
      return categoriesController.error(res, 'Branch context is required', 400);
    }

    const category = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        branch_id,
      },
      [
        {
          $set: {
            is_active: { $not: '$is_active' },
            updated_by: req.user.id,
            updated_date: new Date(),
          },
        },
      ],
      { new: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
      });
    }

    res.status(200).json({
      success: true,
      message: `Category ${category.is_active ? 'activated' : 'deactivated'} successfully`,
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update category status',
      error: error.message,
    });
  }
});

// DELETE /api/categories/:id - Soft delete category
router.delete('/:id', validateCategoryId, async (req, res) => {
  try {
    const { branch_id } = await categoriesController.resolveBranchContext(req);
    if (!branch_id) {
      return categoriesController.error(res, 'Branch context is required', 400);
    }

    const category = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        branch_id,
      },
      {
        $set: {
          is_active: false,
          updated_by: req.user.id,
          updated_date: new Date(),
        },
      },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found or already deleted',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
      data: category,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete category',
      error: error.message,
    });
  }
});

module.exports = router;
