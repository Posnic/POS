'use strict';

/**
 * Unit tests for src/services/expense.service.js
 *
 * File confirmed  : src/services/expense.service.js (195 lines)
 * Export type     : CLASS export — `module.exports = ExpenseService`
 * Does NOT extend : base.service.js
 * Constructor     : `this.repository = new ExpenseRepository()`
 * No mongodb.ObjectId usage — no ObjectId mock needed.
 *
 * Methods (6):
 *   getAllExpenses(filters, options)
 *     — Promise.all([findAll, findLatest]); returns nested pagination shape
 *       with last_created_id; BOTH promises must resolve for success
 *   getExpenseById(id)
 *     — findById + not-found check
 *   createExpense(expenseData)
 *     — validates amount + type BOTH required; returns expense._id.toString()
 *       as data (NOT the expense object)
 *   updateExpense(id, updateData)
 *     — findById existence check + update; returns updated expense object
 *   deleteExpenses(ids)
 *     — Array.isArray + non-empty guard; softDeleteMany; returns raw
 *       deletedCount (number) as data and in message template
 *   getExpenseSummary(filters)
 *     — simple delegation to getSummary; NO not-found check
 *
 * External dependencies (all mocked):
 *   ExpenseRepository (class) — explicit factory mock
 *
 * PRODUCTION NOTES:
 *   1. `createExpense` validates `!expenseData.amount || !expenseData.type` — this
 *      means amount=0 is treated as missing (falsy check, not typeof). A zero-amount
 *      expense will be incorrectly rejected with "Amount and type are required".
 *   2. `createExpense` returns `expense._id.toString()` as `data` — inconsistent
 *      with all other methods that return the full document. The caller cannot
 *      immediately display the created expense without a second GET request.
 *   3. `deleteExpenses` returns the raw number (deletedCount) as `data`, not an
 *      object like `{deletedCount}` — different shape from bulkDeleteCustomers.
 *   4. `getAllExpenses` fires `Promise.all([findAll, findLatest])` — if `findLatest`
 *      throws, the entire operation fails even though the list data was successfully
 *      retrieved. Both failures produce the same generic error response.
 *   5. `getExpenseSummary` has no not-found/null check — returns `{status:true,
 *      data:null}` when the repository returns null, which could confuse callers.
 *   6. `console.error` used throughout instead of structured logger.
 */

// ─── Mock ExpenseRepository (class — explicit factory) ────────────────────────
jest.mock('../../../src/repositories/expense.repository', () => jest.fn());

// ─── Requires ─────────────────────────────────────────────────────────────────
const ExpenseRepository = require('../../../src/repositories/expense.repository');
const ExpenseService = require('../../../src/services/expense.service');

// ─── Mock data ────────────────────────────────────────────────────────────────
const EXPENSE_ID = '64a1b2c3d4e5f6a7b8c9d021';
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d022';

function makeMockExpense(overrides = {}) {
  return {
    _id: { toString: () => EXPENSE_ID },
    title: 'Office Rent',
    amount: 1500,
    type: 'fixed',
    category_id: 'cat_001',
    branch_id: BRANCH_ID,
    expense_date: new Date('2026-01-01T00:00:00.000Z'),
    is_deleted: false,
    ...overrides,
  };
}

function makePaginatedResult(overrides = {}) {
  return {
    data: [makeMockExpense()],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findAll: jest.fn(),
    findLatest: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDeleteMany: jest.fn(),
    getSummary: jest.fn(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('ExpenseService', () => {
  let service;
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const repoMethods = makeRepoMethods();
    ExpenseRepository.mockImplementation(() => repoMethods);
    service = new ExpenseService();
    repo = service.repository;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('ExpenseService exports a class (not a singleton)', () => {
      expect(typeof ExpenseService).toBe('function');
    });

    test('constructor creates instance with repository', () => {
      expect(service.repository).toBeDefined();
    });

    test('instantiates ExpenseRepository in constructor', () => {
      expect(ExpenseRepository).toHaveBeenCalledTimes(1);
    });

    test('exposes all 6 service methods', () => {
      const methods = [
        'getAllExpenses',
        'getExpenseById',
        'createExpense',
        'updateExpense',
        'deleteExpenses',
        'getExpenseSummary',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAllExpenses
  // ══════════════════════════════════════════════════════════════════════════
  describe('getAllExpenses', () => {
    const defaultPaginated = () => makePaginatedResult();

    // ── success ─────────────────────────────────────────────────────────────
    test('calls findAll and findLatest concurrently via Promise.all', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockResolvedValue(EXPENSE_ID);

      await service.getAllExpenses();

      expect(repo.findAll).toHaveBeenCalledTimes(1);
      expect(repo.findLatest).toHaveBeenCalledTimes(1);
    });

    test('passes filters and options to repository.findAll', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockResolvedValue(EXPENSE_ID);
      const filters = { branch_id: BRANCH_ID };
      const options = { page: 2, limit: 5 };

      await service.getAllExpenses(filters, options);

      expect(repo.findAll).toHaveBeenCalledWith(filters, options);
    });

    test('returns correct nested data shape on success', async () => {
      const paginated = makePaginatedResult({
        data: [makeMockExpense()],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 3,
      });
      repo.findAll.mockResolvedValue(paginated);
      repo.findLatest.mockResolvedValue(EXPENSE_ID);

      const result = await service.getAllExpenses();

      expect(result).toEqual({
        status: true,
        data: {
          list: paginated.data,
          total: 1,
          current_page: 2,
          per_page: 5,
          total_pages: 3,
          last_created_id: EXPENSE_ID,
        },
        message: 'Expenses retrieved successfully',
      });
    });

    test('populates last_created_id from findLatest result', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockResolvedValue('latest_id_999');

      const result = await service.getAllExpenses();

      expect(result.data.last_created_id).toBe('latest_id_999');
    });

    test('last_created_id is null when findLatest returns null', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockResolvedValue(null);

      const result = await service.getAllExpenses();

      expect(result.data.last_created_id).toBeNull();
    });

    test('handles empty expense list', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult({ data: [], total: 0, totalPages: 0 }));
      repo.findLatest.mockResolvedValue(null);

      const result = await service.getAllExpenses();

      expect(result.status).toBe(true);
      expect(result.data.list).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns error shape when findAll throws', async () => {
      repo.findAll.mockRejectedValue(new Error('DB error'));
      repo.findLatest.mockResolvedValue(null);

      const result = await service.getAllExpenses();

      expect(result).toEqual({ status: false, data: null, message: 'DB error' });
    });

    test('returns error shape when findLatest throws', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockRejectedValue(new Error('Latest query failed'));

      const result = await service.getAllExpenses();

      expect(result.status).toBe(false);
      expect(result.message).toBe('Latest query failed');
    });

    test('does not re-throw on error', async () => {
      repo.findAll.mockRejectedValue(new Error('crash'));
      repo.findLatest.mockResolvedValue(null);

      await expect(service.getAllExpenses()).resolves.not.toThrow();
    });

    test('handles default empty filters and options', async () => {
      repo.findAll.mockResolvedValue(defaultPaginated());
      repo.findLatest.mockResolvedValue(null);

      const result = await service.getAllExpenses();

      expect(repo.findAll).toHaveBeenCalledWith({}, {});
      expect(result.status).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getExpenseById
  // ══════════════════════════════════════════════════════════════════════════
  describe('getExpenseById', () => {
    test('calls repository.findById with provided id', async () => {
      repo.findById.mockResolvedValue(makeMockExpense());

      await service.getExpenseById(EXPENSE_ID);

      expect(repo.findById).toHaveBeenCalledWith(EXPENSE_ID);
    });

    test('returns {status:true, data:expense} when found', async () => {
      const expense = makeMockExpense();
      repo.findById.mockResolvedValue(expense);

      const result = await service.getExpenseById(EXPENSE_ID);

      expect(result).toEqual({
        status: true,
        data: expense,
        message: 'Expense retrieved successfully',
      });
    });

    test('returns {status:false, "Expense not found"} when null', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.getExpenseById('missing');

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Expense not found',
      });
    });

    test('returns {status:false, "Expense not found"} when undefined', async () => {
      repo.findById.mockResolvedValue(undefined);

      const result = await service.getExpenseById('bad-id');

      expect(result.status).toBe(false);
      expect(result.message).toBe('Expense not found');
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('Query failed'));

      const result = await service.getExpenseById(EXPENSE_ID);

      expect(result).toEqual({ status: false, data: null, message: 'Query failed' });
    });

    test('does not re-throw on error', async () => {
      repo.findById.mockRejectedValue(new Error('crash'));
      await expect(service.getExpenseById(EXPENSE_ID)).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createExpense
  // ══════════════════════════════════════════════════════════════════════════
  describe('createExpense', () => {
    const validPayload = () => ({ amount: 1500, type: 'fixed', title: 'Office Rent' });

    // ── validation ──────────────────────────────────────────────────────────
    test('returns error when amount is missing', async () => {
      const result = await service.createExpense({ type: 'fixed' });
      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Amount and type are required',
      });
    });

    test('returns error when type is missing', async () => {
      const result = await service.createExpense({ amount: 1500 });
      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Amount and type are required',
      });
    });

    test('returns error when both amount and type are missing', async () => {
      const result = await service.createExpense({ title: 'Rent' });
      expect(result.status).toBe(false);
    });

    test('returns error for empty object payload', async () => {
      const result = await service.createExpense({});
      expect(result.status).toBe(false);
    });

    test('does NOT call repository.create when validation fails', async () => {
      await service.createExpense({ type: 'fixed' });
      expect(repo.create).not.toHaveBeenCalled();
    });

    test('treats amount=0 as missing (falsy check — production note)', async () => {
      // amount=0 fails !expenseData.amount check — documented as production issue
      const result = await service.createExpense({ amount: 0, type: 'fixed' });
      expect(result.status).toBe(false);
      expect(result.message).toBe('Amount and type are required');
    });

    test('treats empty string type as missing', async () => {
      const result = await service.createExpense({ amount: 1500, type: '' });
      expect(result.status).toBe(false);
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('calls repository.create with full expenseData', async () => {
      const expense = makeMockExpense();
      repo.create.mockResolvedValue(expense);

      await service.createExpense(validPayload());

      expect(repo.create).toHaveBeenCalledWith(validPayload());
    });

    test('returns expense._id.toString() as data (not the full object)', async () => {
      const expense = makeMockExpense();
      repo.create.mockResolvedValue(expense);

      const result = await service.createExpense(validPayload());

      expect(result).toEqual({
        status: true,
        data: EXPENSE_ID,
        message: 'Expense added successfully',
      });
      // Confirm data is the string ID, not the expense object
      expect(typeof result.data).toBe('string');
    });

    test('allows decimal amount', async () => {
      repo.create.mockResolvedValue(makeMockExpense({ amount: 99.99 }));

      const result = await service.createExpense({ amount: 99.99, type: 'variable' });

      expect(result.status).toBe(true);
    });

    test('allows very large amount', async () => {
      repo.create.mockResolvedValue(makeMockExpense({ amount: 9999999 }));

      const result = await service.createExpense({ amount: 9999999, type: 'fixed' });

      expect(result.status).toBe(true);
    });

    test('creates expense without optional title/description/category', async () => {
      repo.create.mockResolvedValue(makeMockExpense());

      const result = await service.createExpense({ amount: 500, type: 'fixed' });

      expect(result.status).toBe(true);
      expect(repo.create).toHaveBeenCalledWith({ amount: 500, type: 'fixed' });
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns error shape on repository.create throw', async () => {
      repo.create.mockRejectedValue(new Error('Insert failed'));

      const result = await service.createExpense(validPayload());

      expect(result).toEqual({ status: false, data: null, message: 'Insert failed' });
    });

    test('does not re-throw on error', async () => {
      repo.create.mockRejectedValue(new Error('crash'));
      await expect(service.createExpense(validPayload())).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateExpense
  // ══════════════════════════════════════════════════════════════════════════
  describe('updateExpense', () => {
    test('calls repository.findById to check existence', async () => {
      repo.findById.mockResolvedValue(makeMockExpense());
      repo.update.mockResolvedValue(makeMockExpense());

      await service.updateExpense(EXPENSE_ID, { amount: 2000 });

      expect(repo.findById).toHaveBeenCalledWith(EXPENSE_ID);
    });

    test('returns {status:false, "Expense not found"} when expense missing', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.updateExpense('missing', { amount: 2000 });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Expense not found',
      });
    });

    test('does NOT call repository.update when expense not found', async () => {
      repo.findById.mockResolvedValue(null);

      await service.updateExpense(EXPENSE_ID, { amount: 2000 });

      expect(repo.update).not.toHaveBeenCalled();
    });

    test('calls repository.update with id and updateData', async () => {
      repo.findById.mockResolvedValue(makeMockExpense());
      const updateData = { amount: 2000, title: 'Updated Rent' };
      repo.update.mockResolvedValue(makeMockExpense(updateData));

      await service.updateExpense(EXPENSE_ID, updateData);

      expect(repo.update).toHaveBeenCalledWith(EXPENSE_ID, updateData);
    });

    test('returns {status:true, data:updatedExpense} on success', async () => {
      const updated = makeMockExpense({ amount: 2000 });
      repo.findById.mockResolvedValue(makeMockExpense());
      repo.update.mockResolvedValue(updated);

      const result = await service.updateExpense(EXPENSE_ID, { amount: 2000 });

      expect(result).toEqual({
        status: true,
        data: updated,
        message: 'Expense updated successfully',
      });
    });

    test('returns full updated expense object (not just ID)', async () => {
      const updated = makeMockExpense({ amount: 2000 });
      repo.findById.mockResolvedValue(makeMockExpense());
      repo.update.mockResolvedValue(updated);

      const result = await service.updateExpense(EXPENSE_ID, { amount: 2000 });

      // Update returns the full object, unlike create which returns only _id.toString()
      expect(result.data).toEqual(updated);
    });

    test('allows updating with empty updateData object', async () => {
      repo.findById.mockResolvedValue(makeMockExpense());
      repo.update.mockResolvedValue(makeMockExpense());

      const result = await service.updateExpense(EXPENSE_ID, {});

      expect(result.status).toBe(true);
    });

    test('returns error shape on repository.findById throw', async () => {
      repo.findById.mockRejectedValue(new Error('DB lock'));

      const result = await service.updateExpense(EXPENSE_ID, {});

      expect(result.status).toBe(false);
      expect(result.message).toBe('DB lock');
    });

    test('returns error shape on repository.update throw', async () => {
      repo.findById.mockResolvedValue(makeMockExpense());
      repo.update.mockRejectedValue(new Error('Update failed'));

      const result = await service.updateExpense(EXPENSE_ID, { amount: 500 });

      expect(result.status).toBe(false);
    });

    test('does not re-throw on error', async () => {
      repo.findById.mockRejectedValue(new Error('crash'));
      await expect(service.updateExpense(EXPENSE_ID, {})).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteExpenses
  // ══════════════════════════════════════════════════════════════════════════
  describe('deleteExpenses', () => {
    // ── validation ──────────────────────────────────────────────────────────
    test('returns error when ids is null', async () => {
      const result = await service.deleteExpenses(null);
      expect(result).toEqual({
        status: false,
        data: 0,
        message: 'No expense IDs provided',
      });
    });

    test('returns error when ids is not an array', async () => {
      const result = await service.deleteExpenses('not-array');
      expect(result.status).toBe(false);
      expect(result.data).toBe(0);
    });

    test('returns error when ids is empty array', async () => {
      const result = await service.deleteExpenses([]);
      expect(result).toEqual({
        status: false,
        data: 0,
        message: 'No expense IDs provided',
      });
    });

    test('returns error when ids is undefined', async () => {
      const result = await service.deleteExpenses(undefined);
      expect(result.status).toBe(false);
    });

    test('does NOT call repository when ids is empty', async () => {
      await service.deleteExpenses([]);
      expect(repo.softDeleteMany).not.toHaveBeenCalled();
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('calls repository.softDeleteMany with ids array', async () => {
      repo.softDeleteMany.mockResolvedValue(3);
      const ids = ['id1', 'id2', 'id3'];

      await service.deleteExpenses(ids);

      expect(repo.softDeleteMany).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:deletedCount} on success', async () => {
      repo.softDeleteMany.mockResolvedValue(2);

      const result = await service.deleteExpenses(['id1', 'id2']);

      expect(result).toEqual({
        status: true,
        data: 2,
        message: '2 expense(s) deleted successfully',
      });
    });

    test('data is raw number (not {deletedCount} object)', async () => {
      repo.softDeleteMany.mockResolvedValue(1);

      const result = await service.deleteExpenses(['id1']);

      expect(typeof result.data).toBe('number');
      expect(result.data).toBe(1);
    });

    test('message includes the exact count from repository', async () => {
      repo.softDeleteMany.mockResolvedValue(5);

      const result = await service.deleteExpenses(['id1', 'id2', 'id3', 'id4', 'id5']);

      expect(result.message).toBe('5 expense(s) deleted successfully');
    });

    test('returns {status:true, data:0} when softDeleteMany returns 0', async () => {
      repo.softDeleteMany.mockResolvedValue(0);

      const result = await service.deleteExpenses(['nonexistent']);

      expect(result.status).toBe(true);
      expect(result.data).toBe(0);
      expect(result.message).toBe('0 expense(s) deleted successfully');
    });

    test('handles single-element ids array', async () => {
      repo.softDeleteMany.mockResolvedValue(1);

      const result = await service.deleteExpenses([EXPENSE_ID]);

      expect(result.status).toBe(true);
      expect(repo.softDeleteMany).toHaveBeenCalledWith([EXPENSE_ID]);
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns error shape on repository throw', async () => {
      repo.softDeleteMany.mockRejectedValue(new Error('bulk delete fail'));

      const result = await service.deleteExpenses(['id1']);

      expect(result).toEqual({ status: false, data: 0, message: 'bulk delete fail' });
    });

    test('error response data is 0 (not null) — matches validation failure shape', async () => {
      repo.softDeleteMany.mockRejectedValue(new Error('fail'));

      const result = await service.deleteExpenses(['id1']);

      expect(result.data).toBe(0);
    });

    test('does not re-throw on error', async () => {
      repo.softDeleteMany.mockRejectedValue(new Error('crash'));
      await expect(service.deleteExpenses(['id1'])).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getExpenseSummary
  // ══════════════════════════════════════════════════════════════════════════
  describe('getExpenseSummary', () => {
    test('calls repository.getSummary with provided filters', async () => {
      repo.getSummary.mockResolvedValue({});
      const filters = { branch_id: BRANCH_ID, month: '2026-01' };

      await service.getExpenseSummary(filters);

      expect(repo.getSummary).toHaveBeenCalledWith(filters);
    });

    test('calls repository.getSummary with empty object when no filters', async () => {
      repo.getSummary.mockResolvedValue({});

      await service.getExpenseSummary();

      expect(repo.getSummary).toHaveBeenCalledWith({});
    });

    test('returns {status:true, data:summary} on success', async () => {
      const summary = { total: 5000, count: 3, average: 1666.67 };
      repo.getSummary.mockResolvedValue(summary);

      const result = await service.getExpenseSummary();

      expect(result).toEqual({
        status: true,
        data: summary,
        message: 'Expense summary retrieved successfully',
      });
    });

    test('returns {status:true, data:null} when getSummary returns null (no not-found guard)', async () => {
      // Production note: no null check — service wraps null in success response
      repo.getSummary.mockResolvedValue(null);

      const result = await service.getExpenseSummary();

      expect(result.status).toBe(true);
      expect(result.data).toBeNull();
    });

    test('returns {status:true, data:[]} for empty summary result', async () => {
      repo.getSummary.mockResolvedValue([]);

      const result = await service.getExpenseSummary();

      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('applies branch_id filter', async () => {
      repo.getSummary.mockResolvedValue({ total: 1000 });

      await service.getExpenseSummary({ branch_id: BRANCH_ID });

      expect(repo.getSummary).toHaveBeenCalledWith({ branch_id: BRANCH_ID });
    });

    test('returns error shape on repository throw', async () => {
      repo.getSummary.mockRejectedValue(new Error('aggregation fail'));

      const result = await service.getExpenseSummary();

      expect(result).toEqual({ status: false, data: null, message: 'aggregation fail' });
    });

    test('does not re-throw on error', async () => {
      repo.getSummary.mockRejectedValue(new Error('crash'));
      await expect(service.getExpenseSummary()).resolves.not.toThrow();
    });
  });
});
