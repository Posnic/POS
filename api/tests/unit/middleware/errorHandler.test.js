'use strict';

/*
 * celebrate was mocked here so the production error handler could be loaded at
 * all. The handler no longer imports it: request validation in this API is
 * express-validator's, nothing builds a celebrate validator, so the branch that
 * caught celebrate errors could never run - and it kept alive a dependency
 * carrying two high advisories through a lodash it pins.
 */
const errorHandler = require('../../../src/middleware/errorHandler');

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('notFoundHandler returns api json for api path', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler.notFoundHandler({ originalUrl: '/api/test' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('errorHandler works in development', () => {
    process.env.NODE_ENV = 'development';
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler.errorHandler(new Error('boom'), { originalUrl: '/api/test' }, res, jest.fn());
    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });
});
