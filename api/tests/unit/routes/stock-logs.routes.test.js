'use strict';

jest.mock('../../../src/controllers/stock-logs.controller', () => ({
  getAll: jest.fn(),
  exportStocklogs: jest.fn(),
  cleanupOldDeletedLogs: jest.fn(),
  export: jest.fn(),
  updateItemName: jest.fn(),
  getOne: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('../../../src/middleware/stock-logs.validation', () => ({
  validateCreateStockLog: [],
  validateUpdateItemName: [],
  validateCleanupLogs: [],
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/stock-logs.routes');

describe('stock-logs.routes', () => {
  test('exposes stock log routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });

  test('applies authentication to the router', () => {
    expect(router.stack.some((layer) => !layer.route)).toBe(true);
  });
});
