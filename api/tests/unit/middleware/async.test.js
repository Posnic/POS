'use strict';

const asyncHandler = require('../../../src/middleware/async');

describe('async middleware', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('passes resolved handler results through', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const next = jest.fn();
    const res = { headersSent: false, status: jest.fn(), json: jest.fn() };

    await wrapped({}, res, next);

    expect(handler).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('handles validation errors with 400 response', async () => {
    const err = new Error('invalid');
    err.name = 'ValidationError';
    err.errors = {
      name: { path: 'name', message: 'Name required' },
    };

    const handler = jest.fn().mockRejectedValue(err);
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };

    await asyncHandler(handler)({}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Validation failed',
      errors: [{ field: 'name', message: 'Name required' }],
    });
  });

  test('returns 500 for unhandled errors in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const err = new Error('boom');
    const handler = jest.fn().mockRejectedValue(err);
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };

    await asyncHandler(handler)({}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 500,
        message: 'boom',
        stack: expect.any(String),
      })
    );

    process.env.NODE_ENV = originalEnv;
  });
});
