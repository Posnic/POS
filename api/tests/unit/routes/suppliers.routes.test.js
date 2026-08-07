'use strict';

jest.mock('../../../src/controllers/suppliers.controller', () => ({
  getAll: jest.fn(),
  getSuppliersAjaxList: jest.fn(),
  supplierGraphicalReports: jest.fn(),
  getDataChanges: jest.fn(),
  getSupplierDetails: jest.fn(),
  suppliersImport: jest.fn(),
  exportSuppliers: jest.fn(),
  add: jest.fn(),
  delete: jest.fn(),
  getOne: jest.fn(),
  edit: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/suppliers.validation', () => ({
  validateCreateSupplier: [],
  validateUpdateSupplier: [],
  validateSupplierId: [],
  validateBulkDelete: [],
  validateSearch: [],
  validateImport: [],
}));

const router = require('../../../src/routes/suppliers.routes');

describe('suppliers.routes', () => {
  test('exposes supplier routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });
});
