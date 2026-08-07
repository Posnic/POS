'use strict';

jest.mock('../../../src/controllers/categories.controller', () => ({
  getAll: jest.fn(),
  getDataChanges: jest.fn(),
  categoriesImport: jest.fn(),
  exportCategories: jest.fn(),
  uploadCategoryImage: jest.fn(),
  categoryImageDelete: jest.fn(),
  getCategoryAjaxList: jest.fn(),
  getCategoriesWithValidItems: jest.fn(),
  bulkDelete: jest.fn(),
  success: jest.fn((res, data, message) =>
    res.status(200).json({ type: 'success', data, message })
  ),
  error: jest.fn((res, message, status) => res.status(status).json({ type: 'error', message })),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

jest.mock('../../../src/middleware/upload', () => ({
  single: jest.fn(() => (req, res, next) => next()),
}));

jest.mock('../../../src/middleware/categories.validation', () => ({
  validateCreateCategory: [],
  validateUpdateCategory: [],
  validateCategoryId: [],
  validateBulkDelete: [],
  validateSearch: [],
  validateImport: [],
}));

jest.mock('../../../src/models/category.model', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../src/models/item.model', () => ({}));
jest.mock('../../../src/models/branch.model', () => ({ find: jest.fn() }));

const router = require('../../../src/routes/categories.routes');
const Category = require('../../../src/models/category.model');
const Branch = require('../../../src/models/branch.model');

const ID = '507f1f77bcf86cd799439011';
const BRANCH_ID = '507f1f77bcf86cd799439012';
const LICENSE_ID = '507f1f77bcf86cd799439013';

describe('categories.routes', () => {
  test('exposes category routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /',
        'get /options',
        'get /getDataChanges',
        'post /categoriesImport',
        'post /exportCategories',
        'post /uploadCategoryImage',
        'delete /categoryImageDelete',
        'delete /delete',
      ])
    );
  });

  test('gets a category from any authenticated accessible branch with full tenant scope', async () => {
    const branch = { _id: BRANCH_ID, branch_name: 'Main Branch' };
    Branch.find.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([branch]) }),
    });
    const category = { _id: ID, name: 'Food', branch_id: BRANCH_ID };
    Category.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(category) });

    const layer = router.stack.find((entry) => entry.route?.path === '/:id');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const req = {
      params: { id: ID },
      user: { license: LICENSE_ID, branch_access: [{ branch_id: BRANCH_ID }] },
      tenantContext: { branchId: BRANCH_ID, licenseId: LICENSE_ID },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await handler(req, res);

    expect(Category.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: ID,
        license: expect.any(Object),
        $or: [expect.objectContaining({ branch_name: 'Main Branch' })],
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
