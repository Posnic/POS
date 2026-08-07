'use strict';

jest.mock('../../../src/config/environment', () => ({
  isProduction: false,
  isTest: false,
}));

describe('config/auth', () => {
  const MANAGED = ['API_KEYS', 'JWT_SECRET', 'BASE_URL', 'COOKIE_DOMAIN', 'SESSION_STORE'];

  /*
   * Cleared before as well as after.
   *
   * These were only cleared afterwards, so the first test inherited whatever
   * the environment already held - and "uses defaults when env vars are absent"
   * then ran with JWT_SECRET set. It passed under a bare `jest` and failed under
   * `npm run test:local`, which exports a test secret before starting. A test
   * about absence has to create the absence itself rather than assume it.
   */
  beforeEach(() => {
    jest.resetModules();
    for (const name of MANAGED) delete process.env[name];
  });

  afterEach(() => {
    jest.resetModules();
    for (const name of MANAGED) delete process.env[name];
  });

  test('uses defaults when env vars are absent', () => {
    const auth = require('../../../src/config/auth');

    /*
     * The secret used to default to the literal 'your_jwt_secret_key_here'.
     * Harmless while nobody outside could read it; published, it is a signing
     * key printed on the internet, and any deployment that missed JWT_SECRET
     * would let a stranger mint a token for any user of any tenant. It is now
     * random per process: unguessable, and it stops working on restart, which
     * is a loud local failure instead of a quiet global one.
     */
    expect(auth.jwt.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.jwt.accessToken.expiresIn).toBe('15m');

    /* Likewise the two dev_*_key_12345 defaults: no configuration, no keys. */
    expect(auth.apiKeys).toEqual({});
    expect(auth.session.cookie.secure).toBe(false);
    expect(auth.cors.origin).toEqual(['http://localhost:3000', 'http://localhost:8080']);
  });

  test('parses API_KEYS from environment', () => {
    process.env.API_KEYS = JSON.stringify({ a: '1', b: '2' });
    const auth = require('../../../src/config/auth');

    expect(auth.apiKeys).toEqual({ a: '1', b: '2' });
  });
});
