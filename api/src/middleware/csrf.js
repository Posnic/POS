'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ephemeralSecret } = require('../config/signing-secret');
const { currentSecret } = require('../db/tenant-context');
const config = require('../config/config');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER = 'X-XSRF-TOKEN';
const RESPONSE_HEADER = 'X-CSRF-TOKEN';

/*
 * The login secret, read the way middleware/auth reads it: the shop's own
 * where there is a tenant scope, the environment otherwise. In a shared
 * process a request outside any scope has no secret to read, and asking
 * throws; that is answered here as "nothing to verify with", never as an
 * error on a request that may be perfectly ordinary.
 */
const jwtSecret = () => {
  try {
    return currentSecret('JWT_SECRET', process.env.JWT_SECRET || (config.jwt && config.jwt.secret));
  } catch (e) {
    return null;
  }
};

/*
 * The token secret. CSRF_SECRET when somebody set it; otherwise DERIVED from
 * the login secret, so it is the same after a restart. It used to be a
 * random value per process, which meant every deploy silently invalidated
 * the token each open till was holding, and the first write after it was
 * refused as "missing or expired". Derived, not reused: a token must never
 * double as a login, so the login secret is run through a keyed hash first.
 */
const secret = () => {
  if (process.env.CSRF_SECRET) return process.env.CSRF_SECRET;
  const base = jwtSecret();
  if (base) return crypto.createHmac('sha256', String(base)).update('posnic:csrf').digest('hex');
  return ephemeralSecret('CSRF_SECRET');
};

/*
 * Is this cookie a login the browser can still use?
 *
 * The cookie outlives the token inside it: the cookie is kept for seven
 * days, the token expires in one. From the second day the browser sends a
 * cookie that authenticates nothing, and binding a token to it made the
 * login page impossible: every read answered 401, so the page never learned
 * the token, and the login write was refused for not carrying it. Nothing
 * short of clearing the site's cookies got the shop back in. A cookie that
 * does not verify is not a credential, and a request that carries no
 * credential has nothing to forge.
 */
const liveCookie = (token) => {
  if (!token) return false;
  const key = jwtSecret();
  /* Nothing to verify against: the old behaviour, bind rather than trust. */
  if (!key) return true;
  try {
    jwt.verify(token, key);
    return true;
  } catch (e) {
    return false;
  }
};

/* A token is bound to a credential the browser already has but JavaScript
   cannot read. The browser learns only the derived value in a CORS-exposed
   response header and reflects it on its next write. */
const credentialFor = (req) => {
  const cookie = req.cookies && req.cookies.jwt;
  if (cookie && liveCookie(cookie)) return `jwt:${cookie}`;
  if (req.session && req.session.userId && req.sessionID) return `session:${req.sessionID}`;
  return null;
};

const tokenFor = (credential) =>
  crypto.createHmac('sha256', secret()).update(credential).digest('base64url');

const matches = (actual, expected) => {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/*
 * CSRF protection for browser credentials.
 *
 * API keys and explicit Bearer tokens are not ambient credentials, so a site
 * the user visits cannot attach them; requiring a browser token from those
 * callers would only break integrations. Cookie-backed writes, however, must
 * carry the reflected token. This is deliberately after the session middleware
 * so session-only logins have a credential to bind to.
 */
const protect = (req, res, next) => {
  const credential = credentialFor(req);
  if (!credential) return next();

  const expected = tokenFor(credential);
  res.set(RESPONSE_HEADER, expected);

  if (SAFE_METHODS.has(req.method)) return next();
  if (String(req.get('authorization') || '').startsWith('Bearer ')) return next();
  if (matches(req.get(HEADER), expected)) return next();

  return res.status(403).json({
    type: 'error',
    status: false,
    message: 'Your session security token is missing or expired. Refresh and try again.',
    data: null,
  });
};

module.exports = {
  protect,
  credentialFor,
  liveCookie,
  tokenFor,
  matches,
  secret,
  SAFE_METHODS,
  HEADER,
  RESPONSE_HEADER,
};
