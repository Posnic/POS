'use strict';

jest.mock('../../../src/controllers/expenses.controller', () => ({
  getAll: jest.fn(),
  expensesReportTable: jest.fn(),
  getDataChanges: jest.fn(),
  expensesImport: jest.fn(),
  exportExpenses: jest.fn(),
  getExpenseDetails: jest.fn(),
  getSummary: jest.fn(),
  getByCategory: jest.fn(),
  getByType: jest.fn(),
  getOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/validation', () => ({ validateExpense: [], validateId: [] }));

const router = require('../../../src/routes/expenses.routes');

describe('expenses.routes', () => {
  test('exposes expected expense routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /',
        'get /expensesReportTable',
        'post /expensesImport',
        'post /exportExpenses',
        'get /summary',
        'get /:id',
        'post /',
        'put /:id',
        'delete /delete',
        'delete /',
      ])
    );
  });
});
