'use strict';

jest.mock('../../../src/controllers/customer-categories.controller', () => {
  const createHandler = () => jest.fn(function handler() {});
  return new Proxy(
    {},
    {
      get: (target, property) => {
        if (!(property in target)) {
          target[property] = createHandler();
        }
        return target[property];
      },
    }
  );
});

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

jest.mock('../../../src/middleware/customer-category.validation', () => ({
  validateCreateCustomerCategory: [],
  validateUpdateCustomerCategory: [],
  validateCustomerCategoryId: [],
  validateBulkDelete: [],
  validateSearch: [],
  validateImport: [],
}));

const router = require('../../../src/routes/customer-categories.routes');

describe('customer-categories.routes', () => {
  test('exposes customer category routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        'get /',
        'post /',
        'get /getDataChanges',
        'get /getCategoryDetails',
        'get /getCustomerCategoryAjaxList',
        'post /customercategoryImport',
        'post /importcustomercategory',
        'post /exportCustomerCategory',
        'post /exportcustomerCategory',
        'get /:id',
        'put /:id',
        'delete /delete',
        'delete /',
      ])
    );
  });
});
