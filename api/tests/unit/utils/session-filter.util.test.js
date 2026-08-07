'use strict';

jest.mock('mongodb', () => ({
  MongoClient: jest.fn(),
}));

const sessionFilterUtil = require('../../../src/utils/session-filter.util');

describe('session-filter util', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MONGODB_URI = 'mongodb://localhost:27017/TestDb';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  test('hasSessionFilterPermission returns true only when session_filter is true', () => {
    expect(
      sessionFilterUtil.hasSessionFilterPermission({ access: { sales: { session_filter: true } } })
    ).toBe(true);
    expect(
      sessionFilterUtil.hasSessionFilterPermission({ access: { sales: { session_filter: false } } })
    ).toBe(false);
    expect(sessionFilterUtil.hasSessionFilterPermission({})).toBe(false);
  });

  test('getDatabase returns null when mongoClient is missing', () => {
    const req = { app: { locals: {} } };
    expect(sessionFilterUtil.getDatabase(req)).toBeNull();
  });

  test('getDatabase uses database name from MONGODB_URI', () => {
    const db = { id: 'db' };
    const mongoClient = { db: jest.fn().mockReturnValue(db) };
    const req = { app: { locals: { mongoClient } } };

    expect(sessionFilterUtil.getDatabase(req)).toBe(db);
    expect(mongoClient.db).toHaveBeenCalledWith('TestDb');
  });

  test('getUserSessionData returns null without user id', async () => {
    await expect(
      sessionFilterUtil.getUserSessionData({ user: {}, app: { locals: {} } })
    ).resolves.toBeNull();
  });

  test('getUserSessionData returns session when found', async () => {
    const session = { _id: 'session-1', user_id: 'user-1', login_time: '2025-01-01T10:00:00.000Z' };
    const findOne = jest.fn().mockResolvedValue(session);
    const db = { collection: jest.fn().mockReturnValue({ findOne }) };
    const req = {
      user: { _id: 'user-1' },
      app: { locals: { mongoClient: { db: jest.fn().mockReturnValue(db) } } },
    };

    await expect(sessionFilterUtil.getUserSessionData(req)).resolves.toEqual(session);
    expect(db.collection).toHaveBeenCalledWith('user_sessions');
    expect(findOne).toHaveBeenCalledWith({
      user_id: 'user-1',
      logout_time: null,
      is_active: true,
    });
  });

  test('applySessionFilter returns original range when permission is missing', async () => {
    const originalDateRange = { start_date: new Date('2025-01-01T00:00:00.000Z') };
    const req = { user: { access: { sales: { session_filter: false } } } };

    await expect(sessionFilterUtil.applySessionFilter(req, originalDateRange)).resolves.toBe(
      originalDateRange
    );
  });

  test('applySessionFilter uses later of original start and session login time', async () => {
    jest.spyOn(sessionFilterUtil, 'getUserSessionData').mockResolvedValue({
      login_time: '2025-01-10T10:00:00.000Z',
    });

    const req = { user: { _id: 'user-1', access: { sales: { session_filter: true } } } };
    const originalDateRange = {
      start_date: new Date('2025-01-01T00:00:00.000Z'),
      end_date: new Date('2025-01-31T00:00:00.000Z'),
    };

    const result = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

    expect(result.session_applied).toBe(true);
    expect(result.start_date.toISOString()).toBe('2025-01-10T10:00:00.000Z');
    expect(result.end_date).toEqual(originalDateRange.end_date);
  });

  test('applySessionFilter uses session window when no original range is provided', async () => {
    jest.spyOn(sessionFilterUtil, 'getUserSessionData').mockResolvedValue({
      login_time: '2025-02-01T09:30:00.000Z',
    });
    const req = { user: { _id: 'user-1', access: { sales: { session_filter: true } } } };
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-02-01T12:00:00.000Z'));

    const result = await sessionFilterUtil.applySessionFilter(req);

    expect(result.session_applied).toBe(true);
    expect(result.start_date.toISOString()).toBe('2025-02-01T09:30:00.000Z');
    expect(result.end_date.toISOString()).toBe('2025-02-01T12:00:00.000Z');
    jest.useRealTimers();
  });

  test('applySessionFilterToPipeline updates existing $match stage', async () => {
    jest.spyOn(sessionFilterUtil, 'getUserSessionData').mockResolvedValue({
      login_time: '2025-03-01T00:00:00.000Z',
    });

    const pipeline = [{ $match: { date: { $gte: new Date('2025-02-01T00:00:00.000Z') } } }];
    const req = { user: { access: { sales: { session_filter: true } } } };

    const result = await sessionFilterUtil.applySessionFilterToPipeline(req, pipeline, 'date');

    expect(result[0].$match.date.$gte.toISOString()).toBe('2025-03-01T00:00:00.000Z');
  });

  test('applySessionFilterToSalesFilters adds date filter when missing', async () => {
    jest.spyOn(sessionFilterUtil, 'getUserSessionData').mockResolvedValue({
      login_time: '2025-04-01T00:00:00.000Z',
    });

    const filters = {};
    const req = { user: { access: { sales: { session_filter: true } } } };

    const result = await sessionFilterUtil.applySessionFilterToSalesFilters(req, filters);

    expect(result.date.$gte.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  test('getSessionFilterInfo reports disabled when permission missing', async () => {
    const result = await sessionFilterUtil.getSessionFilterInfo({
      user: { access: { sales: { session_filter: false } } },
    });
    expect(result).toEqual({
      session_filter_enabled: false,
      reason: 'User does not have session filter permission',
    });
  });
});
