'use strict';

/**
 * Unit tests for src/models/expense.model.js
 *
 * File confirmed: src/models/expense.model.js (only expense model — no duplicates)
 * Type: Native MongoDB driver query model — ExpenseModel extends BaseModel
 *
 * Strategy: Mocked database tests
 *   - BaseModel fully mocked (prevents real DB connection)
 *   - static helpers (startingDate, endingDate, simplifyFields, deletedDocumentBackup)
 *     provided on MockBaseModel so deleteExpenseCollectionData's local
 *     require('./base.model') also receives the mock
 *   - getCollection() spied per test to return a mock collection
 *   - Inherited instance helpers (checkPlan, page, getOneRow, getAllDataChanges,
 *     toObjectId, getSelectFields, assignFilterObjects) spied per test
 */

// ─── Mock BaseModel (hoisted) ─────────────────────────────────────────────────

jest.mock('../../../src/models/base.model', () => {
  const { ObjectId } = require('mongodb');

  class MockBaseModel {
    static mongoClient = {};
    static database = {};
    static currentBranch = null;
    static currentBranchName = null;
    static license = null;
    static loggedUser = null;
    static loggedUserName = null;
    static currentTimeZone = 'Asia/Kolkata';

    static startingDate(d) {
      return d ? new Date(d) : new Date(0);
    }
    static endingDate(d) {
      return d ? new Date(d) : new Date();
    }
    static simplifyFields(doc) {
      return doc ? { ...doc } : doc;
    }
    static async deletedDocumentBackup() {
      return { status: true };
    }

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    }
    async checkPlan() {
      return -1;
    }
    async page() {
      return { status: true, data: {} };
    }
    async getOneRow() {
      return { status: false, data: null, message: 'Not found' };
    }
    async getAllDataChanges() {
      return { status: true, data: [] };
    }
    assignFilterObjects(f) {
      return f;
    }
    startingDate(d) {
      return d ? new Date(d) : new Date(0);
    }
    endingDate(d) {
      return d ? new Date(d) : new Date();
    }
    toObjectId(v) {
      if (!v) return null;
      try {
        return new ObjectId(String(v));
      } catch {
        return null;
      }
    }
    getSelectFields(fields) {
      const proj = {};
      if (fields) {
        for (const [k, v] of Object.entries(fields)) {
          proj[k] = v.select ? 1 : 0;
        }
      }
      return proj;
    }
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const { ObjectId } = require('mongodb');
const ExpenseModel = require('../../../src/models/expense.model');
const MockBaseModel = require('../../../src/models/base.model');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const newId = () => new ObjectId();
const strId = () => newId().toString();

function makeCursor(docs) {
  return {
    sort: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(docs),
  };
}

function makeCollection(overrides = {}) {
  return {
    insertOne: jest.fn().mockResolvedValue({ insertedId: newId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    find: jest.fn().mockReturnValue(makeCursor([])),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    insertMany: jest.fn().mockResolvedValue({ insertedIds: {} }),
    countDocuments: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ─── Shared state ─────────────────────────────────────────────────────────────

let em;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  MockBaseModel.currentBranch = newId();
  MockBaseModel.currentBranchName = 'Test Branch';
  MockBaseModel.license = newId();
  MockBaseModel.loggedUser = newId();
  MockBaseModel.loggedUserName = 'Tester';

  em = new ExpenseModel();
  em.branchId = newId();
  em.branchName = 'Test Branch';
  em.licenseId = newId();
  em.user = { _id: newId(), username: 'tester' };
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Class structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — class structure', () => {
  test('module exports a class', () => {
    expect(typeof ExpenseModel).toBe('function');
  });

  test('instance is a subclass of MockBaseModel', () => {
    expect(em).toBeInstanceOf(MockBaseModel);
  });

  test('constructor sets collectionName to "expenses"', () => {
    expect(em.collectionName).toBe('expenses');
  });

  test('this.fields is an object defined on the instance', () => {
    expect(typeof em.fields).toBe('object');
    expect(em.fields).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. this.fields — definitions
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — this.fields definitions', () => {
  test('contains all expected keys', () => {
    const keys = Object.keys(em.fields);
    expect(keys).toEqual(
      expect.arrayContaining([
        '_id',
        'branch_id',
        'branch_name',
        'amount',
        'type',
        'category',
        'recipientname',
        'approvedby',
        'description',
        'date',
        'created_date',
        'updated_date',
        'created_by_id',
        'created_by',
        'updated_by_id',
        'updated_by',
        'license',
      ])
    );
  });

  test('amount, type, category, description have select:true', () => {
    for (const f of ['amount', 'type', 'category', 'description']) {
      expect(em.fields[f].select).toBe(true);
    }
  });

  test('branch_id, branch_name, license, created_by, updated_by have select:false', () => {
    for (const f of ['branch_id', 'branch_name', 'license', 'created_by', 'updated_by']) {
      expect(em.fields[f].select).toBe(false);
    }
  });

  test('_id type is ObjectId', () => {
    expect(em.fields._id.type).toBe('ObjectId');
  });

  test('amount type is Double', () => {
    expect(em.fields.amount.type).toBe('Double');
  });

  test('date, created_date, updated_date type is Date', () => {
    for (const f of ['date', 'created_date', 'updated_date']) {
      expect(em.fields[f].type).toBe('Date');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. expensesInsertUpdate() — INSERT
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — expensesInsertUpdate() INSERT', () => {
  const expData = {
    amount: '1500.50',
    type: 'Operating',
    category: 'Rent',
    recipientname: 'Alice',
    approvedby: 'Bob',
    description: 'Monthly rent',
    date: '2024-01-15',
  };

  beforeEach(() => {
    jest.spyOn(em, 'getCollection').mockResolvedValue(makeCollection());
  });

  test('returns status:true with insertedId string on success', async () => {
    const r = await em.expensesInsertUpdate(expData);
    expect(r.status).toBe(true);
    expect(typeof r.data).toBe('string');
    expect(r.message).toBe('Expense added successfully');
  });

  test('calls insertOne and parses amount to float', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData);
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.amount).toBe(1500.5);
  });

  test('defaults description to empty string when not provided', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate({ ...expData, description: undefined });
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.description).toBe('');
  });

  test('stores branch_name from em.branchName', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData);
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.branch_name).toBe('Test Branch');
  });

  test('stores license from em.licenseId', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData);
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.license).toEqual(em.licenseId);
  });

  test('sets created_by from em.user.username', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData);
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.created_by).toBe('tester');
  });

  test('falls back to "system" for created_by when em.user is null', async () => {
    em.user = null;
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData);
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.created_by).toBe('system');
  });

  test('falls back to now when date is invalid string', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    const before = new Date();
    await em.expensesInsertUpdate({ ...expData, date: 'not-a-date' });
    const after = new Date();
    const [doc] = col.insertOne.mock.calls[0];
    expect(doc.date >= before).toBe(true);
    expect(doc.date <= after).toBe(true);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'getCollection').mockRejectedValue(new Error('insert fail'));
    const r = await em.expensesInsertUpdate(expData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('insert fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. expensesInsertUpdate() — UPDATE
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — expensesInsertUpdate() UPDATE', () => {
  const expData = {
    amount: '500',
    type: 'Travel',
    category: 'Fuel',
    recipientname: 'Bob',
    approvedby: 'Admin',
    description: 'Trip',
    date: '2024-02-01',
  };
  const existingId = strId();

  beforeEach(() => {
    jest.spyOn(em, 'getCollection').mockResolvedValue(makeCollection());
  });

  test('returns status:true with modifiedCount on success', async () => {
    const r = await em.expensesInsertUpdate(expData, existingId);
    expect(r.status).toBe(true);
    expect(r.data).toBe(1);
    expect(r.message).toBe('Expense updated successfully');
  });

  test('calls updateOne with $set containing updated fields', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData, existingId);
    const [, updateArg] = col.updateOne.mock.calls[0];
    expect(updateArg.$set.amount).toBe(500);
    expect(updateArg.$set.type).toBe('Travel');
  });

  test('does NOT include created_date or created_by in $set', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData, existingId);
    const [, updateArg] = col.updateOne.mock.calls[0];
    expect(updateArg.$set.created_date).toBeUndefined();
    expect(updateArg.$set.created_by).toBeUndefined();
  });

  test('uses licenseId in the $match filter', async () => {
    const col = makeCollection();
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.expensesInsertUpdate(expData, existingId);
    const [matchArg] = col.updateOne.mock.calls[0];
    expect(matchArg.license).toEqual(em.licenseId);
    expect(matchArg._id).toBeInstanceOf(ObjectId);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'getCollection').mockRejectedValue(new Error('update fail'));
    const r = await em.expensesInsertUpdate(expData, existingId);
    expect(r.status).toBe(false);
    expect(r.message).toBe('update fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. deleteExpenseCollectionData()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — deleteExpenseCollectionData()', () => {
  const id1 = strId();
  const id2 = strId();
  const docs = [
    { _id: new ObjectId(id1), amount: 100 },
    { _id: new ObjectId(id2), amount: 200 },
  ];

  test('returns status:true with deletedCount on success', async () => {
    const col = makeCollection({
      find: jest.fn().mockReturnValue(makeCursor(docs)),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    jest.spyOn(MockBaseModel, 'deletedDocumentBackup').mockResolvedValue({ status: true });

    const r = await em.deleteExpenseCollectionData([id1, id2]);
    expect(r.status).toBe(true);
    expect(r.data).toBe(2);
    expect(r.message).toBe('Expenses deleted successfully');
  });

  test('calls find with objectIds and licenseId before deletion', async () => {
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor(docs)) });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    jest.spyOn(MockBaseModel, 'deletedDocumentBackup').mockResolvedValue({ status: true });

    await em.deleteExpenseCollectionData([id1]);
    const [filter] = col.find.mock.calls[0];
    expect(filter._id.$in[0]).toBeInstanceOf(ObjectId);
    expect(filter.license).toEqual(em.licenseId);
  });

  test('calls deletedDocumentBackup once per found document', async () => {
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor(docs)) });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    const backupSpy = jest
      .spyOn(MockBaseModel, 'deletedDocumentBackup')
      .mockResolvedValue({ status: true });

    await em.deleteExpenseCollectionData([id1, id2]);
    expect(backupSpy).toHaveBeenCalledTimes(2);
    expect(backupSpy).toHaveBeenCalledWith(
      'expenses',
      expect.objectContaining({ _id: expect.any(ObjectId) })
    );
  });

  test('calls deleteMany with $in objectIds filter', async () => {
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor([])) });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    await em.deleteExpenseCollectionData([id1]);
    const [filter] = col.deleteMany.mock.calls[0];
    expect(filter._id.$in[0]).toBeInstanceOf(ObjectId);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'getCollection').mockRejectedValue(new Error('delete fail'));
    const r = await em.deleteExpenseCollectionData([id1]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('delete fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. importExpensesModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — importExpensesModel()', () => {
  beforeEach(() => {
    jest.spyOn(em, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(em, 'toObjectId').mockImplementation((v) => (v ? new ObjectId(strId()) : null));
  });

  test('returns status:false for empty array', async () => {
    const r = await em.importExpensesModel([]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No expenses to import');
  });

  test('returns status:false for non-array input', async () => {
    const r = await em.importExpensesModel(null);
    expect(r.status).toBe(false);
  });

  test('returns CSV error when amount is missing', async () => {
    const r = await em.importExpensesModel([{ type: 'Operating' }]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data[0].status).toMatch(/amount/);
  });

  test('returns CSV error when type is missing', async () => {
    const r = await em.importExpensesModel([{ amount: '100' }]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data[0].status).toMatch(/type/);
  });

  test('returns CSV error listing both missing fields', async () => {
    const r = await em.importExpensesModel([{ category: 'Rent' }]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data[0].status).toMatch(/amount/);
    expect(r.data[0].status).toMatch(/type/);
  });

  test('deduplicates identical rows before inserting', async () => {
    const col = makeCollection({
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: newId() } }),
      find: jest.fn().mockReturnValue(makeCursor([{ amount: 100, type: 'Operating' }])),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);

    await em.importExpensesModel([
      { amount: '100', type: 'Operating' },
      { amount: '100', type: 'Operating' },
    ]);
    const [docs] = col.insertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
  });

  test('inserts documents with branch_id and licenseId from context', async () => {
    const insertedId = newId();
    const col = makeCollection({
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: insertedId } }),
      find: jest.fn().mockReturnValue(makeCursor([{ amount: 200, type: 'Travel' }])),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);

    await em.importExpensesModel([{ amount: '200', type: 'Travel' }]);
    const [docs] = col.insertMany.mock.calls[0];
    expect(docs[0].branch_id).toBeDefined();
    expect(docs[0].license).toBeDefined();
  });

  test('returns inserted records from subsequent find query', async () => {
    const inserted = [{ amount: 300, type: 'Utility', category: 'Power' }];
    const col = makeCollection({
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: newId() } }),
      find: jest.fn().mockReturnValue(makeCursor(inserted)),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);

    const r = await em.importExpensesModel([{ amount: '300', type: 'Utility' }]);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.message).toBe('Expense data imported successfully');
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'getCollection').mockRejectedValue(new Error('import fail'));
    const r = await em.importExpensesModel([{ amount: '100', type: 'Operating' }]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('import fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. getExpenseById()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — getExpenseById()', () => {
  test('returns status:true with data when getOneRow succeeds', async () => {
    const doc = { _id: strId(), amount: 500, type: 'Travel' };
    jest.spyOn(em, 'getOneRow').mockResolvedValue({ status: true, data: doc, message: 'success' });
    jest.spyOn(em, 'getSelectFields').mockReturnValue({ amount: 1, type: 1 });

    const r = await em.getExpenseById(strId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(doc);
  });

  test('returns status:false when getOneRow returns status:false', async () => {
    jest
      .spyOn(em, 'getOneRow')
      .mockResolvedValue({ status: false, data: null, message: 'Not found' });
    jest.spyOn(em, 'getSelectFields').mockReturnValue({});

    const r = await em.getExpenseById(strId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Not found');
  });

  test('passes correct collection name and projection to getOneRow', async () => {
    const proj = { amount: 1 };
    jest.spyOn(em, 'getOneRow').mockResolvedValue({ status: true, data: {} });
    jest.spyOn(em, 'getSelectFields').mockReturnValue(proj);

    const id = strId();
    await em.getExpenseById(id);
    expect(em.getOneRow).toHaveBeenCalledWith(id, 'expenses', proj);
  });

  test('returns status:false with error message on exception', async () => {
    jest.spyOn(em, 'getOneRow').mockRejectedValue(new Error('row fail'));
    jest.spyOn(em, 'getSelectFields').mockReturnValue({});
    const r = await em.getExpenseById(strId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('row fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. getDataChanges()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — getDataChanges()', () => {
  test('delegates to getAllDataChanges with correct arguments', async () => {
    jest.spyOn(em, 'getAllDataChanges').mockResolvedValue({ status: true, data: [] });
    jest.spyOn(em, 'getSelectFields').mockReturnValue({ amount: 1 });

    const from = strId();
    await em.getDataChanges('expenses', from);

    expect(em.getAllDataChanges).toHaveBeenCalledWith('expenses', 'expenses', from, { amount: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. getExpensesPage()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — getExpensesPage()', () => {
  beforeEach(() => {
    jest.spyOn(em, 'getSelectFields').mockReturnValue({ amount: 1 });
    jest.spyOn(em, 'assignFilterObjects').mockImplementation((f) => f);
  });

  test('calls checkPlan and passes limitCheck to page()', async () => {
    jest.spyOn(em, 'checkPlan').mockResolvedValue(100);
    jest.spyOn(em, 'page').mockResolvedValue({ status: true, data: {} });

    await em.getExpensesPage({}, {});

    expect(em.checkPlan).toHaveBeenCalledWith('expenses', 'getAll');
    expect(em.page).toHaveBeenCalledWith(
      'expenses',
      { limit: 100 },
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  test('builds branch_id $in filter for ObjectId branchId', async () => {
    jest.spyOn(em, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(em, 'page').mockResolvedValue({ status: true, data: {} });

    await em.getExpensesPage({}, {});

    const [, , filtersArg] = em.page.mock.calls[0];
    expect(filtersArg.branch_id.$in).toBeDefined();
    expect(filtersArg.branch_id.$in).toHaveLength(2);
  });

  test('returns the page() response directly', async () => {
    const pageResp = { status: true, data: { total: 10, list: [] } };
    jest.spyOn(em, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(em, 'page').mockResolvedValue(pageResp);

    const r = await em.getExpensesPage();
    expect(r).toEqual(pageResp);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'checkPlan').mockRejectedValue(new Error('page fail'));
    const r = await em.getExpensesPage();
    expect(r.status).toBe(false);
    expect(r.message).toBe('page fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. expensesReportPage()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — expensesReportPage()', () => {
  const reportData = {
    starting_date: '2024-01-01',
    ending_date: '2024-01-31',
    branchid: [strId(), strId()],
  };

  beforeEach(() => {
    jest.spyOn(em, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(em, 'getSelectFields').mockReturnValue({ amount: 1 });
    const col = makeCollection({ countDocuments: jest.fn().mockResolvedValue(5) });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with list and pagination on success', async () => {
    jest.spyOn(em, 'page').mockResolvedValue({
      status: true,
      data: { list: [{ amount: 100 }], total: 1, current_page: 1, per_page: 5, total_pages: 1 },
      message: 'success',
    });

    const r = await em.expensesReportPage(reportData, {});
    expect(r.status).toBe(true);
    expect(Array.isArray(r.list)).toBe(true);
    expect(r.pagination).toBeDefined();
    expect(r.pagination.total).toBe(1);
  });

  test('builds branch_id $in filter from branchid array', async () => {
    jest.spyOn(em, 'page').mockResolvedValue({ status: true, data: {} });
    await em.expensesReportPage(reportData, {});

    const [, , filtersArg] = em.page.mock.calls[0];
    expect(Array.isArray(filtersArg.branch_id.$in)).toBe(true);
    expect(filtersArg.branch_id.$in[0]).toBeInstanceOf(ObjectId);
  });

  test('ignores invalid ObjectIds in branchid array', async () => {
    jest.spyOn(em, 'page').mockResolvedValue({ status: true, data: {} });
    await em.expensesReportPage({ ...reportData, branchid: ['bad-id', strId()] }, {});

    const [, , filtersArg] = em.page.mock.calls[0];
    expect(filtersArg.branch_id.$in).toHaveLength(1);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'page').mockRejectedValue(new Error('report fail'));
    const r = await em.expensesReportPage(reportData, {});
    expect(r.status).toBe(false);
    expect(r.message).toBe('report fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. exportExpensesOrder()
// ═══════════════════════════════════════════════════════════════════════════════
describe('ExpenseModel — exportExpensesOrder()', () => {
  test('returns status:false for empty array', async () => {
    const r = await em.exportExpensesOrder([]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No IDs provided');
  });

  test('returns status:false for null input', async () => {
    const r = await em.exportExpensesOrder(null);
    expect(r.status).toBe(false);
  });

  test('returns status:true with empty array when all IDs are invalid', async () => {
    jest.spyOn(em, 'toObjectId').mockReturnValue(null);
    const r = await em.exportExpensesOrder(['bad-id', 'also-bad']);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.message).toBe('No matching expenses found');
  });

  test('returns exported expense data on success', async () => {
    const expenses = [
      {
        amount: 500,
        type: 'Travel',
        category: 'Fuel',
        recipientname: 'Dave',
        approvedby: 'Admin',
        description: 'Trip',
      },
    ];
    const col = makeCollection({
      find: jest.fn().mockReturnValue(makeCursor(expenses)),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    jest.spyOn(em, 'toObjectId').mockReturnValue(em.licenseId);

    const r = await em.exportExpensesOrder([strId()]);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.message).toBe('Expense Data Exported');
  });

  test('adds license filter when licenseId is available', async () => {
    const col = makeCollection({
      find: jest.fn().mockReturnValue(makeCursor([])),
    });
    jest.spyOn(em, 'getCollection').mockResolvedValue(col);
    jest.spyOn(em, 'toObjectId').mockReturnValue(em.licenseId);

    await em.exportExpensesOrder([strId()]);
    const [filter] = col.find.mock.calls[0];
    expect(filter.license).toBeDefined();
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(em, 'getCollection').mockRejectedValue(new Error('export fail'));
    const r = await em.exportExpensesOrder([strId()]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('export fail');
  });
});
