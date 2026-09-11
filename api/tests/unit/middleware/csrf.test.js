'use strict';

const { protect, tokenFor, HEADER, RESPONSE_HEADER } = require('../../../src/middleware/csrf');

const response = () => ({
  set: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const request = (overrides = {}) => ({
  method: 'POST',
  cookies: { jwt: 'browser-cookie' },
  session: {},
  get: jest.fn((name) => (name === HEADER ? undefined : undefined)),
  ...overrides,
});

describe('CSRF middleware', () => {
  test('lets reads through and gives the browser a token for its next write', () => {
    const req = request({ method: 'GET' });
    const res = response();
    const next = jest.fn();
    protect(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(RESPONSE_HEADER, tokenFor('jwt:browser-cookie'));
  });

  test('rejects a cookie-authenticated write without the reflected token', () => {
    const req = request();
    const res = response();
    protect(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('accepts a cookie-authenticated write with its reflected token', () => {
    const token = tokenFor('jwt:browser-cookie');
    const req = request({ get: jest.fn((name) => (name === HEADER ? token : undefined)) });
    const next = jest.fn();
    protect(req, response(), next);
    expect(next).toHaveBeenCalled();
  });

  test('does not impose a browser token on an explicit bearer-token client', () => {
    const req = request({
      get: jest.fn((name) => (name === 'authorization' ? 'Bearer token' : undefined)),
    });
    const next = jest.fn();
    protect(req, response(), next);
    expect(next).toHaveBeenCalled();
  });
});
