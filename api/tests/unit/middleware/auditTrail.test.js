'use strict';

const mockLogActivity = jest.fn();

jest.mock('../../../src/utils/activityLogger', () => ({
  logActivity: mockLogActivity,
}));

const auditTrail = require('../../../src/middleware/auditTrail');

describe('auditTrail middleware', () => {
  test('skips health checks', () => {
    const next = jest.fn();
    auditTrail({ path: '/health' }, {}, next);
    expect(next).toHaveBeenCalled();
  });

  test('registers finish handler and logs api responses', async () => {
    const handlers = {};
    const res = {
      json: jest.fn((data) => data),
      locals: {},
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      statusCode: 200,
    };
    const req = {
      path: '/api/users',
      originalUrl: '/api/users',
      method: 'POST',
      user: { _id: 'u1' },
      body: { a: 1 },
      query: {},
      params: { id: 'x' },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      get: jest.fn(() => 'ua'),
    };

    auditTrail(req, res, jest.fn());
    res.json({ ok: true });
    await handlers.finish();

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        entity: 'users',
        userId: 'u1',
      })
    );
  });
});
