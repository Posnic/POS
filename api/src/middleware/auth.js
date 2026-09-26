const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const crypto = require('crypto');
const { AppError } = require('../utils/appError');
// UnauthorizedError was thrown on the failure path of protect() without being
// imported, so an invalid token produced a ReferenceError instead of a 401.
const { UnauthorizedError } = require('./errorHandler');
const { currentSecret, currentConnection } = require('../db/tenant-context');
const tokenService = require('../services/token.service');
require('../config/tokens');
const { findUserByIdentifier } = require('../utils/findUserByIdentifier');
const { apiKeyAuth, keyFromRequest } = require('./api-key');
const config = require('../config/config');
const { attachTenantContext, TenantContextError } = require('../utils/tenant-context');
const { runWithRequestContext } = require('../utils/request-context');
const { authCookieOptions } = require('../utils/auth-cookie');
const handsets = require('../utils/handsets');
const authVersion = require('../utils/auth-version');

const continueWithTenant = async (req, res, next, currentUser) => {
  req.user = currentUser;
  res.locals = res.locals || {};
  res.locals.user = currentUser;
  try {
    await attachTenantContext(req, currentUser);

    /*
     * A PHONE THE SHOP HAS STOPPED GETS NOTHING, AND IS TOLD WHY.
     *
     * Here rather than at the three places a token is decoded, because
     * this is the first moment the tenant is known and therefore the
     * first moment there is a shop to ask. Every authenticated route
     * passes through it.
     *
     * Only a token that NAMES a phone can be stopped this way, so a till,
     * a browser and an older handset are all untouched: `handsetDevice`
     * is set from the token's own claim, which only the handset sign-in
     * puts there.
     *
     * 403 and a code, not 401: the credential is perfectly good and
     * signing in again with it would change nothing. The phone has been
     * turned off, which is a different sentence and a different thing for
     * the app to say.
     */
    if (req.handsetDevice) {
      const mongoose = require('mongoose');
      const stopped = await handsets.revoked(
        currentConnection(mongoose.connection).db,
        req.handsetDevice
      );
      if (stopped) {
        return res.status(403).json({
          error: {
            code: 'DEVICE_REVOKED',
            message: 'The shop has turned this phone off. Sign in again to use it.',
          },
        });
      }
    }

    const tenant = req.tenantContext || {};
    return runWithRequestContext(
      {
        currentBranch: tenant.branchId || null,
        currentBranchName: tenant.branchName || '',
        license: tenant.licenseId || null,
        loggedUser: currentUser._id || currentUser.id || null,
        loggedUserName: currentUser.username || currentUser.email || currentUser.name || '',
      },
      next
    );
  } catch (error) {
    if (error instanceof TenantContextError) {
      return res.status(error.statusCode).json({
        type: 'error',
        status: false,
        message: error.message,
        data: null,
      });
    }
    throw error;
  }
};

/*
 * The secret used for JWT payloads, resolved per request.
 *
 * It used to prefer the environment and fall back to the central config so a
 * local start could not produce unsigned tokens. Both of those are process-wide
 * values, which is right for a process serving one shop and wrong for one
 * serving several: every request would be verified against whichever shop
 * happened to start the process, so a token minted for one customer would be
 * accepted for another.
 *
 * currentSecret keeps the old behaviour exactly when there is no tenant scope -
 * the environment, then the config default - and in multi-tenant mode raises
 * rather than falling back, because the fallback is the leak.
 */
const getJwtSecret = () => currentSecret('JWT_SECRET', process.env.JWT_SECRET || config.jwt.secret);

// Encrypt session ID similar in spirit to PHP's openssl_encrypt(AES-256-CBC).
// This is internal to Node and is NOT expected to interoperate with PHP tokens;
// it simply preserves the design where JWT carries an encrypted session id.
const encryptSessionId = (sessionId) => {
  try {
    const jwtSecret = getJwtSecret();
    if (!sessionId || !jwtSecret) {
      return null;
    }

    const key = crypto.createHash('sha256').update(jwtSecret).digest(); // 32 bytes
    const iv = key.subarray(0, 16); // 16 bytes IV derived from key

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(String(sessionId), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  } catch (e) {
    // In case of any crypto error, we silently skip embedding session_id
    // so that authentication still works via user id.
    return null;
  }
};

// Create and sign basic JWT token (id-only payload used by modern routes)
const signToken = (id, version = 0) => {
  return jwt.sign({ id, ...(version ? { authVersion: version } : {}) }, getJwtSecret(), {
    expiresIn: jwtLifetimeSeconds(),
  });
};

/* Lives in its own dependency-free file so the number in the token and the
   number a client is told cannot drift apart, and so it is testable without
   installing the API. */
const {
  jwtLifetimeSeconds,
  handsetLifetimeSeconds,
  loginCookieDays,
} = require('../utils/token-lifetime');

// Legacy-style JWT including encrypted session_id in the payload.
// This mirrors the PHP design where JWT carries an encrypted session id
// for fast session restoration, while still keeping the 'id' field
// so existing Node verification continues to work.
const signLegacyToken = (user, req, branchId, expiresIn) => {
  authVersion.stampSession(req, user);
  const userId = user._id?.toString?.() || user.id || user._id;
  const sessionId = req.sessionID || req.session?.id;
  const encryptedSessionId = encryptSessionId(sessionId);

  const payload = {
    // Node-side fields
    id: userId,
    ...(authVersion.version(user) ? { authVersion: authVersion.version(user) } : {}),
    // PHP-style fields for parity
    user_id: userId,
    username: user.username || user.name || user.email || '',
    email: user.email || '',
    usertype: user.usertype || user.role || '',
    session_id: encryptedSessionId,
    // Branch context (PHP: $_SESSION['PosnicPro']['settings']['_id'])
    branch_id: branchId
      ? String(branchId)
      : req.session?.selectedBranchId || req.session?.branch_id || '',
  };

  /*
   * WHICH PHONE THIS TOKEN WAS ISSUED TO, when it was issued to one.
   *
   * Owner: "map device to cloud account." A shop that can see its
   * handsets has to be able to stop one, and stopping one is only
   * meaningful if the credential itself says which phone is presenting
   * it. A header would not: a header is whatever the caller types.
   *
   * Read off the request rather than taken as an argument so that every
   * existing caller keeps the token it already had, down to the claims.
   * The handset sign-in is the only thing that sets it.
   */
  if (req && req.handsetDevice) payload.device_id = String(req.handsetDevice);

  /*
   * A caller may ask for a different lifetime, and exactly one does.
   *
   * A till is a fixed machine behind a counter and a day is right for it. A
   * handset is carried by a part-time waiter who does not know the shop's
   * password, so a daily expiry means finding a manager at the start of every
   * service, for every phone. See handsetLifetimeSeconds in
   * utils/token-lifetime.js for why a longer one is safe there and not here.
   *
   * Left as the default rather than a required argument, so every existing
   * caller keeps the lifetime it already had.
   */
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: expiresIn || jwtLifetimeSeconds(),
  });
};

// Create and send token, set cookie
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id, authVersion.version(user));
  authVersion.stampSession(res.req, user);
  const cookieOptions = authCookieOptions({
    expires: new Date(Date.now() + loginCookieDays() * 24 * 60 * 60 * 1000),
  });

  // Send JWT via HTTP-only cookie so browser automatically
  // includes it on subsequent requests (used by `protect`).
  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

// Authenticate user using JWT token
const auth = async (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return next(new AppError('Please authenticate', 401));
    }

    // Verify token
    const decoded = await promisify(jwt.verify)(token, getJwtSecret());
    if (decoded && decoded.device_id) req.handsetDevice = String(decoded.device_id);

    // Check if user still exists
    const currentUser = await findUserByIdentifier(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists', 401));
    }

    // Check if user changed password after the token was issued
    if (
      !authVersion.current(currentUser, decoded) ||
      currentUser.changedPasswordAfter(decoded.iat)
    ) {
      return next(new AppError('User recently changed password! Please log in again', 401));
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    return continueWithTenant(req, res, next, currentUser);
  } catch (error) {
    /*
     * Only a BAD TOKEN is a 401 here. This catch used to stamp every
     * failure "Invalid token" - including the database timing out under
     * load - and this middleware guards users/verify, the session
     * heartbeat. So a demo-data install (a zip download and hundreds of
     * inserts on a small shared instance) could make one heartbeat's user
     * lookup fail, the client saw 401, and it did the only correct thing
     * with a 401: signed the owner out, mid-install. An infrastructure
     * hiccup is a 500 and a toast, never a sign-out; `protect` below has
     * always drawn the line this way.
     */
    if (
      error &&
      (error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError' ||
        error.name === 'NotBeforeError')
    ) {
      dropDeadCookie(req, res, getTokenFromRequest(req));
      return next(new UnauthorizedError('Invalid token or user not found'));
    }
    return next(error);
  }
};

// Helper function to get token from request
const getTokenFromRequest = (req) => {
  // 1) Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  // 2) Get token from cookie
  else if (req.cookies?.jwt) {
    return req.cookies.jwt;
  }
  // 3) Get token from query string (useful for email verification links)
  else if (req.query?.token) {
    return req.query.token;
  }
  return null;
};

/*
 * A cookie whose token is dead is cleared as it is refused.
 *
 * The cookie is kept for seven days and the token inside it for one, so from
 * the second day of a remembered login the browser sends a cookie that
 * authenticates nothing. Left in place it made every read a 401 and, through
 * the CSRF token bound to it, kept the login page from ever succeeding until
 * the shop cleared its cookies by hand. Only the cookie is cleared, and only
 * when the cookie is what carried the dead token: a bad Bearer header says
 * nothing about the cookie beside it.
 */
const dropDeadCookie = (req, res, token) => {
  if (!token || !req.cookies || req.cookies.jwt !== token) return;
  try {
    res.clearCookie('jwt', authCookieOptions());
  } catch (e) {
    /* headers already gone; the next request clears it */
  }
};

// Protect routes - PHP-style: session is primary, JWT is only for restoring session
/*
 * Find the user a key belongs to.
 *
 * Kept here rather than in the key middleware so the lookup goes through the
 * same model the rest of authentication uses, and so the key middleware needs
 * no database knowledge of its own.
 */
/*
 * license and branch_access are select:false on the schema, so a plain findOne
 * returns a user with no licence at all - and nothing complains. Every scoped
 * query then quietly matches nothing: attachTenantContext gives up and leaves
 * the context licence null, and salesReports builds
 * `new ObjectId(req.user.license)`, which on undefined mints a brand new random
 * id rather than throwing. The key authenticated, the ACL passed, the dates and
 * branch were right, and every endpoint returned an empty list with HTTP 200.
 *
 * findUserByIdentifier - the path a signed-in session takes - asks for the same
 * two fields for the same reason. This must keep matching it.
 */
const findUserByApiKey = async (key) => {
  const User = require('../models/user.model');
  const model = User.User || User;
  return model.findOne({ apikey: key }).select('+apikey +license +branch_access').lean();
};

const protect = async (req, res, next) => {
  try {
    /*
     * 0) An API key, if one was sent.
     *
     * First, and silent when absent, so an ordinary browser request reaches
     * the session path below exactly as it did before. A key request joins at
     * continueWithTenant like any other user, which is what makes branch,
     * licence and every downstream behaviour identical to a signed-in session.
     */
    const apiKey = keyFromRequest(req);
    if (apiKey) {
      return apiKeyAuth({ findUserByApiKey, continueWithTenant })(req, res, next);
    }

    /*
     * 0.5) A scoped integration token (integration platform step 2).
     *
     * Recognised by its prefix and FAIL-CLOSED: a caller who explicitly
     * presented a posnic_ token gets a clean 401 on any mismatch rather
     * than silently falling through to session auth - an integration must
     * never half-authenticate as something else. A valid token joins at
     * continueWithTenant like every other caller, carrying exactly the ACL
     * matrix it was minted with.
     */
    const bearer = req.headers.authorization || '';
    if (bearer.startsWith('Bearer posnic_')) {
      const { resolveScopedToken } = require('../utils/api-tokens');
      const principal = req.db ? await resolveScopedToken(req.db, bearer.slice(7)) : null;
      if (!principal) {
        return res.status(401).json({ status: 'error', message: 'Invalid or revoked API token' });
      }
      return continueWithTenant(req, res, next, principal);
    }

    // Explicit bearer credentials must retain their user/device identity even
    // when a previous response created a browser/native cookie session.
    if (!bearer.startsWith('Bearer ') && req.session && req.session.userId) {
      try {
        const currentUser = await findUserByIdentifier(req.session.userId);
        if (currentUser && authVersion.current(currentUser, req.session)) {
          return continueWithTenant(req, res, next, currentUser);
        }
        // If session userId is invalid, fall through to JWT-based restore
      } catch (e) {
        // If loading user from session fails, fall through to JWT-based restore
      }
    }

    // 2) No valid session: fall back to JWT token (acts as session-restore token)
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in! Please log in to get access.',
      });
    }

    // 3) Verify token
    let decoded;
    try {
      decoded = await promisify(jwt.verify)(token, getJwtSecret());
      if (decoded && decoded.device_id) req.handsetDevice = String(decoded.device_id);
    } catch (err) {
      if (err.name === 'JsonWebTokenError') {
        dropDeadCookie(req, res, token);
        return res.status(401).json({
          status: 'error',
          message: 'Invalid token. Please log in again!',
        });
      } else if (err.name === 'TokenExpiredError') {
        dropDeadCookie(req, res, token);
        return res.status(401).json({
          status: 'error',
          message: 'Your session has expired. Please log in again.',
        });
      }
      return res.status(401).json({
        status: 'error',
        message: 'Error processing your token',
      });
    }

    // 4) Check if user still exists
    const currentUser = await findUserByIdentifier(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token no longer exists. Please log in again.',
      });
    }

    // 5) Check if user changed password after the token was issued (JWT-only check)
    if (
      !authVersion.current(currentUser, decoded) ||
      currentUser.changedPasswordAfter(decoded.iat)
    ) {
      return res.status(401).json({
        status: 'error',
        message: 'Your password was recently changed. Please log in again.',
      });
    }

    // 6) Restore session from JWT like PHP's JwtHelper does
    if (req.handsetDevice && decoded.branch_id)
      req.headers['x-branch-id'] = String(decoded.branch_id);
    if (req.session) {
      req.session.userId = currentUser.id || currentUser._id?.toString();
      authVersion.stampSession(req, currentUser);
      // Restore branch_id from JWT if session doesn't have it (PHP: $_SESSION['PosnicPro']['settings']['_id'])
      if (!req.session.branch_id && decoded.branch_id) {
        req.session.branch_id = decoded.branch_id;
      }
      if (!req.session.selectedBranchId && decoded.branch_id) {
        req.session.selectedBranchId = decoded.branch_id;
      }
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    return continueWithTenant(req, res, next, currentUser);
  } catch (error) {
    next(error);
  }
};

// Only for rendered pages, no errors
const isLoggedIn = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      // 1) Verify token
      const decoded = await promisify(jwt.verify)(req.cookies.jwt, getJwtSecret());

      // 2) Check if user still exists
      const currentUser = await findUserByIdentifier(decoded.id);
      if (!currentUser) {
        return next();
      }

      // 3) Check if user changed password after the token was issued
      if (
        !authVersion.current(currentUser, decoded) ||
        currentUser.changedPasswordAfter(decoded.iat)
      ) {
        return next();
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = currentUser;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};

/**
 * Optional auth middleware - mirrors PHP session-exceptional behaviour.
 *
 * PHP dispatcher.php starts a session on EVERY request.  For routes listed in
 * $sessionExceptionalRequest the dispatcher simply skips the "is authenticated?"
 * gate, but the session data (including currentBranch) is still available.
 *
 * This middleware does exactly that for Node.js:
 *   1. Tries session-based auth  (req.session.userId)
 *   2. Falls back to JWT cookie / Authorization header
 *   3. On success → populates req.user / res.locals.user (same as `protect`)
 *   4. On failure → silently continues without req.user (never returns 401)
 */
const optionalProtect = async (req, res, next) => {
  try {
    // 1) Try session-based auth
    if (
      !String(req.headers?.authorization || '').startsWith('Bearer ') &&
      req.session &&
      req.session.userId
    ) {
      try {
        const currentUser = await findUserByIdentifier(req.session.userId);
        if (currentUser && authVersion.current(currentUser, req.session)) {
          return continueWithTenant(req, res, next, currentUser);
        }
      } catch (_) {
        /* fall through */
      }
    }

    // 2) Try JWT (cookie or Authorization header)
    const token = getTokenFromRequest(req);
    if (token) {
      try {
        const decoded = await promisify(jwt.verify)(token, getJwtSecret());
        if (decoded && decoded.device_id) req.handsetDevice = String(decoded.device_id);
        const currentUser = await findUserByIdentifier(decoded.id);
        if (
          currentUser &&
          authVersion.current(currentUser, decoded) &&
          !currentUser.changedPasswordAfter(decoded.iat)
        ) {
          // Restore session from JWT (same as protect does)
          if (req.session) {
            req.session.userId = currentUser.id || currentUser._id?.toString();
            authVersion.stampSession(req, currentUser);
          }
          return continueWithTenant(req, res, next, currentUser);
        }
      } catch (_) {
        /* fall through */
      }
    }

    // 3) No valid auth - continue anyway (session-exceptional)
    next();
  } catch (_) {
    next();
  }
};

// The account's type may live on `usertype` (canonical) or the legacy `role`
// field depending on how the account was made - every role check reads both.
const effectiveType = (user) => String(user?.usertype || user?.role || '').toLowerCase();

// Restrict to certain roles. super_admin always satisfies an 'admin'
// requirement - it is the higher rank of the same owner.
const restrictTo = (...roles) => {
  return (req, res, next) => {
    const type = effectiveType(req.user);
    const allowed = roles.includes(type) || (type === 'super_admin' && roles.includes('admin'));
    if (!allowed) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

// The vestigial permissions-array checkPermission middleware was retired (P2):
// no route used it - enforcement runs through base.controller.checkPermission,
// which reads the resolved access matrix.

// Prevent unauthorized access to user data
const restrictToUser = (req, res, next) => {
  // Allow the tenant's top accounts to access any user's data
  if (['admin', 'super_admin'].includes(effectiveType(req.user))) return next();

  // User can only access their own data
  if (req.params.id !== req.user.id) {
    return next(new AppError('You do not have permission to access this data', 403));
  }

  next();
};

// Generate password reset token
const createPasswordResetToken = () => {
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');
  const passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  const passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return { resetToken, passwordResetToken, passwordResetExpires };
};

module.exports = {
  signToken,
  signLegacyToken,
  jwtLifetimeSeconds,
  handsetLifetimeSeconds,
  createSendToken,
  auth,
  protect,
  optionalProtect,
  isLoggedIn,
  restrictTo,
  restrictToUser,
  createPasswordResetToken,
  findUserByApiKey,
};
