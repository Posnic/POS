'use strict';

/**
 * Unit tests for src/models/customer-category.model.js
 *
 * File confirmed: src/models/customer-category.model.js (kebab-case, single file)
 * No Mongoose — uses native MongoDB driver via BaseModel (class inheritance).
 *
 * Strategy: Mocked database tests
 *  - BaseModel is fully mocked so no real DB connection is made.
 *  - Static context properties (currentBranch, license, etc.) are set directly
 *    on the MockBaseModel class before each test.
 *  - Collection methods (findOne, insertOne, etc.) are Jest fns on mockCollection.
 *  - Inherited BaseModel instance methods (getCollection, changeLog, getOneRow,
 *    getAllDataChanges, deletedDocumentBackup, checkPlan, page, assignFilterObjects)
 *    are spied on the ccm instance in beforeEach.
 */

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static mongoClient = {};
    static database = {};
    static currentBranch = null;
    static currentBranchName = null;
    static license = null;
    static loggedUser = null;
    static loggedUserName = null;
    static loggedUserDetails = null;

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    }
    async changeLog() {
      return { status: true };
    }
    async getOneRow() {
      return { status: false, data: null, message: 'Not found' };
    }
    async getAllDataChanges() {
      return { status: true, data: [] };
    }
    async deletedDocumentBackup() {
      return { status: true };
    }
    async checkPlan() {
      return -1;
    }
    async page() {
      return { status: true, data: {} };
    }
    assignFilterObjects(filters) {
      return filters;
    }
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const { ObjectId } = require('mongodb');
const CustomerCategoryModel = require('../../../src/models/customer-category.model');
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

// ─── Shared test state ────────────────────────────────────────────────────────

let ccm;
let mockCollection;

beforeEach(() => {
  jest.restoreAllMocks();

  MockBaseModel.currentBranch = newId();
  MockBaseModel.currentBranchName = 'Test Branch';
  MockBaseModel.license = newId();
  MockBaseModel.loggedUser = newId();
  MockBaseModel.loggedUserName = 'Tester';

  mockCollection = {
    findOne: jest.fn(),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
    find: jest.fn(),
    insertMany: jest.fn(),
    countDocuments: jest.fn(),
  };

  ccm = new CustomerCategoryModel();
  jest.spyOn(ccm, 'getCollection').mockResolvedValue(mockCollection);
  jest.spyOn(ccm, 'changeLog').mockResolvedValue({ status: true });
  jest.spyOn(ccm, 'deletedDocumentBackup').mockResolvedValue({ status: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Class structure & exports
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — class structure', () => {
  test('module exports a class (function), not an instance', () => {
    expect(typeof CustomerCategoryModel).toBe('function');
  });

  test('is a subclass of BaseModel (MockBaseModel)', () => {
    expect(ccm).toBeInstanceOf(MockBaseModel);
  });

  test('constructor sets collectionName to "customer_category"', () => {
    expect(ccm.collectionName).toBe('customer_category');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Static properties
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — static properties', () => {
  test('collectionName is "customer_category"', () => {
    expect(CustomerCategoryModel.collectionName).toBe('customer_category');
  });

  test('fields contains _id, branch_id, branch_name, name, description', () => {
    const keys = Object.keys(CustomerCategoryModel.fields);
    expect(keys).toEqual(
      expect.arrayContaining(['_id', 'branch_id', 'branch_name', 'name', 'description'])
    );
  });

  test('fields._id has type ObjectId and select true', () => {
    expect(CustomerCategoryModel.fields._id.type).toBe('ObjectId');
    expect(CustomerCategoryModel.fields._id.select).toBe(true);
  });

  test('fields.branch_id has select false (excluded from projection)', () => {
    expect(CustomerCategoryModel.fields.branch_id.select).toBe(false);
  });

  test('fields.name has select true', () => {
    expect(CustomerCategoryModel.fields.name.select).toBe(true);
  });

  test('fields.license has select false', () => {
    expect(CustomerCategoryModel.fields.license.select).toBe(false);
  });

  test('importFields contains name and description with select true', () => {
    expect(CustomerCategoryModel.importFields.name.select).toBe(true);
    expect(CustomerCategoryModel.importFields.description.select).toBe(true);
  });

  test('importFields does NOT contain branch_id', () => {
    expect(CustomerCategoryModel.importFields.branch_id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. getSelectFields() instance method
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — getSelectFields()', () => {
  test('returns projection with 1 for each select:true field', () => {
    const proj = ccm.getSelectFields(CustomerCategoryModel.fields);
    expect(proj._id).toBe(1);
    expect(proj.name).toBe(1);
    expect(proj.description).toBe(1);
  });

  test('excludes fields with select:false (branch_id, license)', () => {
    const proj = ccm.getSelectFields(CustomerCategoryModel.fields);
    expect(proj.branch_id).toBeUndefined();
    expect(proj.license).toBeUndefined();
  });

  test('sets _id:0 when includeId is false', () => {
    const proj = ccm.getSelectFields(CustomerCategoryModel.fields, false);
    expect(proj._id).toBe(0);
  });

  test('importFields projection contains name and description only', () => {
    const proj = ccm.getSelectFields(CustomerCategoryModel.importFields);
    expect(proj.name).toBe(1);
    expect(proj.description).toBe(1);
    expect(Object.keys(proj)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. categoryInsertUpdate — validation guards
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — categoryInsertUpdate() validation guards', () => {
  test('returns status:false when currentBranch is null', async () => {
    MockBaseModel.currentBranch = null;
    const r = await ccm.categoryInsertUpdate({ name: 'Premium' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/branch/i);
  });

  test('returns status:false when license is null', async () => {
    MockBaseModel.license = null;
    const r = await ccm.categoryInsertUpdate({ name: 'Premium' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/license/i);
  });

  test('returns status:"exist" when a different doc with same name exists', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: newId(), name: 'Gold' });
    const r = await ccm.categoryInsertUpdate({ name: 'Gold' });
    expect(r.status).toBe('exist');
    expect(r.message).toMatch(/already exist/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. categoryInsertUpdate — INSERT path (id = '')
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — categoryInsertUpdate() INSERT', () => {
  const insertedId = newId();

  beforeEach(() => {
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.insertOne.mockResolvedValue({ insertedId });
  });

  test('returns status:true with insertedId string on success', async () => {
    const r = await ccm.categoryInsertUpdate({ name: 'Silver', description: 'Mid tier' });
    expect(r.status).toBe(true);
    expect(r.data).toBe(String(insertedId));
    expect(r.message).toBe('Customer category added successfully');
  });

  test('calls insertOne with merged insert + update data', async () => {
    await ccm.categoryInsertUpdate({ name: '  Silver  ', description: '  Mid tier  ' });
    const [doc] = mockCollection.insertOne.mock.calls[0];
    expect(doc.name).toBe('Silver');
    expect(doc.description).toBe('Mid tier');
    expect(doc.branch_id).toEqual(MockBaseModel.currentBranch);
    expect(doc.license).toEqual(MockBaseModel.license);
  });

  test('trims whitespace from name and description', async () => {
    await ccm.categoryInsertUpdate({ name: '  Bronze  ', description: '  Low  ' });
    const [doc] = mockCollection.insertOne.mock.calls[0];
    expect(doc.name).toBe('Bronze');
    expect(doc.description).toBe('Low');
  });

  test('calls changeLog with "insert" operation after insert', async () => {
    await ccm.categoryInsertUpdate({ name: 'Diamond' });
    expect(ccm.changeLog).toHaveBeenCalledWith(
      'customer_category',
      MockBaseModel.loggedUser,
      insertedId,
      'insert'
    );
  });

  test('returns status:false when insertOne throws', async () => {
    mockCollection.insertOne.mockRejectedValue(new Error('DB error'));
    const r = await ccm.categoryInsertUpdate({ name: 'Gold' });
    expect(r.status).toBe(false);
    expect(r.message).toBe('DB error');
  });

  test('does NOT flag exist when findOne returns null', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const r = await ccm.categoryInsertUpdate({ name: 'Unique' });
    expect(r.status).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. categoryInsertUpdate — UPDATE path (id provided)
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — categoryInsertUpdate() UPDATE', () => {
  const existingId = strId();

  beforeEach(() => {
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test('returns status:true with modifiedCount on success', async () => {
    const r = await ccm.categoryInsertUpdate({ name: 'Platinum', description: 'Top' }, existingId);
    expect(r.status).toBe(true);
    expect(r.data).toEqual({ category_update: 1 });
    expect(r.message).toBe('Customer category updated successfully');
  });

  test('calls updateOne with $set containing trimmed name and description', async () => {
    await ccm.categoryInsertUpdate({ name: '  Platinum  ', description: '  Top  ' }, existingId);
    const [, updateArg] = mockCollection.updateOne.mock.calls[0];
    expect(updateArg.$set.name).toBe('Platinum');
    expect(updateArg.$set.description).toBe('Top');
  });

  test('calls changeLog with "update" operation', async () => {
    await ccm.categoryInsertUpdate({ name: 'Platinum' }, existingId);
    expect(ccm.changeLog).toHaveBeenCalledWith(
      'customer_category',
      MockBaseModel.loggedUser,
      expect.any(ObjectId),
      'update'
    );
  });

  test('does NOT flag exist when findOne returns doc with same id as update target', async () => {
    const sameObjId = new ObjectId(existingId);
    mockCollection.findOne.mockResolvedValue({ _id: sameObjId, name: 'Platinum' });
    const r = await ccm.categoryInsertUpdate({ name: 'Platinum' }, existingId);
    expect(r.status).toBe(true);
  });

  test('flags exist when findOne returns a DIFFERENT doc with same name', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: newId(), name: 'Platinum' });
    const r = await ccm.categoryInsertUpdate({ name: 'Platinum' }, existingId);
    expect(r.status).toBe('exist');
  });

  test('returns status:false on exception', async () => {
    mockCollection.updateOne.mockRejectedValue(new Error('Update failed'));
    const r = await ccm.categoryInsertUpdate({ name: 'Platinum' }, existingId);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Update failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. getCustomerCategoryTableRow()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — getCustomerCategoryTableRow()', () => {
  test('returns status:true with data when getOneRow succeeds', async () => {
    const doc = { _id: strId(), name: 'VIP', description: '' };
    jest.spyOn(ccm, 'getOneRow').mockResolvedValue({ status: true, data: doc });
    const r = await ccm.getCustomerCategoryTableRow(strId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(doc);
    expect(r.message).toBe('success');
  });

  test('returns status:false when getOneRow returns status:false', async () => {
    jest.spyOn(ccm, 'getOneRow').mockResolvedValue({ status: false, data: null });
    const r = await ccm.getCustomerCategoryTableRow(strId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('error');
  });

  test('passes correct collection name and projection to getOneRow', async () => {
    jest.spyOn(ccm, 'getOneRow').mockResolvedValue({ status: true, data: {} });
    const id = strId();
    await ccm.getCustomerCategoryTableRow(id);
    expect(ccm.getOneRow).toHaveBeenCalledWith(
      id,
      'customer_category',
      expect.objectContaining({ _id: 1, name: 1, description: 1 })
    );
  });

  test('returns status:false with error message on exception', async () => {
    jest.spyOn(ccm, 'getOneRow').mockRejectedValue(new Error('fail'));
    const r = await ccm.getCustomerCategoryTableRow(strId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. getDataChanges()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — getDataChanges()', () => {
  test('delegates to getAllDataChanges with correct arguments', async () => {
    const changes = [{ _id: strId(), operation: 'insert' }];
    jest.spyOn(ccm, 'getAllDataChanges').mockResolvedValue({ status: true, data: changes });
    const fromId = strId();
    const r = await ccm.getDataChanges('customer_category', fromId);
    expect(ccm.getAllDataChanges).toHaveBeenCalledWith(
      'customer_category',
      'customer_category',
      fromId,
      expect.objectContaining({ _id: 1, name: 1 })
    );
    expect(r.data).toEqual(changes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. deleteCustomerCategoryCollectionData()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — deleteCustomerCategoryCollectionData()', () => {
  const id1 = strId();
  const id2 = strId();
  const docs = [
    { _id: new ObjectId(id1), name: 'Gold' },
    { _id: new ObjectId(id2), name: 'Silver' },
  ];

  beforeEach(() => {
    mockCollection.find.mockReturnValue(makeCursor(docs));
    mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });
  });

  test('returns status:true with deletedCount on success', async () => {
    const r = await ccm.deleteCustomerCategoryCollectionData([id1, id2]);
    expect(r.status).toBe(true);
    expect(r.data).toBe(2);
    expect(r.message).toBe('success');
  });

  test('calls changeLog once for each id', async () => {
    await ccm.deleteCustomerCategoryCollectionData([id1, id2]);
    expect(ccm.changeLog).toHaveBeenCalledTimes(2);
    expect(ccm.changeLog).toHaveBeenCalledWith(
      'customer_category',
      MockBaseModel.loggedUser,
      expect.any(ObjectId),
      'delete'
    );
  });

  test('calls deletedDocumentBackup once for each found document', async () => {
    await ccm.deleteCustomerCategoryCollectionData([id1, id2]);
    expect(ccm.deletedDocumentBackup).toHaveBeenCalledTimes(2);
  });

  test('calls deleteMany with $and filter containing objectIds and license', async () => {
    await ccm.deleteCustomerCategoryCollectionData([id1]);
    const [condition] = mockCollection.deleteMany.mock.calls[0];
    expect(condition.$and).toBeDefined();
    const idFilter = condition.$and.find((c) => c._id);
    expect(idFilter._id.$in[0]).toBeInstanceOf(ObjectId);
    const licenseFilter = condition.$and.find((c) => c.license);
    expect(licenseFilter.license).toEqual(MockBaseModel.license);
  });

  test('returns status:false on exception', async () => {
    mockCollection.find.mockReturnValue({
      toArray: jest.fn().mockRejectedValue(new Error('delete fail')),
    });
    const r = await ccm.deleteCustomerCategoryCollectionData([id1]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('delete fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. importCustomerCategoryModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — importCustomerCategoryModel()', () => {
  test('returns CSV error when name is empty string', async () => {
    const r = await ccm.importCustomerCategoryModel([{ name: '' }]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data[0].status).toMatch(/name/);
  });

  test('returns CSV error when name is undefined/missing', async () => {
    const r = await ccm.importCustomerCategoryModel([{ description: 'No name' }]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
  });

  test('deduplicates rows by JSON stringify (exact duplicates)', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const insertedId = newId();
    mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: insertedId } });
    mockCollection.find.mockReturnValue(makeCursor([{ name: 'Gold', description: '' }]));

    const rows = [{ name: 'Gold' }, { name: 'Gold' }];
    await ccm.importCustomerCategoryModel(rows);

    const [docs] = mockCollection.insertMany.mock.calls[0];
    expect(docs).toHaveLength(1);
  });

  test('treats same name with different case as distinct (case-sensitive dedup by name key)', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const id1 = newId(),
      id2 = newId();
    mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: id1, 1: id2 } });
    mockCollection.find.mockReturnValue(
      makeCursor([
        { name: 'Gold', description: '' },
        { name: 'gold', description: '' },
      ])
    );

    await ccm.importCustomerCategoryModel([{ name: 'Gold' }, { name: 'gold' }]);

    const [docs] = mockCollection.insertMany.mock.calls[0];
    expect(docs).toHaveLength(2);
  });

  test('returns status:false with alreadyData when all categories already exist', async () => {
    mockCollection.findOne.mockResolvedValue({
      _id: newId(),
      name: 'Silver',
      description: 'exists',
    });
    const r = await ccm.importCustomerCategoryModel([{ name: 'Silver' }]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Customer category data already imported');
    expect(r.data[0].name).toBe('Silver');
  });

  test('inserts only new (non-existing) categories', async () => {
    mockCollection.findOne
      .mockResolvedValueOnce({ _id: newId(), name: 'Gold', description: '' })
      .mockResolvedValueOnce(null);
    const insertedId = newId();
    mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: insertedId } });
    mockCollection.find.mockReturnValue(makeCursor([{ name: 'Silver', description: '' }]));

    const r = await ccm.importCustomerCategoryModel([{ name: 'Gold' }, { name: 'Silver' }]);
    expect(r.status).toBe(true);
    const [docs] = mockCollection.insertMany.mock.calls[0];
    expect(docs.map((d) => d.name)).toEqual(['Silver']);
  });

  test('inserts documents with branch_id and license from BaseModel context', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const insertedId = newId();
    mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: insertedId } });
    mockCollection.find.mockReturnValue(makeCursor([{ name: 'Platinum', description: '' }]));

    await ccm.importCustomerCategoryModel([{ name: 'Platinum' }]);
    const [docs] = mockCollection.insertMany.mock.calls[0];
    expect(docs[0].branch_id).toEqual(MockBaseModel.currentBranch);
    expect(docs[0].license).toEqual(MockBaseModel.license);
  });

  test('returns inserted records from subsequent find query', async () => {
    const inserted = [{ name: 'Titanium', description: 'Elite' }];
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: newId() } });
    mockCollection.find.mockReturnValue(makeCursor(inserted));

    const r = await ccm.importCustomerCategoryModel([{ name: 'Titanium', description: 'Elite' }]);
    expect(r.status).toBe(true);
    expect(r.data).toEqual(inserted);
    expect(r.message).toBe('Customer category data imported successfully');
  });

  test('returns status:false with error message on exception', async () => {
    mockCollection.findOne.mockRejectedValue(new Error('import fail'));
    const r = await ccm.importCustomerCategoryModel([{ name: 'Boom' }]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('import fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. getSelectCustomerCategoryAjaxList()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — getSelectCustomerCategoryAjaxList()', () => {
  test('returns mapped { id, name } array on success', async () => {
    const raw = [
      { _id: newId(), name: 'Gold' },
      { _id: newId(), name: 'Silver' },
    ];
    mockCollection.find.mockReturnValue(makeCursor(raw));

    const r = await ccm.getSelectCustomerCategoryAjaxList('gold');
    expect(r.status).toBe(true);
    expect(r.data[0]).toEqual({ id: String(raw[0]._id), name: 'Gold' });
    expect(r.data).toHaveLength(2);
  });

  test('passes regex query to find when query string is provided', async () => {
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.getSelectCustomerCategoryAjaxList('vip');

    const [where] = mockCollection.find.mock.calls[0];
    expect(where.name).toEqual({ $regex: 'vip', $options: 'i' });
  });

  test('omits the name filter entirely when no query is provided', async () => {
    /* It used to send { $regex: '' }, which matches everything - so the
       dropdown was right by accident, through the same empty-pattern default
       that makes a hostile input return the whole collection. Leaving the
       clause out says the same thing on purpose. */
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.getSelectCustomerCategoryAjaxList();

    const [where] = mockCollection.find.mock.calls[0];
    expect(where.name).toBeUndefined();
  });

  test('a non-string query cannot become a Mongo operator', async () => {
    /* ?query[$ne]=x arrives as an object. It used to reach $regex intact. */
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.getSelectCustomerCategoryAjaxList({ $ne: 'x' });

    const [where] = mockCollection.find.mock.calls[0];
    expect(where.name).toBeUndefined();
  });

  test('filters by currentBranch and license', async () => {
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.getSelectCustomerCategoryAjaxList('');

    const [where] = mockCollection.find.mock.calls[0];
    expect(where.branch_id).toEqual(MockBaseModel.currentBranch);
    expect(where.license).toEqual(MockBaseModel.license);
  });

  test('sorts results by _id:1 ascending', async () => {
    const cursor = makeCursor([]);
    mockCollection.find.mockReturnValue(cursor);
    await ccm.getSelectCustomerCategoryAjaxList('');
    expect(cursor.sort).toHaveBeenCalledWith({ _id: 1 });
  });

  test('returns status:false with error message on exception', async () => {
    mockCollection.find.mockImplementation(() => {
      throw new Error('ajax fail');
    });
    const r = await ccm.getSelectCustomerCategoryAjaxList('x');
    expect(r.status).toBe(false);
    expect(r.message).toBe('ajax fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. categoryPage()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — categoryPage()', () => {
  test('calls checkPlan and passes limitCheck to page()', async () => {
    jest.spyOn(ccm, 'checkPlan').mockResolvedValue(50);
    jest.spyOn(ccm, 'page').mockResolvedValue({ status: true, data: {} });
    jest.spyOn(ccm, 'assignFilterObjects').mockReturnValue({});

    await ccm.categoryPage({}, {});

    expect(ccm.checkPlan).toHaveBeenCalledWith('customer_category', 'getAll');
    expect(ccm.page).toHaveBeenCalledWith(
      'customer_category',
      { limit: 50 },
      expect.any(Object),
      {},
      expect.any(Object)
    );
  });

  test('sets branch_id filter to currentBranch before calling page()', async () => {
    jest.spyOn(ccm, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(ccm, 'page').mockResolvedValue({ status: true, data: {} });
    jest.spyOn(ccm, 'assignFilterObjects').mockImplementation((f) => f);

    await ccm.categoryPage({}, {});

    const [, , filtersArg] = ccm.page.mock.calls[0];
    expect(filtersArg.branch_id).toEqual(MockBaseModel.currentBranch);
  });

  test('returns the page() response directly', async () => {
    const pageResponse = { status: true, data: { total: 5, list: [] } };
    jest.spyOn(ccm, 'checkPlan').mockResolvedValue(-1);
    jest.spyOn(ccm, 'page').mockResolvedValue(pageResponse);
    jest.spyOn(ccm, 'assignFilterObjects').mockReturnValue({});

    const r = await ccm.categoryPage();
    expect(r).toEqual(pageResponse);
  });

  test('returns status:false with error message on exception', async () => {
    jest.spyOn(ccm, 'checkPlan').mockRejectedValue(new Error('plan fail'));
    const r = await ccm.categoryPage();
    expect(r.status).toBe(false);
    expect(r.message).toBe('plan fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. exportCustomerCategoriesOrder()
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryModel — exportCustomerCategoriesOrder()', () => {
  test('returns status:true with queried documents on success', async () => {
    const docs = [{ name: 'Gold', description: 'Top tier' }];
    mockCollection.find.mockReturnValue(makeCursor(docs));

    const id = strId();
    const r = await ccm.exportCustomerCategoriesOrder([id]);
    expect(r.status).toBe(true);
    expect(r.data).toEqual(docs);
    expect(r.message).toBe('Customer Category Data Exported');
  });

  test('queries by ObjectId-converted IDs filtered by license', async () => {
    const id = strId();
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.exportCustomerCategoriesOrder([id]);

    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter._id.$in[0]).toBeInstanceOf(ObjectId);
    expect(filter.license).toEqual(MockBaseModel.license);
  });

  test('uses importFields projection for export', async () => {
    const id = strId();
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.exportCustomerCategoriesOrder([id]);

    const [, options] = mockCollection.find.mock.calls[0];
    expect(options.projection).toEqual(expect.objectContaining({ name: 1, description: 1 }));
  });

  test('sorts results by _id:-1 (most recent first)', async () => {
    mockCollection.find.mockReturnValue(makeCursor([]));
    await ccm.exportCustomerCategoriesOrder([strId()]);

    const [, options] = mockCollection.find.mock.calls[0];
    expect(options.sort).toEqual({ _id: -1 });
  });

  test('returns status:false with error message on exception', async () => {
    mockCollection.find.mockImplementation(() => {
      throw new Error('export fail');
    });
    const r = await ccm.exportCustomerCategoriesOrder([strId()]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('export fail');
  });
});
