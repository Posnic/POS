'use strict';

jest.mock('express-rate-limit', () => jest.fn((opts) => ({ type: 'rateLimit', opts })));
jest.mock('helmet', () => jest.fn(() => ({ type: 'helmet' })));
jest.mock('express-mongo-sanitize', () => jest.fn(() => ({ type: 'mongoSanitize' })), {
  virtual: true,
});
jest.mock('xss-clean', () => jest.fn(() => ({ type: 'xssClean' })), { virtual: true });
jest.mock('hpp', () => jest.fn((opts) => ({ type: 'hpp', opts })));
const security = require('../../../src/middleware/security');

describe('middleware/security', () => {
  const createRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  test('exports a configured api limiter', () => {
    expect(security.apiLimiter.type).toBe('rateLimit');
    expect(security.apiLimiter.opts.max).toBe(100);
  });

  /*
   * The celebrate branch that stood here called isCelebrate(err). celebrate has
   * never exported anything by that name - it is isCelebrateError - so the
   * import was undefined and the first line of the handler was a guaranteed
   * TypeError. This test passed only because it mocked the name into existence.
   *
   * The branch is gone: nothing in this API builds a celebrate validator, so no
   * celebrate error could reach a handler, and keeping it meant keeping a
   * dependency that carried two high advisories through a pinned lodash.
   */
  test('a validation error falls through to the next handler', () => {
    const err = { details: [{ details: [{ path: ['field'], message: 'bad' }] }] };
    const res = createRes();
    const next = jest.fn();

    security.securityErrorHandler(err, {}, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  test('validateRequest returns 400 for invalid schema', () => {
    const middleware = security.validateRequest({
      validate: jest.fn().mockReturnValue({
        error: { details: [{ path: ['name'], message: '"name" is required' }] },
      }),
    });
    const res = createRes();
    const next = jest.fn();

    middleware({ body: { name: '' } }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Validation failed',
      errors: [{ field: 'name', message: 'name is required' }],
    });
  });
});
