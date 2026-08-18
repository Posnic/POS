'use strict';

const mockFindById = jest.fn();
const mockFindOne = jest.fn();

jest.mock('../../../src/models/user.model', () => ({
  findById: mockFindById,
  findOne: mockFindOne,
}));

jest.mock('mongoose', () => ({
  Types: {
    ObjectId: {
      isValid: jest.fn(),
    },
  },
}));

const mongoose = require('mongoose');
const { findUserByIdentifier } = require('../../../src/utils/findUserByIdentifier');

describe('findUserByIdentifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null for empty values', async () => {
    await expect(findUserByIdentifier('')).resolves.toBeNull();
    await expect(findUserByIdentifier(null)).resolves.toBeNull();
  });

  test('finds by object id first', async () => {
    mongoose.Types.ObjectId.isValid.mockReturnValue(true);
    const select = jest.fn().mockResolvedValue({ _id: 'u1' });
    mockFindById.mockReturnValue({ select });

    await expect(findUserByIdentifier('507f1f77bcf86cd799439011')).resolves.toEqual({ _id: 'u1' });
    expect(mockFindById).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(select).toHaveBeenCalledWith('+license +branch_access');
  });

  test('falls back to findOne search when id lookup misses', async () => {
    mongoose.Types.ObjectId.isValid.mockReturnValue(false);
    const select = jest.fn().mockResolvedValue({ username: 'user1' });
    mockFindOne.mockReturnValue({ select });

    await expect(findUserByIdentifier('User1')).resolves.toEqual({ username: 'user1' });
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([{ username: 'user1' }, { username: 'User1' }]),
      })
    );
  });
});
