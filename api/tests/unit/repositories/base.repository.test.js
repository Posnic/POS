'use strict';

/**
 * Unit tests for src/repositories/base.repository.js
 *
 * File        : src/repositories/base.repository.js (294 lines, SINGLETON export)
 * Export type : SINGLETON — module.exports = new BaseRepository()
 * Base class  : None — BaseRepository does NOT extend any class
 *
 * Pattern     : Thin delegation layer — wraps BaseModel instance/static methods.
 *               Most methods create `new BaseModel(collectionName)` internally.
 *               Two error-handling strategies:
 *
 *   SOFT (catch → return error object, do NOT rethrow):
 *     autoSuggestionTableField, autoSuggestionReportTableField,
 *     getDefaultSuggestion, page, checkPlan (returns -1),
 *     getOneRow, changeLog, getAllDataChanges, deletedDocumentBackup
 *
 *   HARD (catch → rethrow):
 *     findOne, find, insertOne, updateOne, deleteOne,
 *     countDocuments, aggregate, withTransaction
 *
 * Context setting (sets STATIC properties on BaseModel class):
 *   autoSuggestionTableField   → BaseModel.license, .currentBranch, .loggedUser
 *   autoSuggestionReportTableField → BaseModel.license
 *   getDefaultSuggestion       → BaseModel.license, .currentBranch
 *
 * Static call:
 *   deletedDocumentBackup → calls BaseModel.deletedDocumentBackup(doc, params)
 *
 * Child repos that USE (not extend) this singleton:
 *   register.repository.js — calls baseRepository.getAllDataChanges()
 *
 * Mocked dependency:
 *   src/models/base.model — constructor + all instance methods + static members
 *
 * No production bugs found.
 */

// ─── Mocks (hoisted before any require) ──────────────────────────────────────

jest.mock('../../../src/models/base.model', () => {
  const mockInstance = {
    autoSuggestionTableField: jest.fn(),
    autoSuggestionReportTableField: jest.fn(),
    getDefaultSuggestion: jest.fn(),
    page: jest.fn(),
    checkPlan: jest.fn(),
    getOneRow: jest.fn(),
    changeLog: jest.fn(),
    getAllDataChanges: jest.fn(),
    withTransaction: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
  };

  const MockBaseModel = jest.fn(() => mockInstance);
  MockBaseModel.__mockInstance = mockInstance;

  // Static properties set by context methods
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;

  // Static method
  MockBaseModel.deletedDocumentBackup = jest.fn();

  return MockBaseModel;
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const BaseModel = require('../../../src/models/base.model');
const mockInst = BaseModel.__mockInstance;
const repository = require('../../../src/repositories/base.repository');

// ─── Shared test data ─────────────────────────────────────────────────────────

const COLLECTION = 'items';
const FAKE_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_DOC = { _id: FAKE_ID, name: 'Test Doc' };
const FAKE_CONTEXT = { license: 'LIC-001', branchId: 'B001', userId: 'U001' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BaseRepository (singleton)', () => {
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Restore mock implementations after clearAllMocks
    mockInst.autoSuggestionTableField.mockResolvedValue({ status: true, data: ['Suggestion A'] });
    mockInst.autoSuggestionReportTableField.mockResolvedValue({
      status: true,
      data: ['Report Sug'],
    });
    mockInst.getDefaultSuggestion.mockResolvedValue({ status: true, data: [{ name: 'Def' }] });
    mockInst.page.mockResolvedValue({ status: true, data: [FAKE_DOC], total: 1 });
    mockInst.checkPlan.mockResolvedValue(10);
    mockInst.getOneRow.mockResolvedValue({ status: true, data: FAKE_DOC });
    mockInst.changeLog.mockResolvedValue({ status: true });
    mockInst.getAllDataChanges.mockResolvedValue({ status: true, data: [] });
    mockInst.withTransaction.mockImplementation((cb) => cb());
    mockInst.findOne.mockResolvedValue(FAKE_DOC);
    mockInst.find.mockResolvedValue([FAKE_DOC]);
    mockInst.insertOne.mockResolvedValue({ insertedId: FAKE_ID });
    mockInst.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockInst.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mockInst.countDocuments.mockResolvedValue(5);
    mockInst.aggregate.mockResolvedValue([{ total: 100 }]);
    BaseModel.deletedDocumentBackup.mockResolvedValue({ status: true });

    // Reset static properties on class
    BaseModel.license = null;
    BaseModel.currentBranch = null;
    BaseModel.loggedUser = null;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ── module load / constructor ──────────────────────────────────────────────

  describe('module load (constructor)', () => {
    test('exports a singleton object', () => {
      expect(typeof repository).toBe('object');
      expect(repository).not.toBeNull();
    });

    test('creates a BaseModel instance as this.baseModel', () => {
      expect(repository.baseModel).toBe(mockInst);
    });
  });

  // ── getBaseModel ───────────────────────────────────────────────────────────

  describe('getBaseModel', () => {
    test('returns the BaseModel class (not an instance)', () => {
      const result = repository.getBaseModel();
      expect(result).toBe(BaseModel);
    });

    test('returned value is callable as a constructor', () => {
      const Model = repository.getBaseModel();
      expect(typeof Model).toBe('function');
    });
  });

  // ── createInstance ─────────────────────────────────────────────────────────

  describe('createInstance', () => {
    test('calls new BaseModel with the given collectionName', () => {
      repository.createInstance('suppliers');
      expect(BaseModel).toHaveBeenCalledWith('suppliers');
    });

    test('returns the created BaseModel instance', () => {
      const inst = repository.createInstance('customers');
      expect(inst).toBe(mockInst);
    });

    test('uses null as default collectionName', () => {
      repository.createInstance();
      expect(BaseModel).toHaveBeenCalledWith(null);
    });
  });

  // ── autoSuggestionTableField ───────────────────────────────────────────────

  describe('autoSuggestionTableField', () => {
    test('sets BaseModel.license from context', async () => {
      await repository.autoSuggestionTableField('name', COLLECTION, 'test', FAKE_CONTEXT);
      expect(BaseModel.license).toBe(FAKE_CONTEXT.license);
    });

    test('sets BaseModel.currentBranch from context', async () => {
      await repository.autoSuggestionTableField('name', COLLECTION, 'test', FAKE_CONTEXT);
      expect(BaseModel.currentBranch).toBe(FAKE_CONTEXT.branchId);
    });

    test('sets BaseModel.loggedUser from context', async () => {
      await repository.autoSuggestionTableField('name', COLLECTION, 'test', FAKE_CONTEXT);
      expect(BaseModel.loggedUser).toBe(FAKE_CONTEXT.userId);
    });

    test('does NOT set BaseModel.license when not in context', async () => {
      await repository.autoSuggestionTableField('name', COLLECTION, 'q', {});
      expect(BaseModel.license).toBeNull();
    });

    test('calls this.baseModel.autoSuggestionTableField with correct args', async () => {
      await repository.autoSuggestionTableField('name', COLLECTION, 'apple', FAKE_CONTEXT);
      expect(mockInst.autoSuggestionTableField).toHaveBeenCalledWith('name', COLLECTION, 'apple');
    });

    test('returns the result from baseModel', async () => {
      const r = await repository.autoSuggestionTableField('name', COLLECTION, 'q');
      expect(r).toEqual({ status: true, data: ['Suggestion A'] });
    });

    test('returns soft error object on throw (does NOT rethrow)', async () => {
      mockInst.autoSuggestionTableField.mockRejectedValueOnce(new Error('DB error'));
      const r = await repository.autoSuggestionTableField('name', COLLECTION, 'q');
      expect(r).toEqual({ status: false, data: [], message: 'DB error' });
    });
  });

  // ── autoSuggestionReportTableField ─────────────────────────────────────────

  describe('autoSuggestionReportTableField', () => {
    test('sets BaseModel.license from context', async () => {
      await repository.autoSuggestionReportTableField(
        'q',
        'name',
        COLLECTION,
        ['B1'],
        FAKE_CONTEXT
      );
      expect(BaseModel.license).toBe(FAKE_CONTEXT.license);
    });

    test('does NOT set other context properties (only license)', async () => {
      await repository.autoSuggestionReportTableField(
        'q',
        'name',
        COLLECTION,
        ['B1'],
        FAKE_CONTEXT
      );
      // currentBranch and loggedUser must remain null (not set by this method)
      expect(BaseModel.currentBranch).toBeNull();
      expect(BaseModel.loggedUser).toBeNull();
    });

    test('calls baseModel.autoSuggestionReportTableField with correct args', async () => {
      await repository.autoSuggestionReportTableField(
        'q',
        'name',
        COLLECTION,
        ['B1', 'B2'],
        FAKE_CONTEXT
      );
      expect(mockInst.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'q',
        'name',
        COLLECTION,
        ['B1', 'B2']
      );
    });

    test('returns the result from baseModel', async () => {
      const r = await repository.autoSuggestionReportTableField('q', 'name', COLLECTION, ['B1']);
      expect(r).toEqual({ status: true, data: ['Report Sug'] });
    });

    test('returns soft error object on throw', async () => {
      mockInst.autoSuggestionReportTableField.mockRejectedValueOnce(new Error('Report fail'));
      const r = await repository.autoSuggestionReportTableField('q', 'name', COLLECTION, ['B1']);
      expect(r).toEqual({ status: false, data: [], message: 'Report fail' });
    });
  });

  // ── getDefaultSuggestion ───────────────────────────────────────────────────

  describe('getDefaultSuggestion', () => {
    test('sets BaseModel.license from context', async () => {
      await repository.getDefaultSuggestion('customers', 'john', FAKE_CONTEXT);
      expect(BaseModel.license).toBe(FAKE_CONTEXT.license);
    });

    test('sets BaseModel.currentBranch from context', async () => {
      await repository.getDefaultSuggestion('customers', 'john', FAKE_CONTEXT);
      expect(BaseModel.currentBranch).toBe(FAKE_CONTEXT.branchId);
    });

    test('calls baseModel.getDefaultSuggestion with module and query', async () => {
      await repository.getDefaultSuggestion('customers', 'john', FAKE_CONTEXT);
      expect(mockInst.getDefaultSuggestion).toHaveBeenCalledWith('customers', 'john');
    });

    test('returns the result from baseModel', async () => {
      const r = await repository.getDefaultSuggestion('customers', 'john');
      expect(r).toEqual({ status: true, data: [{ name: 'Def' }] });
    });

    test('returns soft error object on throw', async () => {
      mockInst.getDefaultSuggestion.mockRejectedValueOnce(new Error('Suggest fail'));
      const r = await repository.getDefaultSuggestion('customers', 'q');
      expect(r).toEqual({ status: false, data: [], message: 'Suggest fail' });
    });
  });

  // ── page ───────────────────────────────────────────────────────────────────

  describe('page', () => {
    const limitCheck = { limit: 10, page: 1 };
    const filter = { branch_id: 'B001' };
    const options = { sort: '_id', order: 'desc' };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.page(COLLECTION, limitCheck, filter, options);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.page with all arguments', async () => {
      await repository.page(COLLECTION, limitCheck, filter, options, 'name fields');
      expect(mockInst.page).toHaveBeenCalledWith(
        COLLECTION,
        limitCheck,
        filter,
        options,
        'name fields'
      );
    });

    test('returns paginated data from baseModel', async () => {
      const r = await repository.page(COLLECTION, limitCheck, filter, options);
      expect(r).toEqual({ status: true, data: [FAKE_DOC], total: 1 });
    });

    test('returns soft error object on throw', async () => {
      mockInst.page.mockRejectedValueOnce(new Error('Page error'));
      const r = await repository.page(COLLECTION, limitCheck, filter, options);
      expect(r).toEqual({ status: false, data: null, message: 'Page error' });
    });
  });

  // ── checkPlan ──────────────────────────────────────────────────────────────

  describe('checkPlan', () => {
    test('delegates to this.baseModel.checkPlan with correct args', async () => {
      await repository.checkPlan('suppliers', 'create', FAKE_CONTEXT);
      expect(mockInst.checkPlan).toHaveBeenCalledWith('suppliers', 'create', FAKE_CONTEXT);
    });

    test('returns the plan limit count on success', async () => {
      const r = await repository.checkPlan('suppliers', 'create');
      expect(r).toBe(10);
    });

    test('returns -1 on error (unique error return, not standard error object)', async () => {
      mockInst.checkPlan.mockRejectedValueOnce(new Error('Plan check fail'));
      const r = await repository.checkPlan('suppliers', 'create');
      expect(r).toBe(-1);
    });

    test('returns 0 when plan limit is zero', async () => {
      mockInst.checkPlan.mockResolvedValueOnce(0);
      const r = await repository.checkPlan('items', 'create');
      expect(r).toBe(0);
    });
  });

  // ── getOneRow ──────────────────────────────────────────────────────────────

  describe('getOneRow', () => {
    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.getOneRow(FAKE_ID, COLLECTION);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.getOneRow with id, collectionName, and fields', async () => {
      await repository.getOneRow(FAKE_ID, COLLECTION, 'name description');
      expect(mockInst.getOneRow).toHaveBeenCalledWith(FAKE_ID, COLLECTION, 'name description');
    });

    test('returns document data on success', async () => {
      const r = await repository.getOneRow(FAKE_ID, COLLECTION);
      expect(r).toEqual({ status: true, data: FAKE_DOC });
    });

    test('returns soft error object on throw', async () => {
      mockInst.getOneRow.mockRejectedValueOnce(new Error('Row not found'));
      const r = await repository.getOneRow(FAKE_ID, COLLECTION);
      expect(r).toEqual({ status: false, data: null, message: 'Row not found' });
    });
  });

  // ── changeLog ──────────────────────────────────────────────────────────────

  describe('changeLog', () => {
    const OLD_DOC = { name: 'Old Name' };
    const NEW_DOC = { name: 'New Name' };

    test('delegates to baseModel.changeLog with all parameters', async () => {
      await repository.changeLog('items', 'user1', FAKE_ID, 'update', OLD_DOC, NEW_DOC);
      expect(mockInst.changeLog).toHaveBeenCalledWith(
        'items',
        'user1',
        FAKE_ID,
        'update',
        OLD_DOC,
        NEW_DOC
      );
    });

    test('uses "update" as default operation when undefined is passed', async () => {
      await repository.changeLog('items', 'user1', FAKE_ID, undefined, OLD_DOC, NEW_DOC);
      // JS default parameter replaces undefined with 'update' before delegation
      expect(mockInst.changeLog).toHaveBeenCalledWith(
        'items',
        'user1',
        FAKE_ID,
        'update',
        OLD_DOC,
        NEW_DOC
      );
    });

    test('returns result from baseModel on success', async () => {
      const r = await repository.changeLog('items', 'user1', FAKE_ID, 'create', null, NEW_DOC);
      expect(r).toEqual({ status: true });
    });

    test('returns soft error object on throw', async () => {
      mockInst.changeLog.mockRejectedValueOnce(new Error('Log fail'));
      const r = await repository.changeLog('items', 'user1', FAKE_ID, 'delete');
      expect(r).toEqual({ status: false, data: null, message: 'Log fail' });
    });
  });

  // ── getAllDataChanges ───────────────────────────────────────────────────────

  describe('getAllDataChanges', () => {
    test('delegates to baseModel.getAllDataChanges with correct args', async () => {
      await repository.getAllDataChanges(COLLECTION, 'items', FAKE_ID, 'name');
      expect(mockInst.getAllDataChanges).toHaveBeenCalledWith(COLLECTION, 'items', FAKE_ID, 'name');
    });

    test('returns the result on success', async () => {
      const r = await repository.getAllDataChanges(COLLECTION, 'items', FAKE_ID);
      expect(r).toEqual({ status: true, data: [] });
    });

    test('returns soft error object on throw', async () => {
      mockInst.getAllDataChanges.mockRejectedValueOnce(new Error('Changes fail'));
      const r = await repository.getAllDataChanges(COLLECTION, 'items', FAKE_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Changes fail' });
    });
  });

  // ── deletedDocumentBackup ──────────────────────────────────────────────────

  describe('deletedDocumentBackup', () => {
    const DOC = { _id: FAKE_ID, name: 'Item A' };
    const PARAMS = { module: 'items', deletedBy: 'U001' };

    test('calls STATIC BaseModel.deletedDocumentBackup with document and params', async () => {
      await repository.deletedDocumentBackup(DOC, PARAMS);
      expect(BaseModel.deletedDocumentBackup).toHaveBeenCalledWith(DOC, PARAMS);
    });

    test('returns the result on success', async () => {
      const r = await repository.deletedDocumentBackup(DOC, PARAMS);
      expect(r).toEqual({ status: true });
    });

    test('does NOT call instance method — uses static method', async () => {
      await repository.deletedDocumentBackup(DOC, PARAMS);
      // Instance method should NOT have been called
      expect(mockInst.changeLog).not.toHaveBeenCalled();
    });

    test('returns soft error object on throw', async () => {
      BaseModel.deletedDocumentBackup.mockRejectedValueOnce(new Error('Backup fail'));
      const r = await repository.deletedDocumentBackup(DOC, PARAMS);
      expect(r).toEqual({ status: false, data: null, message: 'Backup fail' });
    });
  });

  // ── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    const QUERY = { name: 'Test' };
    const OPTS = { populate: 'category' };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.findOne(COLLECTION, QUERY);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.findOne with query and options', async () => {
      await repository.findOne(COLLECTION, QUERY, OPTS);
      expect(mockInst.findOne).toHaveBeenCalledWith(QUERY, OPTS);
    });

    test('returns the found document on success', async () => {
      const r = await repository.findOne(COLLECTION, QUERY);
      expect(r).toEqual(FAKE_DOC);
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.findOne.mockRejectedValueOnce(new Error('Find failed'));
      await expect(repository.findOne(COLLECTION, QUERY)).rejects.toThrow('Find failed');
    });
  });

  // ── find ───────────────────────────────────────────────────────────────────

  describe('find', () => {
    const QUERY = { status: 'active' };
    const OPTS = { sort: { name: 1 }, limit: 10 };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.find(COLLECTION, QUERY);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.find with query and options', async () => {
      await repository.find(COLLECTION, QUERY, OPTS);
      expect(mockInst.find).toHaveBeenCalledWith(QUERY, OPTS);
    });

    test('uses empty object as default query', async () => {
      await repository.find(COLLECTION);
      expect(mockInst.find).toHaveBeenCalledWith({}, {});
    });

    test('returns array of documents on success', async () => {
      const r = await repository.find(COLLECTION, QUERY);
      expect(r).toEqual([FAKE_DOC]);
    });

    test('returns empty array when no documents match', async () => {
      mockInst.find.mockResolvedValueOnce([]);
      const r = await repository.find(COLLECTION, { nonexistent: true });
      expect(r).toEqual([]);
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.find.mockRejectedValueOnce(new Error('Find error'));
      await expect(repository.find(COLLECTION, QUERY)).rejects.toThrow('Find error');
    });
  });

  // ── insertOne ──────────────────────────────────────────────────────────────

  describe('insertOne', () => {
    const DOC = { name: 'New Item', price: 100 };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.insertOne(COLLECTION, DOC);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.insertOne with the document', async () => {
      await repository.insertOne(COLLECTION, DOC);
      expect(mockInst.insertOne).toHaveBeenCalledWith(DOC);
    });

    test('returns the insertedId on success', async () => {
      const r = await repository.insertOne(COLLECTION, DOC);
      expect(r).toEqual({ insertedId: FAKE_ID });
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.insertOne.mockRejectedValueOnce(new Error('Insert error'));
      await expect(repository.insertOne(COLLECTION, DOC)).rejects.toThrow('Insert error');
    });
  });

  // ── updateOne ──────────────────────────────────────────────────────────────

  describe('updateOne', () => {
    const FILTER = { _id: FAKE_ID };
    const UPDATE = { $set: { name: 'Updated' } };
    const OPTS = { upsert: false };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.updateOne(COLLECTION, FILTER, UPDATE);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.updateOne with filter, update, and options', async () => {
      await repository.updateOne(COLLECTION, FILTER, UPDATE, OPTS);
      expect(mockInst.updateOne).toHaveBeenCalledWith(FILTER, UPDATE, OPTS);
    });

    test('returns modifiedCount on success', async () => {
      const r = await repository.updateOne(COLLECTION, FILTER, UPDATE);
      expect(r).toEqual({ modifiedCount: 1 });
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.updateOne.mockRejectedValueOnce(new Error('Update error'));
      await expect(repository.updateOne(COLLECTION, FILTER, UPDATE)).rejects.toThrow(
        'Update error'
      );
    });
  });

  // ── deleteOne ──────────────────────────────────────────────────────────────

  describe('deleteOne', () => {
    const FILTER = { _id: FAKE_ID };
    const OPTS = {};

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.deleteOne(COLLECTION, FILTER);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.deleteOne with filter and options', async () => {
      await repository.deleteOne(COLLECTION, FILTER, OPTS);
      expect(mockInst.deleteOne).toHaveBeenCalledWith(FILTER, OPTS);
    });

    test('returns deletedCount on success', async () => {
      const r = await repository.deleteOne(COLLECTION, FILTER);
      expect(r).toEqual({ deletedCount: 1 });
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.deleteOne.mockRejectedValueOnce(new Error('Delete error'));
      await expect(repository.deleteOne(COLLECTION, FILTER)).rejects.toThrow('Delete error');
    });
  });

  // ── countDocuments ─────────────────────────────────────────────────────────

  describe('countDocuments', () => {
    const QUERY = { status: 'active' };

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.countDocuments(COLLECTION, QUERY);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.countDocuments with query', async () => {
      await repository.countDocuments(COLLECTION, QUERY);
      expect(mockInst.countDocuments).toHaveBeenCalledWith(QUERY);
    });

    test('uses empty object as default query', async () => {
      await repository.countDocuments(COLLECTION);
      expect(mockInst.countDocuments).toHaveBeenCalledWith({});
    });

    test('returns count on success', async () => {
      const r = await repository.countDocuments(COLLECTION, QUERY);
      expect(r).toBe(5);
    });

    test('returns 0 when collection is empty', async () => {
      mockInst.countDocuments.mockResolvedValueOnce(0);
      const r = await repository.countDocuments(COLLECTION, {});
      expect(r).toBe(0);
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.countDocuments.mockRejectedValueOnce(new Error('Count error'));
      await expect(repository.countDocuments(COLLECTION, QUERY)).rejects.toThrow('Count error');
    });
  });

  // ── aggregate ──────────────────────────────────────────────────────────────

  describe('aggregate', () => {
    const PIPELINE = [
      { $match: { status: 'active' } },
      { $group: { _id: '$category', total: { $sum: 1 } } },
    ];

    test('creates a new BaseModel instance with collectionName', async () => {
      await repository.aggregate(COLLECTION, PIPELINE);
      expect(BaseModel).toHaveBeenCalledWith(COLLECTION);
    });

    test('calls instance.aggregate with the full pipeline', async () => {
      await repository.aggregate(COLLECTION, PIPELINE);
      expect(mockInst.aggregate).toHaveBeenCalledWith(PIPELINE);
    });

    test('returns aggregation results on success', async () => {
      const r = await repository.aggregate(COLLECTION, PIPELINE);
      expect(r).toEqual([{ total: 100 }]);
    });

    test('returns empty array when no results match pipeline', async () => {
      mockInst.aggregate.mockResolvedValueOnce([]);
      const r = await repository.aggregate(COLLECTION, PIPELINE);
      expect(r).toEqual([]);
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.aggregate.mockRejectedValueOnce(new Error('Aggregation error'));
      await expect(repository.aggregate(COLLECTION, PIPELINE)).rejects.toThrow('Aggregation error');
    });
  });

  // ── withTransaction ────────────────────────────────────────────────────────

  describe('withTransaction', () => {
    test('delegates to this.baseModel.withTransaction', async () => {
      const ops = jest.fn().mockResolvedValue('tx-done');
      await repository.withTransaction(ops);
      expect(mockInst.withTransaction).toHaveBeenCalledWith(ops);
    });

    test('returns the transaction result on success', async () => {
      mockInst.withTransaction.mockResolvedValueOnce({ committed: true });
      const r = await repository.withTransaction(jest.fn());
      expect(r).toEqual({ committed: true });
    });

    test('passes operations callback to baseModel', async () => {
      const ops = async (session) => ({ session });
      mockInst.withTransaction.mockImplementationOnce((cb) => cb('fake-session'));
      const r = await repository.withTransaction(ops);
      expect(r).toEqual({ session: 'fake-session' });
    });

    test('RETHROWS error on failure (hard error pattern)', async () => {
      mockInst.withTransaction.mockRejectedValueOnce(new Error('Transaction error'));
      await expect(repository.withTransaction(jest.fn())).rejects.toThrow('Transaction error');
    });
  });
});
