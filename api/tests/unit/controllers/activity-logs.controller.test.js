/**
 * Unit tests for ActivityLogsController
 * File: src/controllers/activity-logs.controller.js
 *
 * Methods covered:
 *   getActivityLogs, getActivityLog, createActivityLog,
 *   updateActivityLog, delete
 *
 * Mocked dependencies:
 *   src/utils/activityLogger  (activityLogger object)
 *   src/utils/catchAsync       (real implementation — wraps fn with try/catch)
 *   src/utils/appError         (real AppError class)
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/utils/activityLogger', () => ({
  getActivityLogs: jest.fn(),
  getActivityLog: jest.fn(),
  logActivity: jest.fn(),
  updateActivityLog: jest.fn(),
  deleteActivityLog: jest.fn(),
  createActivityLog: jest.fn(),
}));

const activityLogger = require('../../../src/utils/activityLogger');
const controller = require('../../../src/controllers/activity-logs.controller');
const { AppError } = require('../../../src/utils/appError');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  user: {
    _id: VALID_ID,
    username: 'admin',
    usertype: 'admin',
  },
  ip: '127.0.0.1',
  get: jest.fn((header) => {
    if (header === 'user-agent') return 'jest-test-agent/1.0';
    return undefined;
  }),
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = () => jest.fn();

// ─── Shared paginated result factory ─────────────────────────────────────────

const paginatedResult = (docs = [], overrides = {}) => ({
  docs,
  total: docs.length,
  limit: 10,
  page: 1,
  pages: 1,
  ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// getActivityLogs
// =============================================================================

describe('getActivityLogs', () => {
  test('returns 200 with paginated logs on success', async () => {
    const logDoc = { _id: VALID_ID, action: 'CREATE', entity: 'Sale' };
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([logDoc]));

    const req = mockReq({ query: { page: '1', limit: '10' } });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLogs(req, res, next);

    expect(activityLogger.getActivityLogs).toHaveBeenCalledTimes(1);
    expect(activityLogger.getActivityLogs).toHaveBeenCalledWith({
      userId: undefined,
      action: undefined,
      entity: undefined,
      entityId: undefined,
      startDate: undefined,
      endDate: undefined,
      page: 1,
      limit: 10,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        results: 1,
        data: { logs: [logDoc] },
        total: 1,
        limit: 10,
        page: 1,
        pages: 1,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 200 with empty list when no logs exist', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLogs(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        results: 0,
        data: { logs: [] },
        // total: logs.total || logs.length → 0 || undefined = undefined (falsy-0 fallthrough)
        total: undefined,
      })
    );
  });

  test('defaults page to 1 and limit to 10 when query params are absent', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: {} });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.page).toBe(1);
    expect(calledWith.limit).toBe(10);
  });

  test('parses page and limit from query string to integers', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { page: '3', limit: '25' } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.page).toBe(3);
    expect(calledWith.limit).toBe(25);
  });

  test('passes userId filter to activityLogger', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { userId: VALID_ID } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.userId).toBe(VALID_ID);
  });

  test('passes action filter to activityLogger', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { action: 'DELETE' } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.action).toBe('DELETE');
  });

  test('passes entity filter to activityLogger', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { entity: 'Product' } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.entity).toBe('Product');
  });

  test('passes entityId filter to activityLogger', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { entityId: VALID_ID } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.entityId).toBe(VALID_ID);
  });

  test('passes startDate and endDate filters to activityLogger', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({
      query: { startDate: '2025-01-01', endDate: '2025-12-31' },
    });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.startDate).toBe('2025-01-01');
    expect(calledWith.endDate).toBe('2025-12-31');
  });

  test('handles paginated result without docs field (plain array fallback)', async () => {
    const logsArray = [{ _id: VALID_ID, action: 'UPDATE' }];
    activityLogger.getActivityLogs.mockResolvedValue(logsArray);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        results: 0,
        data: { logs: logsArray },
        total: 1,
      })
    );
  });

  test('uses a very large limit value without errors', async () => {
    activityLogger.getActivityLogs.mockResolvedValue(paginatedResult([]));

    const req = mockReq({ query: { limit: '10000' } });
    const res = mockRes();

    await controller.getActivityLogs(req, res, mockNext());

    const calledWith = activityLogger.getActivityLogs.mock.calls[0][0];
    expect(calledWith.limit).toBe(10000);
  });

  test('calls next(error) when activityLogger.getActivityLogs throws', async () => {
    const dbError = new Error('Database connection failed');
    activityLogger.getActivityLogs.mockRejectedValue(dbError);

    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLogs(req, res, next);
    await Promise.resolve(); // flush catchAsync .catch microtask

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next(error) on unexpected exception', async () => {
    activityLogger.getActivityLogs.mockImplementation(() => {
      throw new TypeError('Unexpected type error');
    });

    const req = mockReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLogs(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(TypeError));
  });
});

// =============================================================================
// getActivityLog
// =============================================================================

describe('getActivityLog', () => {
  test('returns 200 with the log when found', async () => {
    const logDoc = { _id: VALID_ID, action: 'LOGIN', entity: 'User' };
    activityLogger.getActivityLog.mockResolvedValue(logDoc);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLog(req, res, next);

    expect(activityLogger.getActivityLog).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { log: logDoc },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (null returned)', async () => {
    activityLogger.getActivityLog.mockResolvedValue(null);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLog(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No activity log found with that ID');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (undefined returned)', async () => {
    activityLogger.getActivityLog.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLog(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('calls next(error) when activityLogger.getActivityLog throws', async () => {
    const dbError = new Error('DB read failure');
    activityLogger.getActivityLog.mockRejectedValue(dbError);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.getActivityLog(req, res, next);
    await Promise.resolve(); // flush catchAsync .catch microtask

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes the correct id from req.params.id to activityLogger', async () => {
    const differentId = '64f8f2f4c2b9c0a1e4b99999';
    activityLogger.getActivityLog.mockResolvedValue({ _id: differentId });

    const req = mockReq({ params: { id: differentId } });
    const res = mockRes();

    await controller.getActivityLog(req, res, mockNext());

    expect(activityLogger.getActivityLog).toHaveBeenCalledWith(differentId);
  });

  test('log with missing optional metadata (no ip, no userAgent) is still returned', async () => {
    const logDoc = { _id: VALID_ID, action: 'VIEW', entity: 'Report' };
    activityLogger.getActivityLog.mockResolvedValue(logDoc);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();

    await controller.getActivityLog(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });
});

// =============================================================================
// createActivityLog
// =============================================================================

describe('createActivityLog', () => {
  const validBody = {
    userId: VALID_ID,
    action: 'CREATE',
    entity: 'Product',
    entityId: VALID_ID,
    details: { name: 'Test Product' },
  };

  test('returns 201 with created log on success', async () => {
    const createdLog = { _id: VALID_ID, ...validBody };
    activityLogger.logActivity.mockResolvedValue(createdLog);

    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    await controller.createActivityLog(req, res, next);

    expect(activityLogger.logActivity).toHaveBeenCalledTimes(1);
    expect(activityLogger.logActivity).toHaveBeenCalledWith({
      userId: VALID_ID,
      action: 'CREATE',
      entity: 'Product',
      entityId: VALID_ID,
      details: { name: 'Test Product' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest-test-agent/1.0',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { log: createdLog },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('captures req.ip as ipAddress', async () => {
    activityLogger.logActivity.mockResolvedValue({ _id: VALID_ID });

    const req = mockReq({ body: validBody, ip: '192.168.1.10' });
    const res = mockRes();

    await controller.createActivityLog(req, res, mockNext());

    const calledWith = activityLogger.logActivity.mock.calls[0][0];
    expect(calledWith.ipAddress).toBe('192.168.1.10');
  });

  test('captures user-agent header via req.get()', async () => {
    activityLogger.logActivity.mockResolvedValue({ _id: VALID_ID });

    const customGet = jest.fn((header) => {
      if (header === 'user-agent') return 'Mozilla/5.0';
      return undefined;
    });
    const req = mockReq({ body: validBody, get: customGet });
    const res = mockRes();

    await controller.createActivityLog(req, res, mockNext());

    const calledWith = activityLogger.logActivity.mock.calls[0][0];
    expect(calledWith.userAgent).toBe('Mozilla/5.0');
    expect(customGet).toHaveBeenCalledWith('user-agent');
  });

  test('creates log with empty body fields (all undefined)', async () => {
    activityLogger.logActivity.mockResolvedValue({ _id: VALID_ID });

    const req = mockReq({ body: {} });
    const res = mockRes();
    const next = mockNext();

    await controller.createActivityLog(req, res, next);

    expect(activityLogger.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: undefined,
        action: undefined,
        entity: undefined,
        entityId: undefined,
        details: undefined,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('calls next(error) when activityLogger.logActivity throws', async () => {
    const dbError = new Error('Insert failed');
    activityLogger.logActivity.mockRejectedValue(dbError);

    const req = mockReq({ body: validBody });
    const res = mockRes();
    const next = mockNext();

    await controller.createActivityLog(req, res, next);
    await Promise.resolve(); // flush catchAsync .catch microtask

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('handles log with no optional entityId or details', async () => {
    const minimalBody = { userId: VALID_ID, action: 'LOGIN', entity: 'User' };
    activityLogger.logActivity.mockResolvedValue({ _id: VALID_ID, ...minimalBody });

    const req = mockReq({ body: minimalBody });
    const res = mockRes();

    await controller.createActivityLog(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });
});

// =============================================================================
// updateActivityLog
// =============================================================================

describe('updateActivityLog', () => {
  const updateBody = { action: 'UPDATE', entity: 'Category' };

  test('returns 200 with updated log on success', async () => {
    const updatedLog = { _id: VALID_ID, ...updateBody };
    activityLogger.updateActivityLog.mockResolvedValue(updatedLog);

    const req = mockReq({ params: { id: VALID_ID }, body: updateBody });
    const res = mockRes();
    const next = mockNext();

    await controller.updateActivityLog(req, res, next);

    expect(activityLogger.updateActivityLog).toHaveBeenCalledWith(VALID_ID, updateBody);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { log: updatedLog },
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (null returned)', async () => {
    activityLogger.updateActivityLog.mockResolvedValue(null);

    const req = mockReq({ params: { id: VALID_ID }, body: updateBody });
    const res = mockRes();
    const next = mockNext();

    await controller.updateActivityLog(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No activity log found with that ID');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (undefined returned)', async () => {
    activityLogger.updateActivityLog.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: VALID_ID }, body: {} });
    const res = mockRes();
    const next = mockNext();

    await controller.updateActivityLog(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('passes correct id and body to activityLogger.updateActivityLog', async () => {
    const body = { status: 'failed', entity: 'Invoice' };
    activityLogger.updateActivityLog.mockResolvedValue({ _id: VALID_ID, ...body });

    const req = mockReq({ params: { id: VALID_ID }, body });
    const res = mockRes();

    await controller.updateActivityLog(req, res, mockNext());

    expect(activityLogger.updateActivityLog).toHaveBeenCalledWith(VALID_ID, body);
  });

  test('calls next(error) when activityLogger.updateActivityLog throws', async () => {
    const dbError = new Error('Update failed');
    activityLogger.updateActivityLog.mockRejectedValue(dbError);

    const req = mockReq({ params: { id: VALID_ID }, body: updateBody });
    const res = mockRes();
    const next = mockNext();

    await controller.updateActivityLog(req, res, next);
    await Promise.resolve(); // flush catchAsync .catch microtask

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('handles empty update body without throwing', async () => {
    const log = { _id: VALID_ID };
    activityLogger.updateActivityLog.mockResolvedValue(log);

    const req = mockReq({ params: { id: VALID_ID }, body: {} });
    const res = mockRes();

    await controller.updateActivityLog(req, res, mockNext());

    expect(activityLogger.updateActivityLog).toHaveBeenCalledWith(VALID_ID, {});
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =============================================================================
// delete
// =============================================================================

describe('delete', () => {
  test('returns 204 with null data when log is deleted', async () => {
    const deletedLog = { _id: VALID_ID, action: 'CREATE' };
    activityLogger.deleteActivityLog.mockResolvedValue(deletedLog);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.delete(req, res, next);

    expect(activityLogger.deleteActivityLog).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: null,
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (null returned)', async () => {
    activityLogger.deleteActivityLog.mockResolvedValue(null);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.delete(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No activity log found with that ID');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next(AppError 404) when log is not found (undefined returned)', async () => {
    activityLogger.deleteActivityLog.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.delete(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('passes the correct id from req.params.id to activityLogger', async () => {
    const otherId = '64f8f2f4c2b9c0a1e4baaaaa';
    activityLogger.deleteActivityLog.mockResolvedValue({ _id: otherId });

    const req = mockReq({ params: { id: otherId } });
    const res = mockRes();

    await controller.delete(req, res, mockNext());

    expect(activityLogger.deleteActivityLog).toHaveBeenCalledWith(otherId);
  });

  test('calls next(error) when activityLogger.deleteActivityLog throws', async () => {
    const dbError = new Error('Delete operation failed');
    activityLogger.deleteActivityLog.mockRejectedValue(dbError);

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.delete(req, res, next);
    await Promise.resolve(); // flush catchAsync .catch microtask

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next(error) on unexpected exception from activityLogger', async () => {
    activityLogger.deleteActivityLog.mockImplementation(() => {
      throw new ReferenceError('Unexpected reference error');
    });

    const req = mockReq({ params: { id: VALID_ID } });
    const res = mockRes();
    const next = mockNext();

    await controller.delete(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ReferenceError));
  });
});
