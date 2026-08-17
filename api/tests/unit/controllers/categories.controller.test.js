/**
 * Unit tests for CategoriesController
 *
 * Methods covered:
 *   getAll, index, create, update, toggleStatus, getOptions,
 *   getCategoryAjaxList, getCategoriesWithValidItems, categoriesImport,
 *   exportCategories, deleteCategory, bulkDelete, delete,
 *   categoryImageDelete, uploadCategoryImage
 *
 * Mocked dependencies:
 *   CategoryService, Branch, BaseModel, base.service, express-validator, fs
 */

jest.mock('../../../src/services/category.service', () =>
  jest.fn().mockImplementation(() => ({
    getAllCategories: jest.fn(),
    getCategoryById: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn(),
    bulkDeleteCategories: jest.fn(),
    searchCategories: jest.fn(),
    getCategoriesByBranch: jest.fn(),
    getCategoriesWithItems: jest.fn(),
    getActiveCategories: jest.fn(),
    bulkImport: jest.fn(),
  }))
);

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
    async getCollection() {
      return { findOne: jest.fn().mockResolvedValue(null) };
    }
    async checkPlan() {
      return 0;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn(),
}));

const { validationResult } = require('express-validator');
const Branch = require('../../../src/models/branch.model');
const fs = require('fs');
const controller = require('../../../src/controllers/categories.controller');

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_ID = '507f1f77bcf86cd799439011';
const VALID_ID_2 = '60c72b2f9b1e8a001c8e4d2a';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const adminUser = () => ({
  _id: VALID_ID,
  username: 'admin',
  usertype: 'admin',
  branch_id: VALID_ID,
  branch_name: 'Main Branch',
  license: VALID_ID,
  settings: {},
});

const mockReq = (overrides = {}) => ({
  user: adminUser(),
  query: {},
  params: {},
  body: {},
  session: {
    selectedBranchId: VALID_ID,
    branch_name: 'Main Branch',
  },
  headers: {},
  protocol: 'http',
  get: jest.fn().mockReturnValue('localhost:3000'),
  ...overrides,
});

const noBranchReq = (extraOverrides = {}) =>
  mockReq({
    user: {
      ...adminUser(),
      branch_id: undefined,
      branch: undefined,
      default_branch_id: undefined,
      branch_access: undefined,
    },
    session: {},
    body: {},
    query: {},
    ...extraOverrides,
  });

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

let svc;

beforeEach(() => {
  jest.clearAllMocks();

  svc = {
    getAllCategories: jest.fn(),
    getCategoryById: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn(),
    bulkDeleteCategories: jest.fn(),
    searchCategories: jest.fn(),
    getCategoriesByBranch: jest.fn(),
    getCategoriesWithItems: jest.fn(),
    getActiveCategories: jest.fn(),
    bulkImport: jest.fn(),
  };
  controller.service = svc;

  controller.checkPermission = jest.fn().mockReturnValue(true);

  validationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });

  Branch.findById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  });

  fs.existsSync.mockReturnValue(false);
  fs.renameSync.mockImplementation(() => {});
});

// ─── getAll ─────────────────────────────────────────────────────────────────────

describe('getAll', () => {
  const paginatedResult = () => ({
    status: true,
    message: 'Categories retrieved successfully',
    data: {
      data: [{ _id: VALID_ID, name: 'Electronics', image: 'category.svg' }],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    },
  });

  test('returns 200 with paginated category list when service succeeds', async () => {
    svc.getAllCategories.mockResolvedValue(paginatedResult());
    const res = mockRes();
    await controller.getAll(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({
          list: expect.any(Array),
          total: 1,
          current_page: 1,
          per_page: 10,
          total_pages: 1,
        }),
      })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.getAll(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.getAllCategories).not.toHaveBeenCalled();
  });

  test('returns 400 when session has no selectedBranchId', async () => {
    const res = mockRes();
    await controller.getAll(
      mockReq({ session: {}, user: { ...adminUser(), branch_id: undefined } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('returns 400 when user has no license', async () => {
    const res = mockRes();
    await controller.getAll(
      mockReq({
        user: { ...adminUser(), license: undefined, license_id: undefined },
        session: { selectedBranchId: VALID_ID },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'License context is required' })
    );
  });

  test('passes search and status filters to service', async () => {
    svc.getAllCategories.mockResolvedValue(paginatedResult());
    const res = mockRes();
    await controller.getAll(
      mockReq({ query: { search: 'elec', status: 'active', page: '2', limit: '5' } }),
      res,
      jest.fn()
    );

    expect(svc.getAllCategories).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'elec', status: 'active' }),
      expect.objectContaining({ page: 2, limit: 5 })
    );
  });

  test('scopes the list to the active branch name, branch ID, and license', async () => {
    svc.getAllCategories.mockResolvedValue(paginatedResult());
    const res = mockRes();
    await controller.getAll(
      mockReq({
        query: { branch_id: VALID_ID_2 },
        body: { branch_id: VALID_ID_2 },
      }),
      res,
      jest.fn()
    );

    expect(svc.getAllCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        branch_id: VALID_ID,
        branch_name: 'Main Branch',
        license: VALID_ID,
      }),
      expect.any(Object)
    );
  });

  test('returns 400 when service returns status false', async () => {
    svc.getAllCategories.mockResolvedValue({ status: false, message: 'DB error', data: null });
    const res = mockRes();
    await controller.getAll(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB error' })
    );
  });

  test('normalizes category image to default when image is missing', async () => {
    svc.getAllCategories.mockResolvedValue({
      ...paginatedResult(),
      data: {
        data: [{ _id: VALID_ID, name: 'Electronics', image: null }],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });
    const res = mockRes();
    await controller.getAll(mockReq(), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.list[0].image).toBe('category.svg');
  });

  test('defaults page to 1 and limit to 10 when not provided', async () => {
    svc.getAllCategories.mockResolvedValue(paginatedResult());
    const res = mockRes();
    await controller.getAll(mockReq({ query: {} }), res, jest.fn());

    expect(svc.getAllCategories).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ page: 1, limit: 10 })
    );
  });
});

// ─── index ─────────────────────────────────────────────────────────────────────

describe('index', () => {
  const serviceResult = () => ({
    status: true,
    message: 'Categories retrieved successfully',
    data: {
      data: [
        {
          _id: VALID_ID,
          name: 'Beverages',
          image: 'category.svg',
          discount_amount: 0,
          discount_percentage: 0,
          is_active: true,
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    },
  });

  test('returns 200 with formatted category list', async () => {
    svc.getAllCategories.mockResolvedValue(serviceResult());
    const res = mockRes();
    await controller.index(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({
          list: expect.arrayContaining([expect.objectContaining({ name: 'Beverages' })]),
          total: 1,
        }),
      })
    );
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.index(noBranchReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('passes search and status query params to service', async () => {
    svc.getAllCategories.mockResolvedValue(serviceResult());
    const res = mockRes();
    await controller.index(
      mockReq({ query: { search: 'bev', status: 'inactive', page: '3', limit: '20' } }),
      res,
      jest.fn()
    );

    expect(svc.getAllCategories).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'bev', status: 'inactive' }),
      expect.objectContaining({ page: 3, limit: 20 })
    );
  });

  test('returns 400 when service fails', async () => {
    svc.getAllCategories.mockResolvedValue({ status: false, message: 'Query failed' });
    const res = mockRes();
    await controller.index(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Query failed' })
    );
  });
});

// ─── create ─────────────────────────────────────────────────────────────────────

describe('create', () => {
  const createdCat = () => ({ _id: VALID_ID, name: 'Snacks', branch_id: VALID_ID });

  test('returns 201 with created category when service succeeds', async () => {
    svc.createCategory.mockResolvedValue({
      status: true,
      data: createdCat(),
      message: 'Category created successfully',
    });
    const res = mockRes();
    await controller.create(mockReq({ body: { name: 'Snacks' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', data: createdCat() })
    );
  });

  test('returns 400 when express-validator reports validation errors', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Category name is required' }],
    });
    const res = mockRes();
    await controller.create(mockReq({ body: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Validation failed' })
    );
    expect(svc.createCategory).not.toHaveBeenCalled();
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.create(noBranchReq({ body: { name: 'Snacks' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
    expect(svc.createCategory).not.toHaveBeenCalled();
  });

  test('returns 400 when both discount_amount and discount_percentage are > 0', async () => {
    const res = mockRes();
    await controller.create(
      mockReq({ body: { name: 'Test', discount_amount: '10', discount_percentage: '5' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Enter discount_amount or discount_percentage, not both',
      })
    );
  });

  test('applies category defaults when optional fields are omitted', async () => {
    svc.createCategory.mockResolvedValue({
      status: true,
      data: createdCat(),
      message: 'Category created successfully',
    });
    const res = mockRes();
    await controller.create(mockReq({ body: { name: 'Snacks' } }), res, jest.fn());

    expect(svc.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Snacks',
        description: '',
        discount_amount: 0,
        discount_percentage: 0,
        is_active: true,
        sort_order: 0,
      })
    );
  });

  test('adds created_by from req.user.username', async () => {
    svc.createCategory.mockResolvedValue({
      status: true,
      data: createdCat(),
      message: 'Category created successfully',
    });
    const res = mockRes();
    await controller.create(mockReq({ body: { name: 'Snacks' } }), res, jest.fn());

    expect(svc.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'admin' })
    );
  });

  test('returns 400 when service returns status false (duplicate name)', async () => {
    svc.createCategory.mockResolvedValue({
      status: false,
      message: 'Category with this name already exists in this branch',
    });
    const res = mockRes();
    await controller.create(mockReq({ body: { name: 'Snacks' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Category with this name already exists in this branch',
      })
    );
  });

  test('returns 400 instead of creating an unlicensed category', async () => {
    const res = mockRes();
    await controller.create(
      mockReq({
        user: { ...adminUser(), license: undefined, license_id: undefined },
        body: { name: 'Snacks' },
      }),
      res,
      jest.fn()
    );

    expect(svc.createCategory).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('stores the active branch name, branch ID, and license', async () => {
    svc.createCategory.mockResolvedValue({
      status: true,
      data: createdCat(),
      message: 'Category created successfully',
    });
    const res = mockRes();
    await controller.create(
      mockReq({ body: { name: 'Snacks', branch_id: VALID_ID_2 } }),
      res,
      jest.fn()
    );

    expect(svc.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        branch_id: expect.objectContaining({}),
        branch_name: 'Main Branch',
        license: expect.objectContaining({}),
      })
    );
    const category = svc.createCategory.mock.calls[0][0];
    expect(category.branch_id.toString()).toBe(VALID_ID);
    expect(category.license.toString()).toBe(VALID_ID);
  });
});

// ─── update ─────────────────────────────────────────────────────────────────────

describe('update', () => {
  const updatedCat = () => ({ _id: VALID_ID, name: 'Updated Cat', branch_id: VALID_ID });

  test('returns 200 with updated category when service succeeds', async () => {
    svc.updateCategory.mockResolvedValue({
      status: true,
      data: updatedCat(),
      message: 'Category updated successfully',
    });
    const res = mockRes();
    await controller.update(
      mockReq({ params: { id: VALID_ID }, body: { name: 'Updated Cat' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', data: updatedCat() })
    );
  });

  test('returns 400 on validation error', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Invalid category ID format' }],
    });
    const res = mockRes();
    await controller.update(mockReq({ params: { id: 'bad-id' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation failed' })
    );
    expect(svc.updateCategory).not.toHaveBeenCalled();
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.update(
      noBranchReq({ params: { id: VALID_ID }, body: { name: 'X' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('returns 400 when both discount_amount and discount_percentage are > 0', async () => {
    const res = mockRes();
    await controller.update(
      mockReq({
        params: { id: VALID_ID },
        body: { discount_amount: '10', discount_percentage: '5' },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Enter discount_amount or discount_percentage, not both',
      })
    );
  });

  test('zeroes out discount_percentage when only discount_amount is provided', async () => {
    svc.updateCategory.mockResolvedValue({ status: true, data: updatedCat(), message: 'ok' });
    const res = mockRes();
    await controller.update(
      mockReq({ params: { id: VALID_ID }, body: { discount_amount: '15' } }),
      res,
      jest.fn()
    );

    expect(svc.updateCategory).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ discount_amount: 15, discount_percentage: 0 })
    );
  });

  test('adds updated_by from req.user.username', async () => {
    svc.updateCategory.mockResolvedValue({ status: true, data: updatedCat(), message: 'ok' });
    const res = mockRes();
    await controller.update(
      mockReq({ params: { id: VALID_ID }, body: { name: 'Updated' } }),
      res,
      jest.fn()
    );

    expect(svc.updateCategory).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ updated_by: 'admin' })
    );
  });

  test('returns 400 when service fails (category not found)', async () => {
    svc.updateCategory.mockResolvedValue({ status: false, message: 'Category not found' });
    const res = mockRes();
    await controller.update(
      mockReq({ params: { id: VALID_ID }, body: { name: 'X' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category not found' })
    );
  });
});

// ─── toggleStatus ───────────────────────────────────────────────────────────────

describe('toggleStatus', () => {
  test('returns 200 with activation message when is_active is true', async () => {
    svc.updateCategory.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, is_active: true },
      message: 'ok',
    });
    const res = mockRes();
    await controller.toggleStatus(
      mockReq({ params: { id: VALID_ID }, body: { is_active: true } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category activated successfully' })
    );
  });

  test('returns 200 with deactivation message when is_active is false', async () => {
    svc.updateCategory.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, is_active: false },
      message: 'ok',
    });
    const res = mockRes();
    await controller.toggleStatus(
      mockReq({ params: { id: VALID_ID }, body: { is_active: false } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category deactivated successfully' })
    );
  });

  test('calls service.updateCategory with correct id and is_active', async () => {
    svc.updateCategory.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const res = mockRes();
    await controller.toggleStatus(
      mockReq({ params: { id: VALID_ID }, body: { is_active: true } }),
      res,
      jest.fn()
    );

    expect(svc.updateCategory).toHaveBeenCalledWith(VALID_ID, { is_active: true });
  });

  test('returns 400 when service fails', async () => {
    svc.updateCategory.mockResolvedValue({ status: false, message: 'Category not found' });
    const res = mockRes();
    await controller.toggleStatus(
      mockReq({ params: { id: VALID_ID }, body: { is_active: true } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Category not found' })
    );
  });
});

// ─── getOptions ─────────────────────────────────────────────────────────────────

describe('getOptions', () => {
  const activeCats = [
    { _id: VALID_ID, name: 'Electronics' },
    { _id: VALID_ID_2, name: 'Beverages' },
  ];

  test('returns 200 with all active category options when no search', async () => {
    svc.getActiveCategories.mockResolvedValue({
      status: true,
      data: activeCats,
      message: 'Active categories retrieved successfully',
    });
    const res = mockRes();
    await controller.getOptions(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { _id: VALID_ID, name: 'Electronics' },
          { _id: VALID_ID_2, name: 'Beverages' },
        ],
      })
    );
  });

  test('filters options by search query (case-insensitive)', async () => {
    svc.getActiveCategories.mockResolvedValue({ status: true, data: activeCats, message: 'ok' });
    const res = mockRes();
    await controller.getOptions(mockReq({ query: { search: 'bev' } }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].name).toBe('Beverages');
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.getOptions(noBranchReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('returns 400 when service fails', async () => {
    svc.getActiveCategories.mockResolvedValue({ status: false, message: 'DB error' });
    const res = mockRes();
    await controller.getOptions(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB error' })
    );
  });
});

// ─── getCategoryAjaxList ────────────────────────────────────────────────────────

describe('getCategoryAjaxList', () => {
  const catList = [
    {
      _id: VALID_ID,
      name: 'Electronics',
      discount_amount: 0,
      discount_percentage: 0,
      description: '',
    },
  ];

  test('returns 200 JSON with suggestions when query is provided (uses searchCategories)', async () => {
    svc.searchCategories.mockResolvedValue({
      status: true,
      data: { data: catList },
      message: 'ok',
    });
    const res = mockRes();
    await controller.getCategoryAjaxList(mockReq({ query: { query: 'elec' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'elec',
        suggestions: expect.arrayContaining([expect.objectContaining({ name: 'Electronics' })]),
      })
    );
    expect(svc.searchCategories).toHaveBeenCalled();
    expect(svc.getCategoriesByBranch).not.toHaveBeenCalled();
  });

  test('returns 200 JSON with suggestions when no query (uses getCategoriesByBranch)', async () => {
    svc.getCategoriesByBranch.mockResolvedValue({
      status: true,
      data: catList,
      message: 'ok',
    });
    const res = mockRes();
    await controller.getCategoryAjaxList(mockReq({ query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(svc.getCategoriesByBranch).toHaveBeenCalled();
    expect(svc.searchCategories).not.toHaveBeenCalled();
  });

  test('returns 500 when service fails', async () => {
    svc.getCategoriesByBranch.mockResolvedValue({ status: false, message: 'Lookup failed' });
    const res = mockRes();
    await controller.getCategoryAjaxList(mockReq({ query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Lookup failed' })
    );
  });

  test('maps category data to suggestions format', async () => {
    svc.searchCategories.mockResolvedValue({
      status: true,
      data: {
        data: [
          {
            _id: VALID_ID,
            name: 'Snacks',
            discount_amount: 5,
            discount_percentage: 0,
            description: 'Tasty',
          },
        ],
      },
      message: 'ok',
    });
    const res = mockRes();
    await controller.getCategoryAjaxList(mockReq({ query: { query: 'snack' } }), res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.suggestions[0]).toEqual({
      id: VALID_ID,
      name: 'Snacks',
      discount_amount: 5,
      discount_percentage: 0,
      description: 'Tasty',
    });
  });
});

// ─── getCategoriesWithValidItems ────────────────────────────────────────────────

describe('getCategoriesWithValidItems', () => {
  const catList = [
    { _id: VALID_ID, name: 'Fruits', image: 'category.svg', description: 'Fresh fruits' },
  ];

  test('returns 200 with formatted category list including legacy fields', async () => {
    svc.getCategoriesWithItems.mockResolvedValue({
      status: true,
      data: catList,
      message: 'ok',
    });
    const res = mockRes();
    await controller.getCategoriesWithValidItems(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0]).toEqual(
      expect.objectContaining({
        id: VALID_ID,
        category_name: 'Fruits',
        name: 'Fruits',
        description: 'Fresh fruits',
      })
    );
  });

  test('returns 200 with empty list when no categories have items', async () => {
    svc.getCategoriesWithItems.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const res = mockRes();
    await controller.getCategoriesWithValidItems(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  test('returns 400 when service fails', async () => {
    svc.getCategoriesWithItems.mockResolvedValue({ status: false, message: 'Query failed' });
    const res = mockRes();
    await controller.getCategoriesWithValidItems(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Query failed' })
    );
  });
});

// ─── categoriesImport ───────────────────────────────────────────────────────────

describe('categoriesImport', () => {
  const validRows = [{ name: 'Rice', discount_amount: 0, discount_percentage: 0 }];

  test('returns 200 with import result when service succeeds', async () => {
    svc.bulkImport.mockResolvedValue({
      status: true,
      data: [{ name: 'Rice', status: 'Imported' }],
      message: 'Category data imported successfully',
    });
    const res = mockRes();
    await controller.categoriesImport(mockReq({ body: { result: validRows } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Category data imported successfully' })
    );
  });

  test('returns 403 when user lacks write permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.categoriesImport(mockReq({ body: { result: validRows } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.bulkImport).not.toHaveBeenCalled();
  });

  test('returns 400 when no categories are provided (empty array)', async () => {
    const res = mockRes();
    await controller.categoriesImport(mockReq({ body: { result: [] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No categories to import' })
    );
  });

  test('returns 400 when body has no result or categories field', async () => {
    const res = mockRes();
    await controller.categoriesImport(mockReq({ body: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.categoriesImport(noBranchReq({ body: { result: validRows } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required for import' })
    );
  });

  test('returns 400 when service bulk import fails', async () => {
    svc.bulkImport.mockResolvedValue({
      status: false,
      data: [{ name: 'Rice', status: 'Already exists' }],
      message: 'All categories are already imported',
    });
    const res = mockRes();
    await controller.categoriesImport(mockReq({ body: { result: validRows } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'All categories are already imported' })
    );
  });

  test('accepts categories from req.body.categories field as well', async () => {
    svc.bulkImport.mockResolvedValue({
      status: true,
      data: [{ name: 'Tea', status: 'Imported' }],
      message: 'imported',
    });
    const res = mockRes();
    await controller.categoriesImport(
      mockReq({
        body: { categories: [{ name: 'Tea', discount_amount: 0, discount_percentage: 0 }] },
      }),
      res,
      jest.fn()
    );

    expect(svc.bulkImport).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── exportCategories ───────────────────────────────────────────────────────────

describe('exportCategories', () => {
  test('returns 200 with export rows when IDs are valid and categories found', async () => {
    svc.getCategoryById.mockResolvedValue({
      status: true,
      data: {
        _id: VALID_ID,
        name: 'Coffee',
        discount_amount: 0,
        discount_percentage: 0,
        description: 'Roasted',
      },
    });
    const res = mockRes();
    await controller.exportCategories(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Categories Exported Successfully',
        data: expect.arrayContaining([expect.objectContaining({ name: 'Coffee' })]),
      })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.exportCategories(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.getCategoryById).not.toHaveBeenCalled();
  });

  test('returns 400 when no IDs are selected (empty body)', async () => {
    const res = mockRes();
    await controller.exportCategories(mockReq({ body: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No categories selected for export' })
    );
  });

  test('returns 400 when all IDs are invalid ObjectId format', async () => {
    const res = mockRes();
    await controller.exportCategories(
      mockReq({ body: { data: ['not-valid-id', 'also-invalid'] } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid category IDs' })
    );
  });

  test('skips IDs where service.getCategoryById returns status false', async () => {
    svc.getCategoryById.mockResolvedValueOnce({ status: false, data: null }).mockResolvedValueOnce({
      status: true,
      data: {
        _id: VALID_ID_2,
        name: 'Tea',
        discount_amount: 0,
        discount_percentage: 0,
        description: '',
      },
    });
    const res = mockRes();
    await controller.exportCategories(
      mockReq({ body: { data: [VALID_ID, VALID_ID_2] } }),
      res,
      jest.fn()
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].name).toBe('Tea');
  });
});

// ─── deleteCategory ─────────────────────────────────────────────────────────────

describe('deleteCategory', () => {
  test('returns 200 with deleted category data when service succeeds', async () => {
    svc.deleteCategory.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, is_active: false },
      message: 'category deleted successfully',
    });
    const res = mockRes();
    await controller.deleteCategory(mockReq({ params: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'category deleted successfully' })
    );
  });

  test('returns 403 when user lacks delete permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.deleteCategory(mockReq({ params: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.deleteCategory).not.toHaveBeenCalled();
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.deleteCategory(noBranchReq({ params: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('returns 400 when service fails (category not found)', async () => {
    svc.deleteCategory.mockResolvedValue({ status: false, message: 'Category not found' });
    const res = mockRes();
    await controller.deleteCategory(mockReq({ params: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category not found' })
    );
  });
});

// ─── bulkDelete ─────────────────────────────────────────────────────────────────

describe('bulkDelete', () => {
  test('returns 200 with deleted count when service succeeds', async () => {
    svc.bulkDeleteCategories.mockResolvedValue({
      status: true,
      data: 3,
      message: 'category deleted successfully',
    });
    const res = mockRes();
    await controller.bulkDelete(
      mockReq({ body: { data: [VALID_ID, VALID_ID_2] } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', data: 3 }));
  });

  test('returns 403 when user lacks delete permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.bulkDelete(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.bulkDeleteCategories).not.toHaveBeenCalled();
  });

  test('returns 400 when IDs array is empty', async () => {
    const res = mockRes();
    await controller.bulkDelete(mockReq({ body: { data: [] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category IDs are required' })
    );
  });

  test('returns HTTP 200 even when service fails (PHP-compatible business rule)', async () => {
    svc.bulkDeleteCategories.mockResolvedValue({
      status: false,
      message: 'Cannot delete categories with associated items',
    });
    const res = mockRes();
    await controller.bulkDelete(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Cannot delete categories with associated items',
      })
    );
  });

  test('accepts IDs from req.body.ids field as well', async () => {
    svc.bulkDeleteCategories.mockResolvedValue({ status: true, data: 1, message: 'deleted' });
    const res = mockRes();
    await controller.bulkDelete(mockReq({ body: { ids: [VALID_ID] } }), res, jest.fn());

    expect(svc.bulkDeleteCategories).toHaveBeenCalledWith([VALID_ID]);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── delete (legacy alias) ──────────────────────────────────────────────────────

describe('delete (legacy alias)', () => {
  test('delegates to bulkDelete and returns 200 on success', async () => {
    svc.bulkDeleteCategories.mockResolvedValue({ status: true, data: 1, message: 'deleted' });
    const res = mockRes();
    await controller.delete(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(svc.bulkDeleteCategories).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 403 when permission denied (inherited from bulkDelete)', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.delete(mockReq({ body: { data: [VALID_ID] } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─── categoryImageDelete ────────────────────────────────────────────────────────

describe('categoryImageDelete', () => {
  const catWithImage = {
    _id: VALID_ID,
    branch_id: { toString: () => VALID_ID },
    image: 'http://localhost:3000/uploads/category_images/test.jpg',
  };

  beforeEach(() => {
    svc.getCategoryById.mockResolvedValue({ status: true, data: catWithImage });
    svc.updateCategory.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, image: 'category.svg' },
      message: 'ok',
    });
    fs.existsSync.mockReturnValue(false);
  });

  test('returns 200 with default image after successful deletion', async () => {
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Image was deleted' })
    );
    expect(svc.updateCategory).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ image: 'category.svg' })
    );
  });

  test('returns 403 when user lacks write permission', async () => {
    controller.checkPermission = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.getCategoryById).not.toHaveBeenCalled();
  });

  test('returns 400 when category ID is missing from body', async () => {
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category Id Not Found' })
    );
  });

  test('returns 400 when branch context cannot be resolved', async () => {
    const res = mockRes();
    await controller.categoryImageDelete(noBranchReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch context is required' })
    );
  });

  test('returns 404 when category does not exist', async () => {
    svc.getCategoryById.mockResolvedValue({
      status: false,
      data: null,
      message: 'Category not found',
    });
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category not found' })
    );
  });

  test('returns 404 when category belongs to a different branch', async () => {
    svc.getCategoryById.mockResolvedValue({
      status: true,
      data: {
        _id: VALID_ID,
        branch_id: { toString: () => VALID_ID_2 },
        image: 'http://localhost:3000/uploads/category_images/test.jpg',
      },
    });
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Category not found' })
    );
  });

  test('returns 400 when service.updateCategory fails', async () => {
    svc.updateCategory.mockResolvedValue({ status: false, message: 'Image not deleted' });
    const res = mockRes();
    await controller.categoryImageDelete(mockReq({ body: { id: VALID_ID } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Image not deleted' })
    );
  });
});

// ─── uploadCategoryImage ────────────────────────────────────────────────────────

describe('uploadCategoryImage', () => {
  test('returns 200 with default image when no file is uploaded', async () => {
    const res = mockRes();
    await controller.uploadCategoryImage(mockReq({ file: null }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'category.svg', message: 'Image uploaded successfully' })
    );
  });

  test('returns 400 when file extension is not allowed', async () => {
    const res = mockRes();
    await controller.uploadCategoryImage(
      mockReq({
        file: {
          originalname: 'doc.pdf',
          size: 100,
          path: '/tmp/doc.pdf',
          mimetype: 'application/pdf',
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Upload valid images. Only GIF, PNG, JPG, JPEG and BMP are allowed.',
      })
    );
  });

  test('returns 400 when file size exceeds 5MB', async () => {
    const res = mockRes();
    await controller.uploadCategoryImage(
      mockReq({
        file: {
          originalname: 'large.jpg',
          size: 6 * 1024 * 1024,
          path: '/tmp/large.jpg',
          mimetype: 'image/jpeg',
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Image size exceeds 5MB' })
    );
  });

  test('returns 200 with image URL on successful local upload', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.renameSync.mockImplementation(() => {});

    const res = mockRes();
    await controller.uploadCategoryImage(
      mockReq({
        file: {
          originalname: 'photo.jpg',
          size: 100 * 1024,
          path: '/tmp/photo.jpg',
          mimetype: 'image/jpeg',
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.type).toBe('success');
    expect(payload.data).toMatch(/\/uploads\/category_images\//);
    expect(payload.message).toBe('Image uploaded successfully');
  });

  test('returns 404 when local file rename fails', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.renameSync.mockImplementation(() => {
      throw new Error('rename error');
    });

    const res = mockRes();
    await controller.uploadCategoryImage(
      mockReq({
        file: {
          originalname: 'photo.png',
          size: 100 * 1024,
          path: '/tmp/photo.png',
          mimetype: 'image/png',
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Image not uploaded' })
    );
  });
});
