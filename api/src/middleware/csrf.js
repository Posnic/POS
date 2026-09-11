'use strict';

const crypto = require('crypto');
const { ephemeralSecret } = require('../config/signing-secret');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER = 'X-XSRF-TOKEN';
const RESPONSE_HEADER = 'X-CSRF-TOKEN';

const secret = () => process.env.CSRF_SECRET || ephemeralSecret('CSRF_SECRET');

/* A token is bound to a credential the browser already has but JavaScript
   cannot read. The browser learns only the derived value in a CORS-exposed
   response header and reflects it on its next write. */
const credentialFor = (req) => {
  if (req.cookies && req.cookies.jwt) return `jwt:${req.cookies.jwt}`;
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

module.exports = { protect, credentialFor, tokenFor, matches, SAFE_METHODS, HEADER, RESPONSE_HEADER };
