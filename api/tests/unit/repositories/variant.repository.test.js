'use strict';

/**
 * Unit tests for src/repositories/variants.repository.js
 * SINGLETON export - module.exports = new VariantsRepository()
 * Thin delegation layer over the Variant mongoose model.
 */

jest.mock('../../../src/models/variant.model', () => {
  const MockVariant = jest.fn((data) => ({
    ...data,
    save: jest.fn().mockResolvedValue({ ...data, _id: 'new-id' }),
  }));

  MockVariant.countDocuments = jest.fn();
  MockVariant.find = jest.fn();
  MockVariant.findById = jest.fn();
  MockVariant.findOne = jest.fn();
  MockVariant.deleteMany = jest.fn();
  MockVariant.findOneAndDelete = jest.fn();
  MockVariant.__mockModel = MockVariant;
  return MockVariant;
});

jest.mock('mongoose', () => ({
  Types: {
    ObjectId: jest.fn((id) => ({ toString: () => String(id) })),
  },
}));

const mongoose = require('mongoose');
mongoose.Types.ObjectId.isValid = jest.fn(() => true);

const Variant = require('../../../src/models/variant.model');
const repository = require('../../../src/repositories/variant.repository');

const mockModel = Variant.__mockModel;

const FAKE_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_BRANCH_ID = '64f8f2f4c2b9c0a1e4000002';

const mockVariant = {
  _id: FAKE_ID,
  name: 'Size',
  fields: [{ name: 'Small' }],
  description: 'Variant',
  branch_id: FAKE_BRANCH_ID,
  updated_date: new Date('2024-01-01'),
};

const buildChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

describe('VariantsRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockModel.countDocuments.mockResolvedValue(1);
    mockModel.find.mockReturnValue(buildChain([mockVariant]));
    mockModel.findById.mockReturnValue(buildChain(mockVariant));
    mockModel.findOne.mockReturnValue(buildChain(mockVariant));
    mockModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mockModel.findOneAndDelete.mockResolvedValue(mockVariant);
  });

  describe('findAll', () => {
    test('returns paginated variants', async () => {
      const result = await repository.findAll(
        { branch_id: FAKE_BRANCH_ID },
        { page: 2, limit: 10, sort: 'name', order: 'asc' }
      );

      expect(mockModel.countDocuments).toHaveBeenCalledWith({ branch_id: FAKE_BRANCH_ID });
      expect(mockModel.find).toHaveBeenCalledWith({ branch_id: FAKE_BRANCH_ID });
      expect(result).toEqual({
        total: 1,
        variants: [mockVariant],
        page: 2,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('findById', () => {
    test('returns null for invalid id', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValueOnce(false);
      await expect(repository.findById('bad-id')).resolves.toBeNull();
    });

    test('returns variant by id', async () => {
      const result = await repository.findById(FAKE_ID);
      expect(mockModel.findById).toHaveBeenCalledWith(FAKE_ID);
      expect(result).toEqual(mockVariant);
    });
  });

  describe('findOne', () => {
    test('delegates to model.findOne', async () => {
      const result = await repository.findOne({ name: 'Size' });
      expect(mockModel.findOne).toHaveBeenCalledWith({ name: 'Size' });
      expect(result).toEqual(mockVariant);
    });
  });

  describe('create', () => {
    test('creates a variant document', async () => {
      const result = await repository.create({ name: 'Color' });
      expect(result).toEqual({ name: 'Color', _id: 'new-id' });
      expect(Variant).toHaveBeenCalledWith({ name: 'Color' });
    });
  });

  describe('update', () => {
    test('updates variant when id is valid', async () => {
      const updatedDate = new Date();
      mockModel.findOne.mockReturnValueOnce({
        save: jest
          .fn()
          .mockResolvedValue({ ...mockVariant, name: 'Updated', updated_date: updatedDate }),
      });

      const result = await repository.update(FAKE_ID, { name: 'Updated' }, FAKE_BRANCH_ID);

      expect(mockModel.findOne).toHaveBeenCalledWith({
        _id: FAKE_ID,
        branch_id: expect.any(Object),
      });
      expect(result.name).toBe('Updated');
    });

    test('returns null for invalid id', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValueOnce(false);
      await expect(repository.update('bad-id', {})).resolves.toBeNull();
    });
  });

  describe('delete', () => {
    test('deletes variant by id and branch', async () => {
      const result = await repository.delete(FAKE_ID, FAKE_BRANCH_ID);
      expect(mockModel.findOneAndDelete).toHaveBeenCalled();
      expect(result).toEqual(mockVariant);
    });
  });

  describe('deleteMany', () => {
    test('deletes many variants', async () => {
      const result = await repository.deleteMany(
        [FAKE_ID, 'bad-id', FAKE_BRANCH_ID],
        FAKE_BRANCH_ID
      );
      expect(mockModel.deleteMany).toHaveBeenCalled();
      expect(result).toEqual({ deletedCount: 2 });
    });

    test('returns zero deleted when no valid ids', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValue(false);
      const result = await repository.deleteMany(['bad-id']);
      expect(result).toEqual({ deletedCount: 0 });
    });
  });

  describe('findForAutocomplete', () => {
    test('builds a filtered query', async () => {
      await repository.findForAutocomplete('siz', FAKE_BRANCH_ID, 5);
      const chain = mockModel.find.mock.results[0].value;
      expect(chain.select).toHaveBeenCalledWith('name fields');
      expect(chain.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('findByIdsForExport', () => {
    test('returns empty array for no valid ids', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValue(false);
      await expect(repository.findByIdsForExport(['bad-id'])).resolves.toEqual([]);
    });
  });

  describe('findByField', () => {
    test('delegates to nested field lookup', async () => {
      await repository.findByField('size');
      expect(mockModel.find).toHaveBeenCalledWith({ 'fields.name': 'size' });
    });
  });

  describe('search', () => {
    test('searches by name and description', async () => {
      await repository.search('size', 3);
      expect(mockModel.find).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: 'size', $options: 'i' } },
          { description: { $regex: 'size', $options: 'i' } },
        ],
      });
    });
  });

  describe('count', () => {
    test('returns countDocuments result', async () => {
      const result = await repository.count({ active: true });
      expect(result).toBe(1);
      expect(mockModel.countDocuments).toHaveBeenCalledWith({ active: true });
    });
  });

  describe('existsByName', () => {
    test('returns true when a variant exists', async () => {
      mockModel.findOne.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(mockVariant),
      });

      const result = await repository.existsByName('Size', FAKE_ID, FAKE_BRANCH_ID);
      expect(result).toBe(true);
    });
  });
});
