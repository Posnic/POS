'use strict';
/*
 * The CSRF token is bound to a login the browser can still use.
 *
 * A shop could not sign in: "Your session security token is missing or
 * expired. Refresh and try again", on every attempt, until the site's cookies
 * were cleared. The cookie outlives the token inside it (seven days against
 * one), the middleware bound a token to the dead cookie, every read on the
 * login page answered 401 so the page never learned that token, and the login
 * write was refused for not carrying it. These pin the way out: a cookie that
 * does not verify is no credential, and the token secret survives a restart.
 */
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'csrf-test-login-secret';
delete process.env.CSRF_SECRET;

const {
  protect,
  tokenFor,
  liveCookie,
  credentialFor,
  secret,
  HEADER,
  RESPONSE_HEADER,
} = require('../../../src/middleware/csrf');

const LIVE = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const EXPIRED = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: -10 });
const FOREIGN = jwt.sign({ id: 'u1' }, 'some-other-secret', { expiresIn: '1h' });

const response = () => ({
  set: jest.fn(),
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const request = (overrides = {}) => ({
  method: 'POST',
  cookies: { jwt: LIVE },
  session: {},
  get: jest.fn(() => undefined),
  ...overrides,
});

describe('CSRF middleware', () => {
  test('lets reads through and gives the browser a token for its next write', () => {
    const req = request({ method: 'GET' });
    const res = response();
    const next = jest.fn();
    protect(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(RESPONSE_HEADER, tokenFor(`jwt:${LIVE}`));
  });

  test('rejects a cookie-authenticated write without the reflected token', () => {
    const req = request();
    const res = response();
    protect(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toMatch(/missing or expired/);
  });

  test('accepts a cookie-authenticated write with its reflected token', () => {
    const expected = tokenFor(`jwt:${LIVE}`);
    const req = request({ get: jest.fn((name) => (name === HEADER ? expected : undefined)) });
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

  test('an expired cookie is not a credential: the login write goes through, and no token is minted for it', () => {
    /* The bug as reported: day two of a remembered login. */
    expect(liveCookie(EXPIRED)).toBe(false);
    expect(credentialFor(request({ cookies: { jwt: EXPIRED } }))).toBeNull();
    const req = request({ cookies: { jwt: EXPIRED } });
    const res = response();
    const next = jest.fn();
    protect(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });

  test('a cookie signed by somebody else, or by nobody, is not a credential either', () => {
    expect(liveCookie(FOREIGN)).toBe(false);
    expect(liveCookie('browser-cookie')).toBe(false);
    expect(credentialFor(request({ cookies: { jwt: 'browser-cookie' } }))).toBeNull();
  });

  test('a live cookie still is, and a session-only login binds to its session', () => {
    expect(liveCookie(LIVE)).toBe(true);
    expect(credentialFor(request())).toBe(`jwt:${LIVE}`);
    expect(
      credentialFor(request({ cookies: {}, session: { userId: 'u1' }, sessionID: 'sess-9' }))
    ).toBe('session:sess-9');
  });

  test('the token secret is derived from the login secret, so it is the same after a restart', () => {
    /* Random per process, as it was, meant every deploy silently invalidated
       the token every open till was holding. */
    const once = secret();
    expect(once).toBe(secret());
    expect(once).not.toBe(process.env.JWT_SECRET);
    expect(once).toHaveLength(64);
    process.env.CSRF_SECRET = 'set-by-hand';
    expect(secret()).toBe('set-by-hand');
    delete process.env.CSRF_SECRET;
  });
});
