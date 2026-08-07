/**
 * Unit tests for easy-tables.controller.js
 *
 * Architecture notes:
 *  - EasyTableController extends BaseController (no separate service layer)
 *  - All DB operations go directly through req.db.collection(tableName)
 *  - req.db is injected into the Express request by a DB-middleware
 *  - Exported as a singleton: module.exports = new EasyTableController()
 *  - Permission checks via inherited this.checkPermission() from BaseController
 *
 * Methods:
 *  - getTableData   — POST body: tableName, columns, where, orderBy, limit, skip, search, searchColumns
 *  - insertData     — POST body: tableName, data
 *  - updateData     — PUT  body: tableName, id, data
 *  - deleteData     — DEL  body: tableName, id
 *  - getTableSchema — GET  query: tableName
 *  - determineType  — private helper (called internally, also tested directly)
 *
 * Security notes (documented, not fixed):
 *  - tableName is taken directly from req.body/req.query with NO allowlist/sanitization
 *    → any MongoDB collection can be accessed by name (system.users, admin.*, etc.)
 *  - where filter is spread into the query without sanitization → NoSQL injection risk
 *  - search/searchColumns build $regex without escaping → regex injection risk
 *
 * Dependencies mocked:
 *  - req.db.collection() — mock collection factory per-test
 *  - ../services/base.service — transitive prevention (required by base.controller)
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../../src/services/base.service', () => ({}));

// ─── Imports ──────────────────────────────────────────────────────────────────

let ctrl;

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = 'aabbccddeeff001122334455'; // valid 24-char hex
/* A collection the endpoint is actually allowed to read. It used to be
   'products', which is not a collection this application has - the tests
   passed because the endpoint would read anything it was asked for, which was
   the bug. */
const TABLE_NAME = 'items';

// Admin user — passes all permission checks (high-privilege role)
const adminUser = {
  _id: VALID_ID,
  role: 'admin',
  username: 'admin',
};

// Staff user — passes READ checks (default true) but FAILS write/delete
const staffUser = {
  _id: VALID_ID,
  role: 'staff',
  access: {},
};

// User with explicit report.write = true
const writerUser = {
  _id: VALID_ID,
  role: 'staff',
  access: { report: { write: true } },
};

// User with explicit report.delete = true
const deleterUser = {
  _id: VALID_ID,
  role: 'staff',
  access: { report: { delete: true } },
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  user: adminUser,
  db: makeMockDb(),
  ...overrides,
});

// Creates a mock MongoDB collection with all common method stubs
const makeMockCollection = (overrides = {}) => {
  const findChain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue(findChain),
    insertOne: jest.fn().mockResolvedValue({ acknowledged: true, insertedId: VALID_ID }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    findOne: jest.fn().mockResolvedValue(null),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    _findChain: findChain, // exposed for assertions
    ...overrides,
  };
};

const makeMockDb = (collection = null) => ({
  collection: jest.fn().mockReturnValue(collection || makeMockCollection()),
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  ctrl = require('../../../src/controllers/easy-tables.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── determineType (private helper) ───────────────────────────────────────────

describe('EasyTableController — determineType', () => {
  it('returns "string" for null', () => {
    expect(ctrl.determineType(null)).toBe('string');
  });

  it('returns "string" for undefined', () => {
    expect(ctrl.determineType(undefined)).toBe('string');
  });

  it('returns "date" for Date instance', () => {
    expect(ctrl.determineType(new Date())).toBe('date');
  });

  it('returns "array" for Array', () => {
    expect(ctrl.determineType([1, 2, 3])).toBe('array');
  });

  it('returns "object" for plain object', () => {
    expect(ctrl.determineType({ key: 'val' })).toBe('object');
  });

  it('returns "number" for integer', () => {
    expect(ctrl.determineType(42)).toBe('number');
  });

  it('returns "number" for float', () => {
    expect(ctrl.determineType(3.14)).toBe('number');
  });

  it('returns "boolean" for true', () => {
    expect(ctrl.determineType(true)).toBe('boolean');
  });

  it('returns "boolean" for false', () => {
    expect(ctrl.determineType(false)).toBe('boolean');
  });

  it('returns "string" for a string value', () => {
    expect(ctrl.determineType('hello')).toBe('string');
  });

  it('returns "string" for empty string', () => {
    expect(ctrl.determineType('')).toBe('string');
  });
});

// ─── getTableData ──────────────────────────────────────────────────────────────

describe('EasyTableController — getTableData', () => {
  it('returns 403 when user has no permission (null user)', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME }, user: null });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns 400 when tableName is missing', async () => {
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Table name is required',
      })
    );
  });

  it('calls req.db.collection with the correct tableName', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(req.db.collection).toHaveBeenCalledWith(TABLE_NAME);
  });

  it('returns 200 with data and pagination info on success', async () => {
    const doc = { _id: VALID_ID, name: 'Widget' };
    const col = makeMockCollection();
    col.countDocuments.mockResolvedValue(1);
    col._findChain.toArray.mockResolvedValue([doc]);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, limit: 5, skip: 0 },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({ total: 1, limit: 5, skip: 0, data: [doc] }),
      })
    );
  });

  it('uses default limit=10 and skip=0 when not provided', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.limit).toHaveBeenCalledWith(10);
    expect(col._findChain.skip).toHaveBeenCalledWith(0);
  });

  it('applies custom limit and skip from body', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, limit: 20, skip: 40 },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.limit).toHaveBeenCalledWith(20);
    expect(col._findChain.skip).toHaveBeenCalledWith(40);
  });

  it('applies orderBy sort from body', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, orderBy: { name: 1 } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.sort).toHaveBeenCalledWith({ name: 1 });
  });

  it('uses default orderBy { _id: -1 } when not provided', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.sort).toHaveBeenCalledWith({ _id: -1 });
  });

  it('converts where._id string to ObjectId', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, where: { _id: VALID_ID } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const [query] = col.find.mock.calls[0];
    expect(typeof query._id).toBe('object'); // ObjectId, not string
  });

  it('spreads where conditions into query', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, where: { category: 'books', status: 'active' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const [query] = col.find.mock.calls[0];
    expect(query.category).toBe('books');
    expect(query.status).toBe('active');
  });

  it('adds $or search clause when search and searchColumns provided', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: {
        tableName: TABLE_NAME,
        search: 'widget',
        searchColumns: ['name', 'description'],
      },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const [query] = col.find.mock.calls[0];
    expect(query.$or).toEqual([
      { name: { $regex: 'widget', $options: 'i' } },
      { description: { $regex: 'widget', $options: 'i' } },
    ]);
  });

  it('does NOT add $or when search is empty string', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, search: '', searchColumns: ['name'] },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const [query] = col.find.mock.calls[0];
    expect(query.$or).toBeUndefined();
  });

  it('does NOT add $or when searchColumns is empty array', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, search: 'hello', searchColumns: [] },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const [query] = col.find.mock.calls[0];
    expect(query.$or).toBeUndefined();
  });

  it('filters columns when columns is a comma-separated string', async () => {
    const col = makeMockCollection();
    col._findChain.toArray.mockResolvedValue([{ name: 'A', price: 10, hidden: 'x' }]);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, columns: 'name,price' },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.data[0]).toEqual({ name: 'A', price: 10 });
    expect(data.data[0].hidden).toBeUndefined();
  });

  it('filters columns when columns is an array', async () => {
    const col = makeMockCollection();
    col._findChain.toArray.mockResolvedValue([{ name: 'A', price: 10, secret: 'y' }]);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, columns: ['name'] },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.data[0]).toEqual({ name: 'A' });
  });

  it('returns all columns when columns is "*"', async () => {
    const col = makeMockCollection();
    const doc = { name: 'A', price: 10, secret: 'y' };
    col._findChain.toArray.mockResolvedValue([doc]);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, columns: '*' },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.data[0]).toEqual(doc);
  });

  it('skips column not present on document without crashing', async () => {
    const col = makeMockCollection();
    col._findChain.toArray.mockResolvedValue([{ name: 'A' }]);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, columns: ['name', 'nonexistent'] },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.data[0]).toEqual({ name: 'A' });
  });

  it('returns 200 with empty data when no documents found', async () => {
    const col = makeMockCollection();
    col.countDocuments.mockResolvedValue(0);
    col._findChain.toArray.mockResolvedValue([]);
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.total).toBe(0);
    expect(data.data).toEqual([]);
  });

  it('returns 500 when DB operation throws', async () => {
    const col = makeMockCollection();
    col.countDocuments.mockRejectedValue(new Error('DB crash'));
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Failed to fetch table data',
      })
    );
  });

  it('returns 500 when find.toArray throws', async () => {
    const col = makeMockCollection();
    col._findChain.toArray.mockRejectedValue(new Error('cursor error'));
    const req = mockRequest({ body: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // Security edge cases
  it('refuses a collection that is not on the readable list', async () => {
    /* This used to assert the opposite - that system.users was queried - as a
       record of the gap. The endpoint takes tableName from the body, so
       without a list it would read anything the caller named, including the
       collections holding password hashes. */
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: 'system.users' }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(req.db.collection).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses a field whose name looks like a credential', async () => {
    /* $regex reports whether a pattern matched, so a searchable hash field can
       be recovered one character at a time. */
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, search: 'a', searchColumns: ['passwordHash'] },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses $where rather than handing it to the database', async () => {
    /* Also used to assert the gap. $where evaluates JavaScript inside the
       database: at best it occupies a connection for five seconds a request,
       at worst it reads documents the query was never scoped to. */
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, where: { $where: 'sleep(5000)' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('and refuses it when it is nested inside $and', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, where: { $and: [{ a: 1 }, { $where: '1' }] } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('handles large limit value without crashing', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, limit: 999999 },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.limit).toHaveBeenCalledWith(999999);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('handles page=0 and negative skip without crashing', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME, skip: -5 }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(col._findChain.skip).toHaveBeenCalledWith(-5);
  });

  it('handles non-numeric limit — parseInt coerces to NaN, still calls limit', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME, limit: 'abc' }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    // parseInt('abc') = NaN — limit called with NaN
    expect(col._findChain.limit).toHaveBeenCalledWith(NaN);
  });
});

// ─── insertData ───────────────────────────────────────────────────────────────

describe('EasyTableController — insertData', () => {
  it('returns 403 when user lacks create permission (staff, no access)', async () => {
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      user: staffUser,
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('returns 403 when user is null', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, data: { name: 'X' } }, user: null });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows insert when user has report.write = true', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      user: writerUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 400 when tableName is missing', async () => {
    const req = mockRequest({ body: { data: { name: 'X' } } });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Table name and data are required' })
    );
  });

  it('returns 400 when data is missing', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME } });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when both tableName and data are missing', async () => {
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 201 with inserted document on success', async () => {
    const col = makeMockCollection();
    col.insertOne.mockResolvedValue({ acknowledged: true, insertedId: VALID_ID });
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'Widget', price: 10 } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Data inserted successfully',
        data: expect.objectContaining({ _id: VALID_ID, name: 'Widget', price: 10 }),
      })
    );
  });

  it('adds created_at, updated_at, and created_by to inserted document', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      user: adminUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    const [insertedDoc] = col.insertOne.mock.calls[0];
    expect(insertedDoc.created_at).toBeInstanceOf(Date);
    expect(insertedDoc.updated_at).toBeInstanceOf(Date);
    expect(insertedDoc.created_by).toBe(adminUser._id);
  });

  it('calls insertOne on correct collection', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(req.db.collection).toHaveBeenCalledWith(TABLE_NAME);
    expect(col.insertOne).toHaveBeenCalled();
  });

  it('returns 400 when insertOne returns acknowledged=false', async () => {
    const col = makeMockCollection();
    col.insertOne.mockResolvedValue({ acknowledged: false });
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to insert data' })
    );
  });

  it('returns 500 when insertOne throws', async () => {
    const col = makeMockCollection();
    col.insertOne.mockRejectedValue(new Error('write error'));
    const req = mockRequest({
      body: { tableName: TABLE_NAME, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to insert data' })
    );
  });
});

// ─── updateData ───────────────────────────────────────────────────────────────

describe('EasyTableController — updateData', () => {
  it('returns 403 when user lacks update permission', async () => {
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'X' } },
      user: staffUser,
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 403 when user is null', async () => {
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: {} },
      user: null,
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when tableName is missing', async () => {
    const req = mockRequest({ body: { id: VALID_ID, data: { name: 'X' } } });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Table name, ID, and data are required' })
    );
  });

  it('returns 400 when id is missing', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, data: { name: 'X' } } });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when data is missing', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID } });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 with updated document on success', async () => {
    const updatedDoc = { _id: VALID_ID, name: 'Updated', price: 20 };
    const col = makeMockCollection();
    col.findOne.mockResolvedValue(updatedDoc);
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'Updated', price: 20 } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Data updated successfully',
        data: updatedDoc,
      })
    );
  });

  it('calls updateOne with ObjectId and $set including updated_at and updated_by', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({});
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { price: 99 } },
      user: adminUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    const [filter, updateDoc] = col.updateOne.mock.calls[0];
    expect(typeof filter._id).toBe('object'); // ObjectId
    expect(updateDoc.$set.price).toBe(99);
    expect(updateDoc.$set.updated_at).toBeInstanceOf(Date);
    expect(updateDoc.$set.updated_by).toBe(adminUser._id);
  });

  it('returns 404 when matchedCount is 0', async () => {
    const col = makeMockCollection();
    col.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Document not found' })
    );
  });

  it('calls findOne after successful update to return fresh document', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ _id: VALID_ID, name: 'Fresh' });
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'Fresh' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(col.findOne).toHaveBeenCalled();
    const { data } = res.json.mock.calls[0][0];
    expect(data.name).toBe('Fresh');
  });

  it('returns 500 when updateOne throws', async () => {
    const col = makeMockCollection();
    col.updateOne.mockRejectedValue(new Error('write failed'));
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to update data' })
    );
  });

  it('returns 500 when findOne (after update) throws', async () => {
    const col = makeMockCollection();
    col.findOne.mockRejectedValue(new Error('read failed'));
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { name: 'X' } },
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when id is invalid (ObjectId throws)', async () => {
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: 'not-a-valid-id', data: { name: 'X' } },
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── deleteData ───────────────────────────────────────────────────────────────

describe('EasyTableController — deleteData', () => {
  it('returns 403 when user lacks delete permission', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, user: staffUser });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows delete when user has report.delete = true', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID },
      user: deleterUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 403 when user is null', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, user: null });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when tableName is missing', async () => {
    const req = mockRequest({ body: { id: VALID_ID } });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Table name and ID are required' })
    );
  });

  it('returns 400 when id is missing', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME } });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 with null data and success message on successful delete', async () => {
    const col = makeMockCollection();
    col.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Data deleted successfully',
        data: null,
      })
    );
  });

  it('calls deleteOne with correct ObjectId filter', async () => {
    const col = makeMockCollection();
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    const [filter] = col.deleteOne.mock.calls[0];
    expect(typeof filter._id).toBe('object'); // ObjectId
  });

  it('returns 404 when deletedCount is 0', async () => {
    const col = makeMockCollection();
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Document not found' })
    );
  });

  it('returns 500 when deleteOne throws', async () => {
    const col = makeMockCollection();
    col.deleteOne.mockRejectedValue(new Error('delete failed'));
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to delete data' })
    );
  });

  it('returns 500 when id is invalid (ObjectId throws)', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: 'bad-id' } });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── getTableSchema ───────────────────────────────────────────────────────────

describe('EasyTableController — getTableSchema', () => {
  it('returns 403 when user is null', async () => {
    const req = mockRequest({ query: { tableName: TABLE_NAME }, user: null });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 when tableName query param is missing', async () => {
    const req = mockRequest({ query: {} });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Table name is required' })
    );
  });

  it('returns 200 with { columns: [] } when collection is empty (no sampleDoc)', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue(null);
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: { columns: [] },
      })
    );
  });

  it('returns 200 with column names and types inferred from sample document', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ _id: VALID_ID, name: 'Widget', price: 9.99, active: true });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', type: 'string' }),
        expect.objectContaining({ name: 'price', type: 'number' }),
        expect.objectContaining({ name: 'active', type: 'boolean' }),
      ])
    );
  });

  it('sets required=false on all columns', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ name: 'X', count: 1 });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns.every((c) => c.required === false)).toBe(true);
  });

  it('infers date type for Date fields', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ created_at: new Date() });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns.find((c) => c.name === 'created_at').type).toBe('date');
  });

  it('infers array type for Array fields', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ tags: ['a', 'b'] });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns.find((c) => c.name === 'tags').type).toBe('array');
  });

  it('infers object type for nested object fields', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ address: { city: 'X', pin: 1 } });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns.find((c) => c.name === 'address').type).toBe('object');
  });

  it('infers string type for null field value', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ notes: null });
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    const { columns } = res.json.mock.calls[0][0].data;
    expect(columns.find((c) => c.name === 'notes').type).toBe('string');
  });

  it('calls req.db.collection with correct tableName from query', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue(null);
    const req = mockRequest({ query: { tableName: 'orders' }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(req.db.collection).toHaveBeenCalledWith('orders');
  });

  it('passes staffUser (read allowed for all roles)', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue(null);
    const req = mockRequest({
      query: { tableName: TABLE_NAME },
      user: staffUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    // staffUser has no access object but read defaults to true
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 when findOne throws', async () => {
    const col = makeMockCollection();
    col.findOne.mockRejectedValue(new Error('DB down'));
    const req = mockRequest({ query: { tableName: TABLE_NAME }, db: makeMockDb(col) });
    const res = mockResponse();
    await ctrl.getTableSchema(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Failed to get table schema',
      })
    );
  });
});

// ─── Permission behaviour across all methods ─────────────────────────────────

describe('EasyTableController — permission cross-checks', () => {
  it('getTableData: staffUser (role=staff, no access) CAN read — read defaults to true', async () => {
    const col = makeMockCollection();
    const req = mockRequest({
      body: { tableName: TABLE_NAME },
      user: staffUser,
      db: makeMockDb(col),
    });
    const res = mockResponse();
    await ctrl.getTableData(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('insertData: staffUser CANNOT insert — write check fails without access', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, data: { x: 1 } }, user: staffUser });
    const res = mockResponse();
    await ctrl.insertData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('updateData: staffUser CANNOT update — write check fails without access', async () => {
    const req = mockRequest({
      body: { tableName: TABLE_NAME, id: VALID_ID, data: { x: 1 } },
      user: staffUser,
    });
    const res = mockResponse();
    await ctrl.updateData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deleteData: staffUser CANNOT delete — delete check fails without access', async () => {
    const req = mockRequest({ body: { tableName: TABLE_NAME, id: VALID_ID }, user: staffUser });
    const res = mockResponse();
    await ctrl.deleteData(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('all methods: adminUser bypasses all permission checks', async () => {
    const col = makeMockCollection();
    col.findOne.mockResolvedValue({ name: 'x' });
    const queries = [
      { method: 'getTableData', body: { tableName: TABLE_NAME }, query: {} },
      { method: 'getTableSchema', body: {}, query: { tableName: TABLE_NAME } },
    ];
    for (const { method, body, query } of queries) {
      jest.clearAllMocks();
      const c = makeMockCollection();
      c.findOne.mockResolvedValue({ name: 'x' });
      const req = mockRequest({ body, query, user: adminUser, db: makeMockDb(c) });
      const res = mockResponse();
      await ctrl[method](req, res);
      expect(res.status).not.toHaveBeenCalledWith(403);
    }
  });
});
