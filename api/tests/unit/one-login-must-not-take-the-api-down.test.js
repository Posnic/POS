'use strict';

/*
 * ONE LOGIN MUST NOT TAKE THE API DOWN.
 *
 * Found while setting a shop up with `npm run dev`, which is the path the
 * README gives a contributor. The first login returned a 200, and then:
 *
 *   UNHANDLED REJECTION! Shutting down...
 *   Error "expiresIn" should be a number of seconds or string representing
 *   a timespan
 *
 * The whole API exited. Not a failed login, not a degraded one: the process.
 *
 * WHY. `signToken` read `process.env.JWT_EXPIRES_IN` directly, with no
 * fallback. jsonwebtoken THROWS on an undefined `expiresIn` rather than
 * defaulting, the throw reached the unhandled-rejection handler, and that
 * handler calls process.exit. dev-server.js generates the four secrets the API
 * refuses to start without - JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY,
 * ENCRYPTION_IV - and these two are not among them, so every environment it
 * produces was one login away from dying.
 *
 * The cookie lines next to it failed more quietly and just as wrongly:
 * `undefined * 24 * 60 * 60 * 1000` is NaN, so the expiry was an Invalid Date.
 *
 * config.js has carried '90d' and 90 as defaults for both since it was
 * written. Nothing was reading them. It does now.
 */

const jwt = require('jsonwebtoken');

/**
 * The module, then an environment with nothing set.
 *
 * THE ORDER MATTERS, and the first draft of this file had it wrong and passed
 * against the broken code because of it. Requiring the module pulls in
 * config.js, which runs dotenv, which reads api/.env and PUTS THE VARIABLES
 * BACK. Deleting them first and requiring afterwards tests nothing.
 *
 * Deleting after the require is sound because these are read per call, which
 * is the property the fix deliberately keeps.
 */
function authUtilsWithNothingSet() {
  jest.resetModules();
  const mod = require('../../src/controllers/auth-utils.controller');
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.JWT_COOKIE_EXPIRES_IN;
  process.env.JWT_SECRET = 'a-test-secret-that-is-long-enough-to-sign-with';
  return mod;
}

describe('signing a token without JWT_EXPIRES_IN', () => {
  const saved = {
    expires: process.env.JWT_EXPIRES_IN,
    cookie: process.env.JWT_COOKIE_EXPIRES_IN,
    secret: process.env.JWT_SECRET,
  };

  beforeEach(() => {
    /* Exactly what `npm run dev` produced: secrets, and nothing about how long
       a token lives. */
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_COOKIE_EXPIRES_IN;
    process.env.JWT_SECRET = 'a-test-secret-that-is-long-enough-to-sign-with';
  });

  afterAll(() => {
    if (saved.expires === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = saved.expires;
    if (saved.cookie === undefined) delete process.env.JWT_COOKIE_EXPIRES_IN;
    else process.env.JWT_COOKIE_EXPIRES_IN = saved.cookie;
    if (saved.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved.secret;
    jest.resetModules();
  });

  it('does not throw, which is what took the process down', () => {
    const { signToken } = authUtilsWithNothingSet();
    expect(() => signToken('6aad3bb7f5e8f7a44457e731')).not.toThrow();
  });

  it('and the token it produces actually expires', () => {
    /* A token signed with no expiry at all would not throw either, and would
       be a worse bug than the crash: a session that never ends. */
    const { signToken } = authUtilsWithNothingSet();
    const decoded = jwt.decode(signToken('6aad3bb7f5e8f7a44457e731'));

    expect(decoded.exp).toBeGreaterThan(decoded.iat);
    const days = (decoded.exp - decoded.iat) / 86400;
    expect(days).toBe(90);
  });

  it('and an environment that DOES set one is still obeyed', () => {
    const { signToken } = authUtilsWithNothingSet();
    process.env.JWT_EXPIRES_IN = '7d';
    const decoded = jwt.decode(signToken('6aad3bb7f5e8f7a44457e731'));
    expect((decoded.exp - decoded.iat) / 86400).toBe(7);
  });
});

describe('the cookie expiry beside it', () => {
  it('is a real date rather than an Invalid Date', () => {
    /* `new Date(Date.now() + undefined * 86400000)` is Invalid Date, which a
       browser discards - the session cookie silently became a session-only
       one. Read through config, it is a number. */
    jest.resetModules();
    delete process.env.JWT_COOKIE_EXPIRES_IN;
    const config = require('../../src/config/config');
    const when = new Date(Date.now() + config.jwt.cookieExpiresIn * 24 * 60 * 60 * 1000);
    expect(Number.isNaN(when.getTime())).toBe(false);
    expect(when.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the development environment it was found in', () => {
  it('names both values rather than leaning on the defaults', () => {
    /*
     * The defaults above are the safety net. A contributor reading api/.env
     * should still be able to see how long their session lasts, and the next
     * person to add a raw process.env read should find the value set.
     */
    const fs = require('fs');
    const path = require('path');
    const dev = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'dev-server.js'),
      'utf8'
    );
    expect(dev).toContain('JWT_EXPIRES_IN=');
    expect(dev).toContain('JWT_COOKIE_EXPIRES_IN=');
  });
});

describe('no read of these two is left without a fallback', () => {
  it('because a bare one is another login that can kill the API', () => {
    /*
     * The rule is NOT "never read process.env" - these are still read per
     * call, deliberately, so that setting one later still takes effect. The
     * rule is that no read is ever used as the value on its own, because an
     * unset variable is what jwt.sign threw on.
     *
     * Asserted on shape rather than on a form of words: every occurrence must
     * be followed by an `||`.
     */
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'controllers', 'auth-utils.controller.js'),
      'utf8'
    );

    for (const name of ['JWT_EXPIRES_IN', 'JWT_COOKIE_EXPIRES_IN']) {
      const needle = 'process.env.' + name;
      let from = 0;
      let seen = 0;
      for (;;) {
        const found = src.indexOf(needle, from);
        if (found === -1) break;
        seen += 1;
        const after = src.slice(found + needle.length, found + needle.length + 60);
        const line = after.split(String.fromCharCode(10))[0];
        expect(name + ' read #' + seen + ': ' + line).toContain('||');
        from = found + needle.length;
      }
      expect(seen).toBeGreaterThan(0);
    }
  });
});
