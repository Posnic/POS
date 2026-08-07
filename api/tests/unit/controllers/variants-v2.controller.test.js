'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mongoose mock — ObjectId used for isValid + constructor in the controller
jest.mock('mongoose', () => {
  function ObjectId(id) {
    this._id = id;
    this.toString = () => String(id);
  }
  ObjectId.isValid = jest.fn(() => true);
  return {
    Types: { ObjectId },
    connection: { db: null },
  };
});

// Variant model mock — built entirely inside factory to comply with jest.mock scope rules
jest.mock('../../../src/models/variant.model', () => {
  const mockInstance = {
    _id: 'newvid111111111111111111',
    name: '',
    fields: [],
    description: '',
    save: jest.fn().mockResolvedValue(true),
    toObject: jest.fn(),
  };
  const MockCtor = jest.fn((data) => {
    if (data) Object.assign(mockInstance, data);
    mockInstance.toObject.mockReturnValue({ ...mockInstance });
    return mockInstance;
  });
  MockCtor.countDocuments = jest.fn();
  MockCtor.find = jest.fn();
  MockCtor.findById = jest.fn();
  MockCtor.findOne = jest.fn();
  MockCtor.findByIdAndDelete = jest.fn();
  MockCtor.deleteMany = jest.fn();
  MockCtor._instance = mockInstance;
  return MockCtor;
});

// express-validator
let mockValidationErrors = [];
jest.mock('express-validator', () => ({
  validationResult: jest.fn(() => ({
    isEmpty: () => mockValidationErrors.length === 0,
    array: () => mockValidationErrors,
  })),
}));

// activityLogger
const mockCreateActivityLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/utils/activityLogger', () => ({
  createActivityLog: mockCreateActivityLog,
}));

// ─── Load controller & get references to mocks ───────────────────────────────
const ctrl = require('../../../src/controllers/variants-v2.controller');
const mockVariantModel = require('../../../src/models/variant.model');
const mockVariantInstance = mockVariantModel._instance;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  user: { _id: 'user001', id: 'user001' },
  ...overrides,
});

// Build chainable Mongoose find mock: find().sort().limit().skip().select().lean()
const buildFindChain = (resolved) => {
  const chain = {
    sort: jest.fn(),
    limit: jest.fn(),
    skip: jest.fn(),
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(resolved),
  };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  return chain;
};

// Build mock Mongoose document (for findById returns that support .save())
const buildDoc = (data) => ({
  ...data,
  save: jest.fn().mockResolvedValue(true),
  toObject: jest.fn().mockReturnValue(data),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockValidationErrors = [];
  // Reset document instance
  mockVariantInstance.save.mockResolvedValue(true);
  mockVariantInstance._id = 'newvid111111111111111111';
  mockVariantInstance.name = 'Test Variant';
  mockVariantInstance.fields = [{ name: 'Red' }];
  mockVariantInstance.description = '';
  mockVariantInstance.toObject.mockReturnValue({
    _id: 'newvid111111111111111111',
    name: 'Test Variant',
    fields: [{ name: 'Red' }],
    description: '',
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getAll
// ═══════════════════════════════════════════════════════════════════════════════
describe('getAll', () => {
  test('200 with paginated list', async () => {
    const fakeVariants = [
      { _id: 'v1', name: 'Size', fields: [{ name: 'S' }, { name: 'M' }], description: '' },
    ];
    mockVariantModel.countDocuments.mockResolvedValue(1);
    mockVariantModel.find.mockReturnValue(buildFindChain(fakeVariants));

    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { page: '1', limit: '5' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        data: expect.objectContaining({ total: 1, list: expect.any(Array) }),
      })
    );
  });

  test('defaults page=1 and limit=5 when not provided', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.per_page).toBe(5);
    expect(res.json.mock.calls[0][0].data.current_page).toBe(1);
  });

  test('defaults invalid page/limit to 1/5', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { page: '-1', limit: 'abc' } }), res);
    expect(res.json.mock.calls[0][0].data.current_page).toBe(1);
    expect(res.json.mock.calls[0][0].data.per_page).toBe(5);
  });

  test('404 when filters JSON is invalid', async () => {
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters: '{invalid-json}' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Incorrect format of filter',
      })
    );
  });

  test('applies name filter as regex', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(1);
    mockVariantModel.find.mockReturnValue(
      buildFindChain([{ _id: 'v1', name: 'Size', fields: [] }])
    );
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters: JSON.stringify({ name: 'Si' }) } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.objectContaining({ $regex: 'Si', $options: 'i' }) })
    );
  });

  test('applies name regex filter when name is object with $regex', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(1);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    const filters = JSON.stringify({ name: { $regex: 'si', $options: 'i' } });
    await ctrl.getAll(mockReq({ query: { filters } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ name: { $regex: 'si', $options: 'i' } })
    );
  });

  test('applies updated_date date range filter', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const filters = JSON.stringify({ updated_date: { $gte: '2024-01-01', $lte: '2024-12-31' } });
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { filters } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        updated_date: expect.objectContaining({ $gte: expect.any(Date), $lte: expect.any(Date) }),
      })
    );
  });

  test('sorts asc when order=asc', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    const chain = buildFindChain([]);
    mockVariantModel.find.mockReturnValue(chain);
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { sort: 'name', order: 'asc' } }), res);
    expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
  });

  test('sorts desc by default', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    const chain = buildFindChain([]);
    mockVariantModel.find.mockReturnValue(chain);
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: {} }), res);
    expect(chain.sort).toHaveBeenCalledWith({ _id: -1 });
  });

  test('returns empty list when no variants found', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.json.mock.calls[0][0].data.list).toHaveLength(0);
    expect(res.json.mock.calls[0][0].data.total).toBe(0);
  });

  test('500 on exception', async () => {
    mockVariantModel.countDocuments.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('calculates total_pages correctly', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(12);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { limit: '5' } }), res);
    expect(res.json.mock.calls[0][0].data.total_pages).toBe(3); // ceil(12/5)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('getOne', () => {
  test('200 with formatted variant', async () => {
    const doc = { _id: 'v1', name: 'Color', fields: [{ name: 'Red' }], description: '' };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ name: 'Color' });
  });

  test('404 when variant not found', async () => {
    mockVariantModel.findById.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Variant not found' })
    );
  });

  test('500 on exception', async () => {
    mockVariantModel.findById.mockRejectedValue(new Error('DB'));
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('response data includes product_type array', async () => {
    const doc = {
      _id: 'v1',
      name: 'Size',
      fields: [{ name: 'S' }, { name: 'M' }],
      description: '',
    };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.product_type).toEqual(['S', 'M']);
    expect(data.fields).toEqual([{ name: 'S' }, { name: 'M' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// create
// ═══════════════════════════════════════════════════════════════════════════════
describe('create', () => {
  test('201 on successful creation', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockVariantInstance.save.mockResolvedValue(true);

    const req = mockReq({ body: { name: 'Color', product_type: ['Red', 'Blue'] } });
    const res = mockRes();
    await ctrl.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'variant added successfully',
      })
    );
  });

  test('400 when validationResult has errors', async () => {
    mockValidationErrors = [{ msg: 'Name is required' }];
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'X', product_type: ['R'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation failed' })
    );
  });

  test('400 when name is empty string', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: '   ', product_type: ['Red'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Variant name is required' })
    );
  });

  test('400 when name is missing from body', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { product_type: ['Red'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when product_type is empty array', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color', product_type: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('At least one variant value is required');
  });

  test('400 when product_type has only blank entries', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color', product_type: ['', '  '] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when product_type is not provided', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('406 when duplicate variant name exists', async () => {
    mockVariantModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'existing', name: 'Color' }),
    });
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: 'Color', product_type: ['Red'] } }), res);
    expect(res.status).toHaveBeenCalledWith(406);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'This variant details already exist in our system',
      })
    );
  });

  test('trims name before checking duplicate and saving', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const req = mockReq({ body: { name: '  Color  ', product_type: ['Red'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    // Verify the constructor was called with trimmed name
    expect(mockVariantModel).toHaveBeenCalledWith(expect.objectContaining({ name: 'Color' }));
  });

  test('calls createActivityLog on success', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const req = mockReq({ body: { name: 'Size', product_type: ['S'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entity: 'Variant' })
    );
  });

  test('does not call createActivityLog on validation failure', async () => {
    const res = mockRes();
    await ctrl.create(mockReq({ body: { name: '', product_type: ['Red'] } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on save exception', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockVariantInstance.save.mockRejectedValue(new Error('Save error'));
    const req = mockReq({ body: { name: 'Color', product_type: ['Red'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('stores fields as array of objects with name property', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const req = mockReq({ body: { name: 'Color', product_type: ['Red', 'Blue', 'Green'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    expect(mockVariantModel).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [{ name: 'Red' }, { name: 'Blue' }, { name: 'Green' }],
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// update
// ═══════════════════════════════════════════════════════════════════════════════
describe('update', () => {
  const mongoose = require('mongoose');
  const validId = 'aabbccddeeff001122334455';

  const buildExistingDoc = (overrides = {}) =>
    buildDoc({
      _id: validId,
      name: 'Old Name',
      fields: [{ name: 'S' }],
      description: '',
      ...overrides,
    });

  test('200 on successful update', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const doc = buildExistingDoc();
    mockVariantModel.findById.mockResolvedValue(doc);
    const req = mockReq({
      params: { id: validId },
      body: { name: 'New Name', product_type: ['L'] },
    });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'variant updated successfully' })
    );
  });

  test('400 when validationResult has errors', async () => {
    mockValidationErrors = [{ msg: 'Name required' }];
    const res = mockRes();
    await ctrl.update(
      mockReq({ params: { id: validId }, body: { name: 'X', product_type: ['R'] } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when id is missing', async () => {
    const res = mockRes();
    await ctrl.update(mockReq({ params: {}, body: { name: 'X', product_type: ['R'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Invalid variant ID');
  });

  test('400 when id is invalid ObjectId', async () => {
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await ctrl.update(
      mockReq({ params: { id: 'not-valid' }, body: { name: 'X', product_type: ['R'] } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true); // restore
  });

  test('400 when name is empty', async () => {
    const res = mockRes();
    await ctrl.update(
      mockReq({ params: { id: validId }, body: { name: '  ', product_type: ['R'] } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Variant name is required');
  });

  test('400 when product_type is empty', async () => {
    const res = mockRes();
    await ctrl.update(
      mockReq({ params: { id: validId }, body: { name: 'Color', product_type: [] } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('406 on duplicate name (different ID)', async () => {
    mockVariantModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'other-id', name: 'Color' }),
    });
    const req = mockReq({ params: { id: validId }, body: { name: 'Color', product_type: ['R'] } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(406);
  });

  test('404 when variant not found', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockVariantModel.findById.mockResolvedValue(null);
    const req = mockReq({ params: { id: validId }, body: { name: 'Color', product_type: ['R'] } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('calls save and createActivityLog on success', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const doc = buildExistingDoc();
    mockVariantModel.findById.mockResolvedValue(doc);
    const req = mockReq({
      params: { id: validId },
      body: { name: 'Updated', product_type: ['XL'] },
    });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(doc.save).toHaveBeenCalled();
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entity: 'Variant' })
    );
  });

  test('updates fields array correctly', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const doc = buildExistingDoc();
    mockVariantModel.findById.mockResolvedValue(doc);
    const req = mockReq({
      params: { id: validId },
      body: { name: 'Size', product_type: ['S', 'M', 'L'] },
    });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(doc.fields).toEqual([{ name: 'S' }, { name: 'M' }, { name: 'L' }]);
  });

  test('500 on exception', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockVariantModel.findById.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ params: { id: validId }, body: { name: 'X', product_type: ['Y'] } });
    const res = mockRes();
    await ctrl.update(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delete (exported as ctrl.delete → VariantControllerV2.remove)
// ═══════════════════════════════════════════════════════════════════════════════
describe('delete (remove)', () => {
  test('200 on successful delete', async () => {
    const doc = { _id: 'v1', name: 'Color' };
    mockVariantModel.findByIdAndDelete.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Variant deleted successfully' })
    );
  });

  test('404 when variant not found', async () => {
    mockVariantModel.findByIdAndDelete.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Variant not found' })
    );
  });

  test('calls createActivityLog with DELETE action on success', async () => {
    mockVariantModel.findByIdAndDelete.mockResolvedValue({ _id: 'v1', name: 'Color' });
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' }, user: { _id: 'u1' } }), res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entity: 'Variant' })
    );
  });

  test('does not call createActivityLog when not found', async () => {
    mockVariantModel.findByIdAndDelete.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(mockCreateActivityLog).not.toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockVariantModel.findByIdAndDelete.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// legacyDelete
// ═══════════════════════════════════════════════════════════════════════════════
describe('legacyDelete', () => {
  const validId1 = 'aabbccddeeff001122334455';
  const validId2 = 'aabbccddeeff001122334456';

  test('200 when bulk delete succeeds', async () => {
    mockVariantModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const req = mockReq({ body: { data: [validId1, validId2] } });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toBe(2);
    expect(res.json.mock.calls[0][0].message).toBe('variant deleted successfully');
  });

  test('400 when body.data is empty array', async () => {
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: { data: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('UID is missing');
  });

  test('400 when body.data is missing', async () => {
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when all IDs are invalid format', async () => {
    const mongoose = require('mongoose');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await ctrl.legacyDelete(mockReq({ body: { data: ['bad-id-1', 'bad-id-2'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Invalid ID format');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true); // restore
  });

  test('calls createActivityLog with BULK_DELETE action', async () => {
    mockVariantModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const req = mockReq({ body: { data: [validId1] } });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BULK_DELETE', entity: 'Variant' })
    );
  });

  test('500 on exception', async () => {
    mockVariantModel.deleteMany.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ body: { data: [validId1] } });
    const res = mockRes();
    await ctrl.legacyDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getVariantsAjaxList
// ═══════════════════════════════════════════════════════════════════════════════
describe('getVariantsAjaxList', () => {
  test('200 with matching suggestions', async () => {
    const variants = [{ _id: 'v1', name: 'Size', fields: [{ name: 'S' }] }];
    mockVariantModel.find.mockReturnValue(buildFindChain(variants));
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: 'si' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0]).toMatchObject({ name: 'Size' });
  });

  test('200 with all variants when query is empty', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('searches by name regex when query provided', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: 'col' } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith({
      name: { $regex: 'col', $options: 'i' },
    });
  });

  test('trims whitespace from query', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: { query: '  col  ' } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith({
      name: { $regex: 'col', $options: 'i' },
    });
  });

  test('500 on exception', async () => {
    mockVariantModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB')) }),
      }),
    });
    const res = mockRes();
    await ctrl.getVariantsAjaxList(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getVariantDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('getVariantDetails', () => {
  test('200 with variant data using query.id', async () => {
    const doc = { _id: 'v1', name: 'Color', fields: [{ name: 'Red' }] };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ name: 'Color' });
  });

  test('200 with variant data using params.id', async () => {
    const doc = { _id: 'v2', name: 'Size', fields: [{ name: 'M' }] };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ params: { id: 'v2' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when no id provided', async () => {
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: {}, params: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Variant Id Not Found');
  });

  test('404 when variant not found', async () => {
    mockVariantModel.findById.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'badid' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('Variant not found');
  });

  test('500 on exception', async () => {
    mockVariantModel.findById.mockRejectedValue(new Error('DB'));
    const res = mockRes();
    await ctrl.getVariantDetails(mockReq({ query: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportVariants
// ═══════════════════════════════════════════════════════════════════════════════
describe('exportVariants', () => {
  const validId1 = 'aabbccddeeff001122334455';

  const fakeVariants = [
    {
      _id: validId1,
      name: 'Color',
      fields: [{ name: 'Red' }, { name: 'Blue' }],
      description: 'Desc',
    },
  ];

  test('200 with exported rows when body is array of ids', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain(fakeVariants));
    const req = mockReq({ body: [validId1] });
    const res = mockRes();
    await ctrl.exportVariants(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const rows = res.json.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Color', fields: 'Red, Blue', description: 'Desc' });
  });

  test('200 when body has data array', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain(fakeVariants));
    const req = mockReq({ body: { data: [validId1] } });
    const res = mockRes();
    await ctrl.exportVariants(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('400 when body is empty', async () => {
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: null }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('No variants selected for export');
  });

  test('400 when body is empty array', async () => {
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: [] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when all IDs are invalid format', async () => {
    const mongoose = require('mongoose');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: ['bad-id'] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Invalid ID format');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true);
  });

  test('200 when body data is JSON string', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain(fakeVariants));
    const req = mockReq({ body: { data: JSON.stringify([validId1]) } });
    const res = mockRes();
    await ctrl.exportVariants(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('200 when body is plain object with string values as IDs', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain(fakeVariants));
    const req = mockReq({ body: { 0: validId1 } });
    const res = mockRes();
    await ctrl.exportVariants(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('fields column is comma-joined string of field names', async () => {
    const variants = [
      {
        _id: validId1,
        name: 'Size',
        fields: [{ name: 'S' }, { name: 'M' }, { name: 'L' }],
        description: '',
      },
    ];
    mockVariantModel.find.mockReturnValue(buildFindChain(variants));
    const req = mockReq({ body: [validId1] });
    const res = mockRes();
    await ctrl.exportVariants(req, res);
    expect(res.json.mock.calls[0][0].data[0].fields).toBe('S, M, L');
  });

  test('500 on exception', async () => {
    mockVariantModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB')) }),
      }),
    });
    const res = mockRes();
    await ctrl.exportVariants(mockReq({ body: [validId1] }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getByField
// ═══════════════════════════════════════════════════════════════════════════════
describe('getByField', () => {
  test('200 with matching variants', async () => {
    const variants = [{ _id: 'v1', name: 'Color', fields: [{ name: 'Red' }] }];
    mockVariantModel.find.mockReturnValue(buildFindChain(variants));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'Red' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  test('200 with empty array when no matches', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'NonExistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(0);
  });

  test('queries by fields.name correctly', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'XL' } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith({ 'fields.name': 'XL' });
  });

  test('500 on exception', async () => {
    mockVariantModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB')) }),
    });
    const res = mockRes();
    await ctrl.getByField(mockReq({ params: { field: 'Red' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getStats
// ═══════════════════════════════════════════════════════════════════════════════
describe('getStats', () => {
  test('200 with total count', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(42);
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 42 });
  });

  test('200 with zero when no variants', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.json.mock.calls[0][0].data.total).toBe(0);
  });

  test('500 on exception', async () => {
    mockVariantModel.countDocuments.mockRejectedValue(new Error('DB'));
    const res = mockRes();
    await ctrl.getStats(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// search
// ═══════════════════════════════════════════════════════════════════════════════
describe('search', () => {
  test('200 with results', async () => {
    const variants = [{ _id: 'v1', name: 'Color', fields: [{ name: 'Red' }] }];
    mockVariantModel.find.mockReturnValue(buildFindChain(variants));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'col' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  test('400 when query is missing', async () => {
    const res = mockRes();
    await ctrl.search(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Search query must be at least 2 characters');
  });

  test('400 when query is 1 character', async () => {
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'a' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when query is only spaces', async () => {
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: ' ' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('searches name and description with $or', async () => {
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'co' } }), res);
    expect(mockVariantModel.find).toHaveBeenCalledWith({
      $or: [
        { name: { $regex: 'co', $options: 'i' } },
        { description: { $regex: 'co', $options: 'i' } },
      ],
    });
  });

  test('uses default limit of 20', async () => {
    const chain = buildFindChain([]);
    mockVariantModel.find.mockReturnValue(chain);
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'si' } }), res);
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  test('uses custom limit when provided', async () => {
    const chain = buildFindChain([]);
    mockVariantModel.find.mockReturnValue(chain);
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'si', limit: '10' } }), res);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  test('500 on exception', async () => {
    mockVariantModel.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB')) }),
    });
    const res = mockRes();
    await ctrl.search(mockReq({ query: { q: 'co' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// bulkDelete
// ═══════════════════════════════════════════════════════════════════════════════
describe('bulkDelete', () => {
  const validId1 = 'aabbccddeeff001122334455';
  const validId2 = 'aabbccddeeff001122334456';

  test('200 when bulk delete succeeds', async () => {
    mockVariantModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const req = mockReq({ body: { ids: [validId1, validId2] } });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ deleted: 2 });
    expect(res.json.mock.calls[0][0].message).toBe('Variants deleted successfully');
  });

  test('400 when ids is empty array', async () => {
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: { ids: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('No variant IDs provided');
  });

  test('400 when ids is missing from body', async () => {
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when all ids are invalid format', async () => {
    const mongoose = require('mongoose');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(false);
    const res = mockRes();
    await ctrl.bulkDelete(mockReq({ body: { ids: ['bad-id'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Invalid ID format');
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true);
  });

  test('calls createActivityLog with BULK_DELETE', async () => {
    mockVariantModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const req = mockReq({ body: { ids: [validId1] } });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BULK_DELETE', entity: 'Variant' })
    );
  });

  test('500 on exception', async () => {
    mockVariantModel.deleteMany.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ body: { ids: [validId1] } });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('filters out non-string ids before passing to deleteMany', async () => {
    const mongoose = require('mongoose');
    // isValid accepts only strings in real code
    mongoose.Types.ObjectId.isValid = jest.fn((id) => typeof id === 'string');
    mockVariantModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const req = mockReq({ body: { ids: [validId1, 123, null] } });
    const res = mockRes();
    await ctrl.bulkDelete(req, res);
    // Should have filtered out non-strings
    expect(mockVariantModel.deleteMany).toHaveBeenCalled();
    mongoose.Types.ObjectId.isValid = jest.fn().mockReturnValue(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// formatVariant (internal helper — tested through controller responses)
// ═══════════════════════════════════════════════════════════════════════════════
describe('formatVariant behavior (via getOne)', () => {
  test('handles fields as string array (product_type fallback)', async () => {
    const doc = {
      _id: 'v1',
      name: 'Material',
      product_type: ['Cotton', 'Polyester'], // fields missing, falls back to product_type
      fields: undefined,
    };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.product_type).toEqual(['Cotton', 'Polyester']);
    expect(data.fields).toEqual([{ name: 'Cotton' }, { name: 'Polyester' }]);
  });

  test('handles fields with string entries', async () => {
    const doc = { _id: 'v1', name: 'Color', fields: ['Red', 'Blue'] };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.fields).toEqual([{ name: 'Red' }, { name: 'Blue' }]);
    expect(data.product_type).toEqual(['Red', 'Blue']);
  });

  test('filters out null/empty field entries', async () => {
    const doc = {
      _id: 'v1',
      name: 'Size',
      fields: [{ name: 'S' }, null, { name: '' }, { name: 'L' }],
    };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.fields).toEqual([{ name: 'S' }, { name: 'L' }]);
  });

  test('returns empty fields/product_type when no fields or product_type', async () => {
    const doc = { _id: 'v1', name: 'Color' };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.fields).toEqual([]);
    expect(data.product_type).toEqual([]);
  });

  test('converts _id to string', async () => {
    const doc = { _id: { toString: () => 'objectid-string' }, name: 'Color', fields: [] };
    mockVariantModel.findById.mockResolvedValue(doc);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'v1' } }), res);
    expect(res.json.mock.calls[0][0].data._id).toBe('objectid-string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// safeCreateActivityLog (resilience — tested via create/update/delete)
// ═══════════════════════════════════════════════════════════════════════════════
describe('safeCreateActivityLog resilience', () => {
  test('does not break create when activity log throws', async () => {
    mockVariantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockCreateActivityLog.mockRejectedValue(new Error('Log server down'));
    const req = mockReq({ body: { name: 'Color', product_type: ['Red'] } });
    const res = mockRes();
    await ctrl.create(req, res);
    // Should still return 201 — activity log failure is swallowed
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('does not break delete when activity log throws', async () => {
    mockVariantModel.findByIdAndDelete.mockResolvedValue({ _id: 'v1', name: 'Color' });
    mockCreateActivityLog.mockRejectedValue(new Error('Log error'));
    const res = mockRes();
    await ctrl.delete(mockReq({ params: { id: 'v1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Response format consistency
// ═══════════════════════════════════════════════════════════════════════════════
describe('response format', () => {
  test('success response includes both success:true and type:"success"', async () => {
    mockVariantModel.countDocuments.mockResolvedValue(0);
    mockVariantModel.find.mockReturnValue(buildFindChain([]));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.type).toBe('success');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('data');
  });

  test('error response includes success:false and type:"error"', async () => {
    mockVariantModel.findById.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'missing' } }), res);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.type).toBe('error');
    expect(body).toHaveProperty('message');
  });
});
