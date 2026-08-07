'use strict';

const { success, error, responseMiddleware } = require('../../../src/middleware/response');

describe('response middleware', () => {
  const createRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  });

  test('success sends a success envelope', () => {
    const res = createRes();

    success(res, 'Saved', { id: 1 }, 201);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Saved',
      data: { id: 1 },
    });
  });

  test('error unwraps Error objects', () => {
    const res = createRes();
    const err = new Error('Boom');
    err.statusCode = 409;
    err.data = { field: 'name' };

    error(res, err);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Boom',
      data: { field: 'name' },
    });
  });

  test('responseMiddleware attaches helpers', () => {
    const res = createRes();
    const next = jest.fn();

    responseMiddleware({}, res, next);

    expect(typeof res.success).toBe('function');
    expect(typeof res.error).toBe('function');
    expect(typeof res.safeJson).toBe('function');
    expect(typeof res.notFound).toBe('function');
    expect(next).toHaveBeenCalled();
  });

  test('safeJson routes errors and success correctly', () => {
    const res = createRes();
    const next = jest.fn();
    responseMiddleware({}, res, next);

    res.safeJson({ ok: true }, 200, 'Done');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenLastCalledWith({
      type: 'success',
      message: 'Done',
      data: { ok: true },
    });

    res.safeJson({ bad: true }, 422, 'Invalid');
    expect(res.status).toHaveBeenLastCalledWith(422);
    expect(res.json).toHaveBeenLastCalledWith({
      type: 'error',
      message: 'Invalid',
      data: { bad: true },
    });
  });
});
