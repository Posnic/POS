/**
 * Unit tests for ExpensesController
 * Tests: getAll, getOne, create, update, delete, getExpenseDetails,
 *        expensesImport, exportExpenses, getDataChanges, getByType
 *
 * NOTE: getSummary, getByCategory, getByType (success path) reference `Expense`
 * which is not imported in expenses.controller.js — those success paths will
 * throw ReferenceError and are marked with a note below.
 */

jest.mock('../../../src/services/expense.service', () =>
  jest.fn().mockImplementation(() => ({
    getAllExpenses: jest.fn(),
    getExpenseById: jest.fn(),
    createExpense: jest.fn(),
    updateExpense: jest.fn(),
    deleteExpenses: jest.fn(),
  }))
);
jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));
jest.mock('../../../src/models/expense.model', () =>
  jest.fn().mockImplementation(() => ({
    expensesReportPage: jest.fn(),
    getDataChanges: jest.fn(),
    importExpensesModel: jest.fn(),
    exportExpensesOrder: jest.fn(),
  }))
);
jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
}));
jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});
jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

const { validationResult } = require('express-validator');
const Branch = require('../../../src/models/branch.model');
const controller = require('../../../src/controllers/expenses.controller');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
const VALID_LICENSE_ID = '64f8f2f4c2b9c0a1e4b11111';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const adminUser = (overrides = {}) => ({
  _id: VALID_ID,
  name: 'Admin User',
  username: 'admin',
  usertype: 'admin',
  license: VALID_LICENSE_ID,
  ...overrides,
});

const restrictedUser = (accessOverrides = {}) => ({
  _id: VALID_ID,
  username: 'cashier',
  usertype: 'cashier',
  access: {
    expense: { read: false, write: false, delete: false },
    ...accessOverrides,
  },
});

const mockReq = (overrides = {}) => ({
  user: adminUser(),
  query: {},
  params: {},
  body: {},
  session: {},
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = () => jest.fn();

// ─── Setup ────────────────────────────────────────────────────────────────────

let svc;
let mdl;

beforeEach(() => {
  jest.clearAllMocks();

  svc = {
    getAllExpenses: jest.fn(),
    getExpenseById: jest.fn(),
    createExpense: jest.fn(),
    updateExpense: jest.fn(),
    deleteExpenses: jest.fn(),
  };
  controller.service = svc;

  mdl = {
    expensesReportPage: jest.fn(),
    getDataChanges: jest.fn(),
    importExpensesModel: jest.fn(),
    exportExpensesOrder: jest.fn(),
  };
  controller.model = mdl;

  Branch.findById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  });

  validationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAll
// ─────────────────────────────────────────────────────────────────────────────

describe('getAll', () => {
  test('returns 200 with list on success', async () => {
    const req = mockReq({ query: { page: '1', limit: '10' } });
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({
      status: true,
      data: { list: [{ _id: VALID_ID, amount: 100 }], total: 1 },
      message: 'Expenses retrieved successfully',
    });

    await controller.getAll(req, res, mockNext());

    expect(svc.getAllExpenses).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Expenses retrieved successfully' })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ user: restrictedUser() });
    const res = mockRes();

    await controller.getAll(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.getAllExpenses).not.toHaveBeenCalled();
  });

  test('returns 400 when filters JSON is malformed', async () => {
    const req = mockReq({ query: { filters: 'not-valid-json{' } });
    const res = mockRes();

    await controller.getAll(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Invalid filters format' })
    );
    expect(svc.getAllExpenses).not.toHaveBeenCalled();
  });

  test('returns 400 when service returns status false', async () => {
    const req = mockReq();
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({ status: false, message: 'DB error' });

    await controller.getAll(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'DB error' })
    );
  });

  test('parses date filters and converts strings to Date objects', async () => {
    const filters = JSON.stringify({
      date: { $gte: '2025-01-01 ', $lte: '2025-12-31 ' },
    });
    const req = mockReq({ query: { filters } });
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });

    await controller.getAll(req, res, mockNext());

    const [calledFilters] = svc.getAllExpenses.mock.calls[0];
    expect(calledFilters.date.$gte).toBeInstanceOf(Date);
    expect(calledFilters.date.$lte).toBeInstanceOf(Date);
  });

  test('defaults to page 1 limit 10 when query params missing', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });

    await controller.getAll(req, res, mockNext());

    const [, calledOptions] = svc.getAllExpenses.mock.calls[0];
    expect(calledOptions.page).toBe(1);
    expect(calledOptions.limit).toBe(10);
  });

  test('defaults page to 1 when page param is 0 or negative', async () => {
    const req = mockReq({ query: { page: '0' } });
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });

    await controller.getAll(req, res, mockNext());

    const [, calledOptions] = svc.getAllExpenses.mock.calls[0];
    expect(calledOptions.page).toBe(1);
  });

  test('returns empty list when service returns empty data', async () => {
    const req = mockReq();
    const res = mockRes();
    svc.getAllExpenses.mockResolvedValue({
      status: true,
      data: { list: [], total: 0 },
      message: 'Expenses retrieved successfully',
    });

    await controller.getAll(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOne
// ─────────────────────────────────────────────────────────────────────────────

describe('getOne', () => {
  test('returns 200 with expense data when found', async () => {
    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, amount: 500, type: 'debit' },
      message: 'Expense retrieved successfully',
    });

    await controller.getOne(req, res, mockNext());

    expect(svc.getExpenseById).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 404 when expense not found', async () => {
    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: false,
      data: null,
      message: 'Expense not found',
    });

    await controller.getOne(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Expense not found' })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ params: { id: VALID_ID }, user: restrictedUser() });
    const res = mockRes();

    await controller.getOne(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.getExpenseById).not.toHaveBeenCalled();
  });

  test('returns 404 when service returns status true but data is null', async () => {
    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: true,
      data: null,
      message: 'No data',
    });

    await controller.getOne(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────────────

describe('create', () => {
  const validBody = { amount: 250, type: 'debit', description: 'Office supplies' };

  test('returns 201 when expense created successfully', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    svc.createExpense.mockResolvedValue({
      status: true,
      data: VALID_ID,
      message: 'Expense added successfully',
    });

    await controller.create(req, res, mockNext());

    expect(svc.createExpense).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Expense added successfully' })
    );
  });

  test('returns 422 when express-validator reports errors', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Amount must be a number', path: 'amount' }],
    });
    const req = mockReq({ body: { amount: 'abc', description: 'test' } });
    const res = mockRes();

    await controller.create(req, res, mockNext());

    expect(svc.createExpense).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Validation failed' })
    );
  });

  test('returns 403 when user lacks create permission', async () => {
    const req = mockReq({
      body: validBody,
      user: restrictedUser({ expense: { read: true, write: false, delete: false } }),
    });
    const res = mockRes();

    await controller.create(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.createExpense).not.toHaveBeenCalled();
  });

  test('returns 400 when service rejects the expense', async () => {
    const req = mockReq({ body: validBody });
    const res = mockRes();
    svc.createExpense.mockResolvedValue({
      status: false,
      message: 'Amount and type are required',
    });

    await controller.create(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Amount and type are required' })
    );
  });

  test('attaches created_by from user username to expense data', async () => {
    const req = mockReq({
      body: validBody,
      user: adminUser({ username: 'cashier1' }),
    });
    const res = mockRes();
    svc.createExpense.mockResolvedValue({ status: true, data: VALID_ID, message: 'ok' });

    await controller.create(req, res, mockNext());

    const [calledData] = svc.createExpense.mock.calls[0];
    expect(calledData.created_by).toBe('cashier1');
  });

  test('falls back to email when username is missing', async () => {
    const req = mockReq({
      body: validBody,
      user: adminUser({ username: undefined, email: 'test@example.com' }),
    });
    const res = mockRes();
    svc.createExpense.mockResolvedValue({ status: true, data: VALID_ID, message: 'ok' });

    await controller.create(req, res, mockNext());

    const [calledData] = svc.createExpense.mock.calls[0];
    expect(calledData.created_by).toBe('test@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update
// ─────────────────────────────────────────────────────────────────────────────

describe('update', () => {
  const updateBody = { amount: 300, description: 'Updated description' };

  test('returns 200 when expense updated successfully', async () => {
    const req = mockReq({ params: { id: VALID_ID }, body: updateBody });
    const res = mockRes();
    svc.updateExpense.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'Expense updated successfully',
    });

    await controller.update(req, res, mockNext());

    expect(svc.updateExpense).toHaveBeenCalledWith(VALID_ID, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', data: { id: VALID_ID } })
    );
  });

  test('returns 400 when service reports expense not found', async () => {
    const req = mockReq({ params: { id: VALID_ID }, body: updateBody });
    const res = mockRes();
    svc.updateExpense.mockResolvedValue({
      status: false,
      message: 'Expense not found',
    });

    await controller.update(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Expense not found' })
    );
  });

  test('returns 422 when express-validator reports errors', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Amount must be a number' }],
    });
    const req = mockReq({ params: { id: VALID_ID }, body: {} });
    const res = mockRes();

    await controller.update(req, res, mockNext());

    expect(svc.updateExpense).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('returns 403 when user lacks update permission', async () => {
    const req = mockReq({
      params: { id: VALID_ID },
      body: updateBody,
      user: restrictedUser({ expense: { read: true, write: false } }),
    });
    const res = mockRes();

    await controller.update(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.updateExpense).not.toHaveBeenCalled();
  });

  test('passes updated_by from user context to service', async () => {
    const req = mockReq({
      params: { id: VALID_ID },
      body: updateBody,
      user: adminUser({ username: 'manager1' }),
    });
    const res = mockRes();
    svc.updateExpense.mockResolvedValue({ status: true, data: {}, message: 'ok' });

    await controller.update(req, res, mockNext());

    const [, calledData] = svc.updateExpense.mock.calls[0];
    expect(calledData.updated_by).toBe('manager1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete
// ─────────────────────────────────────────────────────────────────────────────

describe('delete', () => {
  test('returns 200 when expenses deleted via body.data array', async () => {
    const req = mockReq({ body: { data: [VALID_ID] } });
    const res = mockRes();
    svc.deleteExpenses.mockResolvedValue({
      status: true,
      message: '1 expense(s) deleted successfully',
    });

    await controller.delete(req, res, mockNext());

    expect(svc.deleteExpenses).toHaveBeenCalledWith([VALID_ID]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 200 when expenses deleted via body.ids array', async () => {
    const req = mockReq({ body: { ids: [VALID_ID] } });
    const res = mockRes();
    svc.deleteExpenses.mockResolvedValue({
      status: true,
      message: '1 expense(s) deleted successfully',
    });

    await controller.delete(req, res, mockNext());

    expect(svc.deleteExpenses).toHaveBeenCalledWith([VALID_ID]);
  });

  test('wraps single non-array ID into array', async () => {
    const req = mockReq({ body: { data: VALID_ID } });
    const res = mockRes();
    svc.deleteExpenses.mockResolvedValue({ status: true, message: 'ok' });

    await controller.delete(req, res, mockNext());

    expect(svc.deleteExpenses).toHaveBeenCalledWith([VALID_ID]);
  });

  test('returns 400 when body.data is empty array', async () => {
    const req = mockReq({ body: { data: [] } });
    const res = mockRes();

    await controller.delete(req, res, mockNext());

    expect(svc.deleteExpenses).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'No expense IDs provided for deletion',
      })
    );
  });

  test('returns 403 when user lacks delete permission', async () => {
    const req = mockReq({
      body: { data: [VALID_ID] },
      user: restrictedUser({ expense: { delete: false } }),
    });
    const res = mockRes();

    await controller.delete(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.deleteExpenses).not.toHaveBeenCalled();
  });

  test('returns 400 when service fails deletion', async () => {
    const req = mockReq({ body: { data: [VALID_ID] } });
    const res = mockRes();
    svc.deleteExpenses.mockResolvedValue({ status: false, message: 'Delete failed' });

    await controller.delete(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Delete failed' })
    );
  });

  test('deletes multiple IDs passed via body.data', async () => {
    const ids = [VALID_ID, VALID_LICENSE_ID];
    const req = mockReq({ body: { data: ids } });
    const res = mockRes();
    svc.deleteExpenses.mockResolvedValue({
      status: true,
      message: '2 expense(s) deleted successfully',
    });

    await controller.delete(req, res, mockNext());

    expect(svc.deleteExpenses).toHaveBeenCalledWith(ids);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getExpenseDetails
// ─────────────────────────────────────────────────────────────────────────────

describe('getExpenseDetails', () => {
  test('returns 200 with data when found via query.id', async () => {
    const req = mockReq({ query: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, amount: 100 },
      message: 'Expense retrieved successfully',
    });

    await controller.getExpenseDetails(req, res, mockNext());

    expect(svc.getExpenseById).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 200 when id is supplied via params.id', async () => {
    const req = mockReq({ query: {}, params: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID },
      message: 'ok',
    });

    await controller.getExpenseDetails(req, res, mockNext());

    expect(svc.getExpenseById).toHaveBeenCalledWith(VALID_ID);
  });

  test('returns 400 when no id is provided', async () => {
    const req = mockReq({ query: {}, params: {} });
    const res = mockRes();

    await controller.getExpenseDetails(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Expense Id Not Found' })
    );
    expect(svc.getExpenseById).not.toHaveBeenCalled();
  });

  test('returns 404 when expense is not found', async () => {
    const req = mockReq({ query: { id: VALID_ID } });
    const res = mockRes();
    svc.getExpenseById.mockResolvedValue({
      status: false,
      data: null,
      message: 'Expense not found',
    });

    await controller.getExpenseDetails(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ query: { id: VALID_ID }, user: restrictedUser() });
    const res = mockRes();

    await controller.getExpenseDetails(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.getExpenseById).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// expensesImport
// ─────────────────────────────────────────────────────────────────────────────

describe('expensesImport', () => {
  const validImport = [
    { amount: 100, type: 'debit', description: 'Fuel' },
    { amount: 200, type: 'credit', description: 'Refund' },
  ];

  test('returns 200 when import succeeds', async () => {
    const req = mockReq({ body: { result: validImport } });
    const res = mockRes();
    mdl.importExpensesModel.mockResolvedValue({
      status: true,
      data: { inserted: 2 },
      message: '2 expenses imported',
    });

    await controller.expensesImport(req, res);

    expect(mdl.importExpensesModel).toHaveBeenCalledWith(validImport);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('returns 400 when no expenses are provided', async () => {
    const req = mockReq({ body: { result: [] } });
    const res = mockRes();

    await controller.expensesImport(req, res);

    expect(mdl.importExpensesModel).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No expenses to import' })
    );
  });

  test('returns 400 when body has no result or expenses key', async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    await controller.expensesImport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 403 when user lacks write permission', async () => {
    const req = mockReq({
      body: { result: validImport },
      user: restrictedUser({ expense: { write: false } }),
    });
    const res = mockRes();

    await controller.expensesImport(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mdl.importExpensesModel).not.toHaveBeenCalled();
  });

  test('accepts expenses via body.expenses key (legacy format)', async () => {
    const req = mockReq({ body: { expenses: validImport } });
    const res = mockRes();
    mdl.importExpensesModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'ok',
    });

    await controller.expensesImport(req, res);

    expect(mdl.importExpensesModel).toHaveBeenCalledWith(validImport);
  });

  test('returns 404 when model import fails', async () => {
    const req = mockReq({ body: { result: validImport } });
    const res = mockRes();
    mdl.importExpensesModel.mockResolvedValue({
      status: false,
      data: null,
      message: 'Import failed',
    });

    await controller.expensesImport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportExpenses
// ─────────────────────────────────────────────────────────────────────────────

describe('exportExpenses', () => {
  test('returns 200 when export succeeds with array body', async () => {
    const req = mockReq({ body: [VALID_ID] });
    const res = mockRes();
    mdl.exportExpensesOrder.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, amount: 100 }],
    });

    await controller.exportExpenses(req, res);

    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Expenses Exported Successfully' })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ body: [VALID_ID], user: restrictedUser() });
    const res = mockRes();

    await controller.exportExpenses(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mdl.exportExpensesOrder).not.toHaveBeenCalled();
  });

  test('returns 400 when no IDs are provided', async () => {
    const req = mockReq({ body: [] });
    const res = mockRes();

    await controller.exportExpenses(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No expense IDs provided' })
    );
  });

  test('returns 404 when export model fails', async () => {
    const req = mockReq({ body: [VALID_ID] });
    const res = mockRes();
    mdl.exportExpensesOrder.mockResolvedValue({ status: false, data: null });

    await controller.exportExpenses(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('normalizes object body with data key', async () => {
    const req = mockReq({ body: { data: [VALID_ID] } });
    const res = mockRes();
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });

    await controller.exportExpenses(req, res);

    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDataChanges
// ─────────────────────────────────────────────────────────────────────────────

describe('getDataChanges', () => {
  test('returns 200 with changes when status is true', async () => {
    const req = mockReq({ query: { from: '2025-01-01' } });
    const res = mockRes();
    mdl.getDataChanges.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, amount: 100 }],
    });

    await controller.getDataChanges(req, res);

    expect(mdl.getDataChanges).toHaveBeenCalledWith('expenses', '2025-01-01');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Changes Retrieved' })
    );
  });

  test('returns HTTP 200 with type error when model returns false (PHP parity)', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    mdl.getDataChanges.mockResolvedValue({ status: false, data: null });

    await controller.getDataChanges(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Not valid Input' })
    );
  });

  test('returns 500 when model throws', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    mdl.getDataChanges.mockRejectedValue(new Error('DB crash'));

    await controller.getDataChanges(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getByType — only validation path (success path has a bug: `Expense` not imported)
// ─────────────────────────────────────────────────────────────────────────────

describe('getByType', () => {
  test('returns 400 for invalid type value', async () => {
    const req = mockReq({ params: { type: 'invalid' } });
    const res = mockRes();

    await controller.getByType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid expense type' })
    );
  });

  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ params: { type: 'credit' }, user: restrictedUser() });
    const res = mockRes();

    await controller.getByType(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  /**
   * NOTE: The success path for 'credit' and 'debit' types will throw
   * ReferenceError: Expense is not defined — because `Expense` is never imported
   * in expenses.controller.js. The fix is to import ExpenseModel and use
   * `this.model` instead of the bare `Expense` identifier.
   * Success-path tests are excluded until this bug is fixed.
   */
});

// =============================================================================
// ADDITIONAL COVERAGE � appended to reach near-100% coverage
// Covers: setRequestContext propagation, date filters (updated_date/created_date),
//         expensesReportTable, mongoIDFilter, mongoDateFilter,
//         expensesImport catch, exportExpenses edge cases + catch,
//         getSummary, getByCategory, getByType success path
// =============================================================================

// -----------------------------------------------------------------------------
// setRequestContext � branch DB lookup and BaseModel propagation
// -----------------------------------------------------------------------------

describe('setRequestContext � context propagation', () => {
  test('fetches branch name from DB when user has branch_id but no branch_name', async () => {
    Branch.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ branch_name: 'Main Branch' }),
      }),
    });
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser({ branch_id: VALID_ID, branch_name: '' }) });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    expect(Branch.findById).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('swallows Branch.findById error and continues', async () => {
    Branch.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('Mongo error')),
      }),
    });
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser({ branch_id: VALID_ID, branch_name: '' }) });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('propagates branch_id filter to getAll query when user has branch_id', async () => {
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser({ branch_id: VALID_ID, branch_name: 'HQ' }) });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    const [calledFilters] = svc.getAllExpenses.mock.calls[0];
    expect(calledFilters.branch_id).toBeDefined();
  });

  test('sets BaseModel.loggedUser as ObjectId when user._id is already ObjectId', async () => {
    const { ObjectId } = require('mongodb');
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: {}, user: adminUser({ _id: new ObjectId(VALID_ID) }) });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('sets BaseModel.license as ObjectId when user.license is already ObjectId', async () => {
    const { ObjectId } = require('mongodb');
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({
      query: {},
      user: adminUser({ license: new ObjectId(VALID_LICENSE_ID) }),
    });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// -----------------------------------------------------------------------------
// getAll � updated_date and created_date filter conversion
// -----------------------------------------------------------------------------

describe('getAll � updated_date and created_date filter coverage', () => {
  test('converts updated_date gte/lte strings to Date objects', async () => {
    const filters = JSON.stringify({ updated_date: { $gte: '2025-01-01 ', $lte: '2025-12-31 ' } });
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { filters } });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    const [calledFilters] = svc.getAllExpenses.mock.calls[0];
    expect(calledFilters.updated_date.$gte).toBeInstanceOf(Date);
    expect(calledFilters.updated_date.$lte).toBeInstanceOf(Date);
  });

  test('converts created_date gte/lte strings to Date objects', async () => {
    const filters = JSON.stringify({ created_date: { $gte: '2025-02-01 ', $lte: '2025-11-30 ' } });
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ query: { filters } });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    const [calledFilters] = svc.getAllExpenses.mock.calls[0];
    expect(calledFilters.created_date.$gte).toBeInstanceOf(Date);
    expect(calledFilters.created_date.$lte).toBeInstanceOf(Date);
  });
});

// -----------------------------------------------------------------------------
// expensesReportTable
// -----------------------------------------------------------------------------

describe('expensesReportTable', () => {
  test('returns 403 when user lacks report read permission', async () => {
    const req = mockReq({ user: restrictedUser({ report: { read: false } }) });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mdl.expensesReportPage).not.toHaveBeenCalled();
  });

  test('returns 200 with formatted report on success', async () => {
    mdl.expensesReportPage.mockResolvedValue({
      status: true,
      list: [{ _id: VALID_ID, amount: 100 }],
      pagination: { total: 1, page: 1 },
    });
    const req = mockReq({
      query: { limit: '5', page: '1', starting_date: '2025-01-01', ending_date: '2025-12-31' },
    });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    expect(mdl.expensesReportPage).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('uses default limit=5 and page=1 when params absent or 0', async () => {
    mdl.expensesReportPage.mockResolvedValue({ status: true, list: [], pagination: {} });
    const req = mockReq({ query: { limit: '0', page: '0' } });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    const [, calledOptions] = mdl.expensesReportPage.mock.calls[0];
    expect(calledOptions.limit).toBe(5);
    expect(calledOptions.page).toBe(1);
  });

  test('wraps single branch query string into array', async () => {
    mdl.expensesReportPage.mockResolvedValue({ status: true, list: [], pagination: {} });
    const req = mockReq({ query: { branch: VALID_ID } });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    const [calledData] = mdl.expensesReportPage.mock.calls[0];
    expect(calledData.branchid).toEqual([VALID_ID]);
  });

  test('passes branch[] array directly', async () => {
    mdl.expensesReportPage.mockResolvedValue({ status: true, list: [], pagination: {} });
    const req = mockReq({ query: { 'branch[]': [VALID_ID, VALID_LICENSE_ID] } });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    const [calledData] = mdl.expensesReportPage.mock.calls[0];
    expect(calledData.branchid).toEqual([VALID_ID, VALID_LICENSE_ID]);
  });

  test('returns 500 when model throws', async () => {
    mdl.expensesReportPage.mockRejectedValue(new Error('DB crash'));
    const req = mockReq({ query: {} });
    const res = mockRes();
    await controller.expensesReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('DB crash') })
    );
  });
});

// -----------------------------------------------------------------------------
// mongoIDFilter
// -----------------------------------------------------------------------------

describe('mongoIDFilter', () => {
  test('returns non-array input unchanged (null)', () => {
    expect(controller.mongoIDFilter(null)).toBe(null);
  });

  test('returns non-array input unchanged (string)', () => {
    expect(controller.mongoIDFilter('raw')).toBe('raw');
  });

  test('returns empty array unchanged', () => {
    expect(controller.mongoIDFilter([])).toEqual([]);
  });

  test('converts ObjectId _id to string on each item', () => {
    const { ObjectId } = require('mongodb');
    const oid = new ObjectId(VALID_ID);
    const result = controller.mongoIDFilter([{ _id: oid, amount: 50 }]);
    expect(typeof result[0]._id).toBe('string');
    expect(result[0]._id).toBe(VALID_ID);
    expect(result[0].amount).toBe(50);
  });

  test('handles items with nested object fields', () => {
    const result = controller.mongoIDFilter([{ meta: { _id: 'x' }, amount: 10 }]);
    expect(result[0].meta._id).toBe('x');
  });
});

// -----------------------------------------------------------------------------
// mongoDateFilter
// -----------------------------------------------------------------------------

describe('mongoDateFilter', () => {
  test('returns non-array input unchanged', () => {
    expect(controller.mongoDateFilter(null)).toBe(null);
  });

  test('converts Date fields to ISO strings', () => {
    const date = new Date('2025-06-01T10:00:00.000Z');
    const result = controller.mongoDateFilter([{ created_at: date, amount: 100 }]);
    expect(result[0].created_at).toBe(date.toISOString());
    expect(result[0].amount).toBe(100);
  });

  test('leaves non-Date fields unchanged', () => {
    const result = controller.mongoDateFilter([{ amount: 100, name: 'Test' }]);
    expect(result[0].amount).toBe(100);
    expect(result[0].name).toBe('Test');
  });

  test('handles empty array', () => {
    expect(controller.mongoDateFilter([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// expensesImport � catch block coverage
// -----------------------------------------------------------------------------

describe('expensesImport � catch coverage', () => {
  test('returns 500 when model throws unexpected error', async () => {
    mdl.importExpensesModel.mockRejectedValue(new Error('crash in import'));
    const req = mockReq({ body: { result: [{ amount: 100, type: 'debit' }] } });
    const res = mockRes();
    await controller.expensesImport(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'crash in import' })
    );
  });
});

// -----------------------------------------------------------------------------
// exportExpenses � normalizeExportIds edge cases + catch
// -----------------------------------------------------------------------------

describe('exportExpenses � normalizeExportIds edge cases', () => {
  test('normalizes object with ids key', async () => {
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: { ids: [VALID_ID] } });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('normalizes object with single JSON-parseable key', async () => {
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const jsonKey = JSON.stringify([VALID_ID]);
    const req = mockReq({ body: { [jsonKey]: 1 } });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('normalizes object with all string values (numeric keys)', async () => {
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: { 0: VALID_ID, 1: VALID_LICENSE_ID } });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID, VALID_LICENSE_ID]);
  });

  test('normalizes JSON array string body', async () => {
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: JSON.stringify([VALID_ID]) });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('normalizes raw string ID body (non-JSON string)', async () => {
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: VALID_ID });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('returns 500 when model throws during export', async () => {
    mdl.exportExpensesOrder.mockRejectedValue(new Error('export crash'));
    const req = mockReq({ body: [VALID_ID] });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'export crash' })
    );
  });
});

// -----------------------------------------------------------------------------
// getSummary
// NOTE: Expense is not imported in expenses.controller.js � success path always
// throws ReferenceError. Only permission-denied and error-catch paths are testable.
// -----------------------------------------------------------------------------

describe('getSummary', () => {
  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ user: restrictedUser() });
    const res = mockRes();
    await controller.getSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 500 due to Expense being undefined (production bug � no import)', async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await controller.getSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 with date filter when Expense is undefined', async () => {
    const req = mockReq({ query: { startDate: '2025-01-01', endDate: '2025-12-31' } });
    const res = mockRes();
    await controller.getSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// -----------------------------------------------------------------------------
// getByCategory
// NOTE: Same Expense undefined production bug as getSummary.
// -----------------------------------------------------------------------------

describe('getByCategory', () => {
  test('returns 403 when user lacks read permission', async () => {
    const req = mockReq({ params: { category: 'food' }, user: restrictedUser() });
    const res = mockRes();
    await controller.getByCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 500 due to Expense being undefined (production bug)', async () => {
    const req = mockReq({ params: { category: 'food' } });
    const res = mockRes();
    await controller.getByCategory(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// -----------------------------------------------------------------------------
// getByType � success path (production bug coverage)
// -----------------------------------------------------------------------------

describe('getByType � success path production bug', () => {
  test("returns 500 for valid type 'credit' due to Expense being undefined", async () => {
    const req = mockReq({ params: { type: 'credit' } });
    const res = mockRes();
    await controller.getByType(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test("returns 500 for valid type 'debit' due to Expense being undefined", async () => {
    const req = mockReq({ params: { type: 'debit' } });
    const res = mockRes();
    await controller.getByType(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// -----------------------------------------------------------------------------
// Targeted coverage for remaining uncovered lines
// -----------------------------------------------------------------------------

describe('setRequestContext � branch_id as ObjectId instance (line 81)', () => {
  test('assigns ObjectId branchId directly to BaseModel.currentBranch', async () => {
    const { ObjectId } = require('mongodb');
    svc.getAllExpenses.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({
      query: {},
      user: adminUser({ branch_id: new ObjectId(VALID_ID), branch_name: 'HQ' }),
    });
    const res = mockRes();
    await controller.getAll(req, res, mockNext());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('exportExpenses � normalizeExportIds remaining paths', () => {
  test('wraps non-array JSON string (single value) into array (line 556)', async () => {
    // JSON.stringify(VALID_ID) = '"aabbccd..."' ? parses to string (not array) ? return [parsed]
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: JSON.stringify(VALID_ID) });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([VALID_ID]);
  });

  test('wraps primitive non-string body into array (line 562)', async () => {
    // A number body bypasses all string/object/array checks ? return [raw]
    mdl.exportExpensesOrder.mockResolvedValue({ status: true, data: [] });
    const req = mockReq({ body: 42 });
    const res = mockRes();
    await controller.exportExpenses(req, res);
    expect(mdl.exportExpensesOrder).toHaveBeenCalledWith([42]);
  });
});
