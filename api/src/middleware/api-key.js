'use strict';
/*
 * Signing in with an API key.
 *
 * A key is a user. It is stored on the user record, it belongs to a branch and
 * a licence like any other, and it carries the same access grid that the
 * Users screen already shows. That is the whole design: nothing about a key is
 * special except how it proves who it is.
 *
 * Which matters more than it sounds, because the access grid is enforced
 * unevenly: checkPermission is called in 13 of the 26 controllers, so roughly
 * half the API accepts whatever an authenticated session asks for and the grid
 * is only reliably hiding buttons in the browser. That is survivable for staff
 * working through the screens, who have no way to call the other half; it is
 * not survivable for a credential handed to somebody else's developer, where
 * "read-only" has to mean read-only on every route, not most of them.
 *
 * So the grid is enforced here, for key requests only. Sessions are untouched:
 * turning enforcement on for the tills at the same time would risk locking a
 * shop out of its own counter over a route this file mapped wrongly, and that
 * is a separate change deserving its own testing.
 */

const { createHash, timingSafeEqual } = require('crypto');

/*
 * Route prefix to the name the access grid uses.
 *
 * Anything not listed is refused rather than allowed: a new module added later
 * should be unreachable by an existing key until somebody decides what that
 * key may do with it. Failing open here would silently widen every key in
 * circulation.
 */
const MODULE_BY_PREFIX = {
  branches: 'branch',
  categories: 'category',
  customercategory: 'customer',
  customers: 'customer',
  dashboard: 'dashboard',
  expenses: 'expense',
  items: 'item',
  receivings: 'receiving',
  registers: 'register',
  sales: 'sales',
  setting: 'setting',
  settings: 'setting',
  stocklogs: 'stocklog',
  suppliers: 'supplier',
  users: 'user',
  variants: 'item',
};

/* What the request is trying to do, in the grid's own words. */
function actionFor(method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
  if (method === 'DELETE') return 'delete';
  return 'write'; // POST, PUT, PATCH
}

function moduleFor(path) {
  const first = String(path || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)[0];
  if (!first) return null;
  return MODULE_BY_PREFIX[first.toLowerCase()] || null;
}

/*
 * The whole path, not the part this middleware can see.
 *
 * This runs inside protect, which each route file mounts itself, so by the
 * time it is reached req.path has already had the mount point stripped: a
 * request to /sales arrives here as "/". Reading that gave no module at all,
 * and every key request was refused with "not available to API keys" - the
 * right answer for the wrong reason, which is the kind of bug that looks fixed.
 *
 * baseUrl carries the mount point. originalUrl is the fallback for anywhere
 * this is called outside a mounted router.
 */
function requestPath(req) {
  const base = req.baseUrl || '';
  const rest = req.path || '';
  const joined = (base + rest).trim();
  if (joined && joined !== '/') return joined;
  return String(req.originalUrl || rest || '');
}

/*
 * Whether this user's grid permits it.
 *
 * A missing module or a missing flag is a no. The grid is written in full when
 * a user is created, so absence means somebody has removed it or the module is
 * newer than the key - and in both cases refusing is the safe reading.
 */
function permits(access, moduleName, action) {
  if (!access || !moduleName) return false;
  const entry = access[moduleName];
  if (!entry || typeof entry !== 'object') return false;
  return entry[action] === true;
}

/*
 * The key on the request, if there is one.
 *
 * Several spellings because integrators reach for different ones and a
 * credential that silently does not arrive is the least debuggable failure
 * there is. Authorization: Bearer is deliberately not among them - that is the
 * session token's header, and overloading it would make a failure ambiguous.
 */
function keyFromRequest(req) {
  const raw = req.headers['x-api-key'] || req.headers['apikey'] || req.headers['x-apikey'];
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key || null;
}

/*
 * Compare without leaking the answer in the timing.
 *
 * The lookup is by indexed field so the database has already matched it; this
 * guards the confirmation step, which is cheap to do properly and awkward to
 * add later.
 */
function sameKey(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/*
 * Authenticate by key, or hand on untouched.
 *
 * Placed before the session and token checks, and silent when no key is
 * present, so an ordinary browser request reaches the existing path exactly as
 * it did before.
 */
function apiKeyAuth({ findUserByApiKey, continueWithTenant }) {
  return async (req, res, next) => {
    const key = keyFromRequest(req);
    if (!key) return next();

    let user;
    try {
      user = await findUserByApiKey(key);
    } catch (err) {
      return res.status(500).json({
        type: 'error',
        status: 'error',
        message: 'Could not check that API key.',
        data: null,
      });
    }

    if (!user || !user.apikey || !sameKey(user.apikey, key)) {
      return res.status(401).json({
        type: 'error',
        status: 'error',
        message: 'Invalid API key.',
        data: null,
      });
    }

    // A key belongs to a key user. A staff account's key must not become a way
    // to bypass the login the account is supposed to use.
    if (String(user.usertype || '').toLowerCase() !== 'api') {
      return res.status(401).json({
        type: 'error',
        status: 'error',
        message: 'That key does not belong to an API user.',
        data: null,
      });
    }

    if (user.status && String(user.status).toLowerCase() === 'inactive') {
      return res.status(401).json({
        type: 'error',
        status: 'error',
        message: 'This API key has been deactivated.',
        data: null,
      });
    }

    req.isApiKey = true;
    req.user = user;

    /*
     * Check the grid here, not as a separate middleware.
     *
     * It was mounted in routes/index.js, ahead of the route files - but each
     * route file runs protect itself, so enforcement ran before
     * authentication, found no key on the request, and waved everything
     * through. A key with read denied on sales was returning sales.
     *
     * Doing it here removes the ordering question entirely: the user is known
     * on the line above, and nothing reaches a handler without passing this.
     */
    const refusal = aclRefusal(req);
    if (refusal) return res.status(403).json(refusal);

    return continueWithTenant(req, res, next, user);
  };
}

/*
 * What to say when the grid does not permit this request, or null when it
 * does.
 *
 * Names the module and the action, because an integrator reading a bare
 * "forbidden" cannot tell whether the key is wrong, the permission is missing,
 * or the endpoint does not exist.
 */
function aclRefusal(req) {
  const action = actionFor(req.method);
  const moduleName = moduleFor(requestPath(req));

  if (!moduleName) {
    return {
      type: 'error',
      status: 'error',
      message: 'This endpoint is not available to API keys.',
      data: null,
    };
  }

  if (!permits(req.user && req.user.access, moduleName, action)) {
    return {
      type: 'error',
      status: 'error',
      message: `This API key does not have ${action} access to ${moduleName}.`,
      data: { module: moduleName, action },
    };
  }

  return null;
}

/*
 * Enforce the access grid, for key requests only.
 *
 * Returns 403 with the module and action named, because an integrator reading
 * a bare "forbidden" cannot tell whether the key is wrong, the permission is
 * missing, or the endpoint does not exist.
 */
function enforceApiKeyAcl(req, res, next) {
  if (!req.isApiKey) return next();
  const refusal = aclRefusal(req);
  if (refusal) return res.status(403).json(refusal);
  return next();
}

module.exports = {
  apiKeyAuth,
  requestPath,
  aclRefusal,
  enforceApiKeyAcl,
  actionFor,
  moduleFor,
  permits,
  keyFromRequest,
  MODULE_BY_PREFIX,
};
