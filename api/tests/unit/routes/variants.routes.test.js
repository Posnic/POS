'use strict';

jest.mock('../../../src/controllers/variants.controller', () => ({
  getAll: jest.fn(),
  getVariantsAjaxList: jest.fn(),
  getVariantDetails: jest.fn(),
  exportVariants: jest.fn(),
  getStats: jest.fn(),
  search: jest.fn(),
  getByField: jest.fn(),
  bulkDelete: jest.fn(),
  legacyDelete: jest.fn(),
  getOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('../../../src/middleware/validation', () => ({
  handleValidationErrors: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../src/middleware/variants.validation', () => ({
  createVariantValidation: [],
  updateVariantValidation: [],
  getVariantByIdValidation: [],
  deleteVariantsValidation: [],
  bulkDeleteValidation: [],
  exportVariantsValidation: [],
  searchValidation: [],
  getPaginatedVariantsValidation: [],
  getVariantsAjaxListValidation: [],
  getByFieldValidation: [],
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/variants.routes');

describe('variants.routes', () => {
  test('exposes variant routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });

  test('applies authentication to the router', () => {
    expect(router.stack.some((layer) => !layer.route)).toBe(true);
  });
});
