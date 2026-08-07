'use strict';

jest.mock('../../../src/controllers/customers.controller', () => ({
  setRequestContext: jest.fn(),
  getCustomers: jest.fn(),
  searchCustomers: jest.fn(),
  getCustomersAjaxList: jest.fn(),
  customerGraphicalReports: jest.fn(),
  getDataChanges: jest.fn(),
  customersImport: jest.fn(),
  customerOutstandingReportTable: jest.fn(),
  exportCustomers: jest.fn(),
  customerPaymentDetails: jest.fn(),
  getCustomer: jest.fn(),
  transactionDetails: jest.fn(),
  transaction: jest.fn(),
  deleteTransaction: jest.fn(),
  uploadTransactionImage: jest.fn(),
  getCustomersByTier: jest.fn(),
  getCustomerSummary: jest.fn(),
  createCustomer: jest.fn(),
  addLoyaltyPoints: jest.fn(),
  redeemPoints: jest.fn(),
  updatePreferences: jest.fn(),
  updateCustomer: jest.fn(),
  delete: jest.fn(),
  deleteCustomer: jest.fn(),
}));

jest.mock('express-async-handler', () => (fn) => fn);
jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/upload', () => ({
  single: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../src/middleware/customers.validation', () => ({
  validateCreateCustomer: [],
  validateUpdateCustomer: [],
  validateCustomerId: [],
  validateBulkDelete: [],
  validateSearch: [],
  validateLoyaltyPoints: [],
  validatePreferences: [],
  validateImport: [],
}));

const router = require('../../../src/routes/customers.routes');

describe('customers.routes', () => {
  test('exposes customer routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });
});
