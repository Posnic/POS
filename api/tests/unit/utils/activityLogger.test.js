'use strict';

const mockLogActivity = jest.fn();
const mockPaginate = jest.fn();
const mockFindById = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockFindByIdAndDelete = jest.fn();

jest.mock('../../../src/models/activity-log.model', () => ({
  logActivity: mockLogActivity,
  paginate: mockPaginate,
  findById: mockFindById,
  findByIdAndUpdate: mockFindByIdAndUpdate,
  findByIdAndDelete: mockFindByIdAndDelete,
}));

const activityLogger = require('../../../src/utils/activityLogger');

describe('activityLogger utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logActivity forwards payload to model', async () => {
    mockLogActivity.mockResolvedValue({ ok: true });

    await expect(activityLogger.logActivity({ action: 'CREATE' })).resolves.toEqual({ ok: true });
    expect(mockLogActivity).toHaveBeenCalledWith({ action: 'CREATE' });
  });

  test('createActivityLog converts user to userId and swallows errors', async () => {
    mockLogActivity.mockRejectedValue(new Error('db down'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      activityLogger.createActivityLog({ user: 'u1', action: 'UPDATE' })
    ).resolves.toBeUndefined();

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'UPDATE',
      })
    );
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('getActivityLogs builds filters and options', async () => {
    mockPaginate.mockResolvedValue({ docs: [] });

    await activityLogger.getActivityLogs({
      userId: 'u1',
      action: 'LOGIN',
      entity: 'User',
      entityId: 'e1',
      startDate: '2025-01-01',
      endDate: '2025-01-02',
      page: '2',
      limit: '5',
    });

    expect(mockPaginate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'u1',
        action: 'LOGIN',
        entity: 'User',
        entityId: 'e1',
        createdAt: expect.objectContaining({
          $gte: expect.any(Date),
          $lte: expect.any(Date),
        }),
      }),
      expect.objectContaining({
        page: 2,
        limit: 5,
        sort: { createdAt: -1 },
      })
    );
  });
});
