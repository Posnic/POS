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

/*
 * A FILTER VALUE IS A VALUE, NEVER A QUERY OF ITS OWN.
 *
 * GET /api/activity-logs takes userId, action, entity and entityId straight
 * off req.query and they went into the filter exactly as they arrived:
 * `query.user = userId`. In MongoDB a filter is an ordinary object and a key
 * beginning with `$` inside one is an operator, so an object there stops being
 * a value: `{ $ne: null }` turns "this user's actions" into "everybody
 * else's". `branch` and `license` still bounded it to the shop, so it is a
 * within-shop weakening rather than a tenant break - but it is real, and it is
 * the exact shape the 251 open js/sql-injection alerts are pointing at.
 *
 * It is not currently reachable: app.js strips `$` keys from query and body.
 * That is precisely why it is worth closing here too. A filter that is only
 * safe because something upstream is working is one that breaks the day that
 * thing moves - and this one moved already. The query half of that very
 * sanitiser had not run since the Express 5 upgrade (POS #811).
 */
describe('a filter value cannot become an operator', () => {
  const build = async (options) => {
    const ActivityLog = require('../../../src/models/activity-log.model');
    const spy = jest.spyOn(ActivityLog, 'paginate').mockResolvedValue({ docs: [] });
    try {
      await require('../../../src/utils/activityLogger').getActivityLogs(options);
      return spy.mock.calls[0][0];
    } finally {
      spy.mockRestore();
    }
  };

  test('AN OPERATOR OBJECT ARRIVES AS TEXT, so it filters nothing', async () => {
    const query = await build({ userId: { $ne: null }, branch: 'b1', license: 'l1' });
    expect(typeof query.user).toBe('string');
    expect(query.user).not.toEqual({ $ne: null });
    /* And the shop bounds are untouched, because they never came from a
       caller in the first place. */
    expect(query.branch).toBe('b1');
    expect(query.license).toBe('l1');
  });

  test('and so does one hiding in any of the other three', async () => {
    const query = await build({
      action: { $gt: '' },
      entity: { $ne: 'nothing' },
      entityId: { $exists: true },
    });
    for (const field of ['action', 'entity', 'entityId']) {
      expect(typeof query[field]).toBe('string');
    }
  });

  test('AN ORDINARY FILTER IS COMPLETELY UNCHANGED, which is the point', async () => {
    /*
     * A string was always safe: Mongoose casts it to the schema's type and
     * rejects a malformed one. So every real caller keeps the behaviour it has
     * today, including the error it already gets for a bad id. Validating
     * instead - turning a bad id into null - would answer "no rows" where a
     * shop is currently told its filter is wrong, which is a behaviour change
     * dressed as a security fix.
     */
    const query = await build({
      userId: '6aa5509215e3686c543e5cc3',
      action: 'login',
      entity: 'auth',
      entityId: 'e1',
    });
    expect(query).toMatchObject({
      user: '6aa5509215e3686c543e5cc3',
      action: 'login',
      entity: 'auth',
      entityId: 'e1',
    });
  });

  test('and a date range is still the SERVER writing its own operators', async () => {
    /* The distinction the whole change rests on: operators the server writes
       are not the ones a caller sends. */
    const query = await build({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(query.createdAt.$gte).toBeInstanceOf(Date);
    expect(query.createdAt.$lte).toBeInstanceOf(Date);
  });
});

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
