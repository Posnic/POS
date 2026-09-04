const { redact } = require('../utils/redact');
const { clientIp } = require('../utils/client-ip');
const { currentConnection } = require('../db/tenant-context');
const { searchPattern } = require('../utils/safe-search');
const BaseController = require('./base.controller');
const UserModel = require('../models/user.model');
const Branch = require('../models/branch.model');
const bcrypt = require('bcryptjs');
const { createSendToken, signLegacyToken } = require('../middleware/auth');
const httpStatus = require('http-status');
const { AppError } = require('../utils/appError');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { authCookieOptions } = require('../utils/auth-cookie');
const sessionFilterUtil = require('../utils/session-filter.util');
const { setActiveTenantContext } = require('../utils/tenant-context');
const { recordAudit } = require('../utils/audit-trail');

/*
 * What somebody sees when a sign-in fails.
 *
 * Shown for BOTH an unknown user and a wrong password, on purpose: telling
 * them apart would let anybody enumerate which emails have accounts here.
 *
 * The old wording was "Invalid account. Please contact your branch manager."
 * A sole shop owner locked out of their own till read that as an instruction
 * to contact himself, and it said nothing about the thing that had actually
 * happened - somebody had changed the password the day before. Naming that
 * possibility costs nothing, leaks nothing, and is the first thing to try.
 */
const LOGIN_FAILED_MESSAGE =
  'Username or password is incorrect. If the password was changed recently, ' +
  'use the new one - otherwise ask an administrator to reset it.';

const persistActiveTenant = async (req, data, fallbackLicense) => {
  const context = setActiveTenantContext(req, {
    branchId: data.branch_id,
    branchName: data.branch_name,
    licenseId: data.license || fallbackLicense,
  });
  if (typeof req.session?.save === 'function') {
    await new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
  }
  return context;
};

class UsersController extends BaseController {
  constructor() {
    super();
    this.userModel = UserModel;
    this.extractObjectId = this.extractObjectId.bind(this);
    this.login = this.login.bind(this);
    this.legacyVerifyLogin = this.legacyVerifyLogin.bind(this);
    this.verifyToken = this.verifyToken.bind(this);
    this.verify = this.verify.bind(this);
    this.logOut = this.logOut.bind(this);
    this.userBranchSelection = this.userBranchSelection.bind(this);
    this.getUserAccessDetails = this.getUserAccessDetails.bind(this);
    this.getUserRegisterList = this.getUserRegisterList.bind(this);
    this.userDefaultBranchSet = this.userDefaultBranchSet.bind(this);
    this.getAll = this.getAll.bind(this);
    this.getOne = this.getOne.bind(this);
    this.add = this.add.bind(this);
    this.edit = this.edit.bind(this);
    this.delete = this.delete.bind(this);
    this.updatePassword = this.updatePassword.bind(this);
    this.userProfile = this.userProfile.bind(this);
    this.changeBranch = this.changeBranch.bind(this);
    this.userVerify = this.userVerify.bind(this);
    this.updateNewPassword = this.updateNewPassword.bind(this);
    this.getUserKeyDetails = this.getUserKeyDetails.bind(this);
    this.ssoAuth = this.ssoAuth.bind(this);
    this.mobileLogin = this.mobileLogin.bind(this);
    this.kioskMobileLogin = this.kioskMobileLogin.bind(this);
    this.ssoToken = this.ssoToken.bind(this);
    this.ssoClientLogin = this.ssoClientLogin.bind(this);
    this.planUpdate = this.planUpdate.bind(this);
    this.userstatusReportTable = this.userstatusReportTable.bind(this);
    this.getUserDetails = this.getUserDetails.bind(this);
    this.getDataChanges = this.getDataChanges.bind(this);
    this.exportUsers = this.exportUsers.bind(this);
    this.getUserAjaxList = this.getUserAjaxList.bind(this);
    this.uploadUserImage = this.uploadUserImage.bind(this);
    this.userImageDelete = this.userImageDelete.bind(this);
    this.updatePrintSetting = this.updatePrintSetting.bind(this);
    this.printType = this.printType.bind(this);
  }

  /**
   * Helper method to extract ObjectId string from various formats
   * Handles: plain string, {$oid: "string"}, or JSON string '{"$oid":"..."}'
   * @param {string|Object} id - ID in various formats
   * @returns {string|null} - Extracted ObjectId string or null if invalid
   */
  extractObjectId(id) {
    if (!id) return null;

    // Reject invalid stringified object
    if (typeof id === 'string' && (id === '[object Object]' || id.includes('[object'))) {
      return null;
    }

    // Handle PHP BSON format {$oid: "string"}
    if (typeof id === 'object' && id.$oid) {
      return id.$oid;
    }

    // Handle string format
    if (typeof id === 'string') {
      // Try to parse if it's a JSON string like '{"$oid":"..."}'
      if (id.startsWith('{') && id.includes('$oid')) {
        try {
          const parsed = JSON.parse(id);
          if (parsed.$oid) {
            return parsed.$oid;
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }

      // Return plain string (should be 24 hex chars)
      return id;
    }

    return null;
  }

  /**
   * Get all users with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  /**
   * Login user and return JWT token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  /**
   * Add a new user or edit existing user with full logic (permissions, branches, plan limits)
   * Matches PHP users.php add($edit = false, $id = '') and user_model.php userInsertUpdate()
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {boolean} edit - Whether this is an edit operation (default: false)
   * @param {string} id - User ID for edit operation (default: '')
   */
  async add(req, res, edit = false, id = '') {
    try {
      if (!this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const data = req.body;
      const context = {
        user: req.user,
        license: req.user.license,
      };

      const response = await this.userModel.userInsertUpdate(data, id, context);

      // PHP lines 187-193: Handle response
      if (response.status === true) {
        return this.success(res, response.data, response.message, 200);
      } else if (response.status === 'exist') {
        return res.status(406).json({
          type: 'error',
          message: response.message,
          data: response.data,
        });
      } else {
        return this.error(res, response.message, 404, response.data);
      }
    } catch (error) {
      console.error('Error in UsersController.add:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Login user and return JWT token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // 1) Check if email and password exist
      if (!email || !password) {
        return next(new AppError('Please provide email and password!', httpStatus.BAD_REQUEST));
      }

      // 2) Check if user exists && password is correct
      const user = await this.userModel.findOne({ email }).select('+password');

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return next(new AppError('Incorrect email or password', httpStatus.UNAUTHORIZED));
      }

      // 3) Store user id in session (PHP-style primary auth)
      if (req.session) {
        req.session.userId = user._id.toString();
      }

      // 4) If everything ok, send token to client
      createSendToken(user, httpStatus.OK, res);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Legacy login endpoint compatible with existing Posnic frontend.
   * PHP: public function verify() in users.php + verify() in user_model.php + responseUserData()
   *
   * The frontend posts { username, password } to /users/verify.
   * This method authenticates the user, checks rate limiting, and returns user data with JWT token.
   */
  /*
   * Record a failed sign-in where support can read it.
   *
   * The client is told one thing; this keeps the detail. When a shop says "we
   * cannot get in", the two questions are which account was tried and from
   * where - and, if the account exists, whether its password was changed
   * recently. That last field is what took a database session and a bcrypt
   * comparison by hand to establish, the one time it mattered.
   *
   * Never throws: a login must not fail because its audit line could not be
   * written. Never records the attempted password, not even hashed.
   */
  async recordFailedLogin(req, loginId, reason, user = null) {
    try {
      const db = await BaseModel.getDb();
      await recordAudit(db, {
        event: 'login_failed',
        actor: { id: user ? String(user._id) : null, name: loginId },
        target: user ? { id: String(user._id), name: user.email || '', type: 'user' } : null,
        ip: clientIp(req),
        userAgent: (req.headers && req.headers['user-agent']) || '',
        extra: {
          reason,
          attempted: loginId,
          /* Only meaningful when the account exists. Equal to creation means
             it has never been changed. */
          passwordChangedAt: user ? user.updated_date || user.updated_at || null : null,
        },
      });
    } catch (err) {
      console.error('[audit] failed login not recorded:', err.message);
    }
  }

  async legacyVerifyLogin(req, res) {
    try {
      // 🔍 DEBUG - Check if this method is called
      console.log('🔥 LEGACY VERIFY LOGIN CALLED!');
      console.log('🔥 Username:', req.body?.username);
      console.log('🔥 Request body:', redact(req.body));

      const { username, password } = req.body || {};

      // PHP GUMP validation: username required|max_len,250|min_len,3
      if (!username || String(username).length < 3 || String(username).length > 250) {
        return res.status(400).json({
          type: 'error',
          message: 'Validation Error',
          data: ['The Username field needs to be between 3 and 250 characters in length'],
        });
      }

      // PHP GUMP filter: trim|sanitize_string (no lowercase)
      const loginId = String(username).trim();

      // Find user by email or username, including all fields needed for the legacy response
      const user = await this.userModel
        .findOne({
          $or: [{ email: loginId }, { username: loginId }],
        })
        .select(
          '+password +license +branch_access +printing_design +access +plan +plan_access +activate +firstname +lastname +username +email +image +register_status +usertype +role_id'
        )
        .lean();

      /*
       * ONE MESSAGE FOR BOTH FAILURES, DELIBERATELY.
       *
       * Saying "no such user" here would tell anybody who asks which email
       * addresses have accounts on this shop, one guess at a time. So an
       * unknown user and a wrong password answer identically, and the reason
       * is recorded on the server instead, where support can see it and an
       * attacker cannot.
       *
       * The wording changed after a real shop was locked out for five days.
       * The old text - "Invalid account. Please contact your branch manager."
       * - told a sole owner, who IS the branch manager, to contact himself,
       * and never mentioned the thing that had actually happened: the
       * password had been changed. It now names that possibility, for both
       * cases, which gives the person at the till something to try.
       */
      if (!user) {
        await this.recordFailedLogin(req, loginId, 'no_such_user');
        return res.status(404).json({
          type: 'error',
          message: LOGIN_FAILED_MESSAGE,
          data: 'incorrect',
        });
      }

      // Verify password - try both base64 and non-base64 formats for compatibility
      let passwordValid = false;

      // Only attempt password comparison when a user record exists
      if (user && user.password) {
        // First try with base64 encoding (new format from password change)
        const base64Password = Buffer.from(String(password)).toString('base64');
        passwordValid = await bcrypt.compare(base64Password, user.password);

        // If base64 fails, try without base64 (old format)
        if (!passwordValid) {
          /* String() here as well as above: bcrypt.compare on a non-string
             behaves differently across versions, and `password` arrives
             straight from the request body where it can be an object or an
             array. The base64 branch already coerced; this one did not. */
          passwordValid = await bcrypt.compare(String(password), user.password);
        }
      }

      if (!passwordValid) {
        // Match legacy PHP behaviour for incorrect credentials:
        // response('error', $response['message'], 'incorrect', 404);

        /* Same message as the unknown-user case above. The distinction is
           recorded server-side, including whether this account's password was
           changed recently, which is the single most useful fact when
           somebody says "it worked yesterday". */
        await this.recordFailedLogin(req, loginId, 'bad_password', user);
        return res.status(404).json({
          type: 'error',
          message: LOGIN_FAILED_MESSAGE,
          data: 'incorrect',
        });
      }

      // Check if user is active
      if (user.activate !== true) {
        return res.status(403).json({
          type: 'error',
          message: 'Your account is inactive. Please contact administrator.',
          data: 'inactive',
        });
      }

      // Users saved before the explicit POS matrix shipped have no access.pos
      // (fail-open at the till). Stamp it once here from their role/usertype so
      // till gating is explicit for everyone. Never blocks a login.
      if (user.access && !user.access.pos) {
        try {
          user.access = await this.userModel.backfillPosAccess(user);
        } catch (backfillErr) {
          console.error('POS backfill skipped at login:', backfillErr.message);
        }
      }

      const branchAccess = Array.isArray(user.branch_access) ? user.branch_access : [];
      if (branchAccess.length === 0) {
        // Match legacy PHP behaviour for users without any branch:
        // response('error', 'User Have not Any Branch', $response['data'], 404);
        return res.status(404).json({
          type: 'error',
          message: 'User Have not Any Branch',
          data: null,
        });
      }

      // Store user id in session for PHP-style primary auth
      if (req.session) {
        req.session.userId = user._id.toString();
        // Reset outstandingCustomersModal flag on login so modal shows every time
        req.session.outstandingCustomersModal = false;
      }

      // Build branch condition list and find the last branchId (matches PHP behaviour)
      const branchCondition = [];
      let branchId = '';
      for (const data of branchAccess) {
        if (data.branch_id) {
          branchCondition.push({ _id: data.branch_id });
          branchId = data.branch_id;
        }
      }

      // Store branch_id in session (PHP-style)
      if (req.session && branchId) {
        req.session.branch_id = String(branchId);
      }

      // Load branch details for the user based on license and branch access
      let checkUserBranch = null;
      if (branchCondition.length > 0 && user.license) {
        try {
          checkUserBranch = await Branch.findOne({
            license: user.license,
            $or: branchCondition,
          }).lean();
        } catch (err) {
          console.warn('Unable to load branch:', err.message);
        }
      }

      if (!checkUserBranch) {
        return res.status(404).json({
          type: 'error',
          message: "User don't have valid branch. Please contact Administrator",
          data: null,
        });
      }

      // Persist the authenticated session before the browser starts the next
      // request from the login success callback. With a Mongo-backed session
      // store, relying only on the response-end hook can race the immediate
      // /users/userBranchSelection request and make it appear anonymous.
      if (req.session) {
        req.session.userId = user._id.toString();
        req.session.selectedBranchId = String(branchId);
        req.session.branch_id = String(branchId);
        req.session.branch_name = String(checkUserBranch.branch_name || '').trim();
        req.session.license = String(user.license);

        if (typeof req.session.save === 'function') {
          await new Promise((resolve, reject) => {
            req.session.save((error) => (error ? reject(error) : resolve()));
          });
        }
      }

      // Check for actual open register in cashregister collection
      let actualRegisterStatus = 'Closed';
      try {
        const mongoose = require('mongoose');
        const db = currentConnection(mongoose.connection).db;
        const cashregisterCollection = db.collection('cashregister');

        const openRegister = await cashregisterCollection.findOne({
          current_user_id: user._id,
          branch_id: branchId,
          register_status: 'Opened',
          license: user.license,
        });

        if (openRegister) {
          actualRegisterStatus = 'Opened';
        }
      } catch (err) {
        console.warn('Unable to check cashregister status:', err.message);
      }

      // Get outstanding customers data for modal on login
      let outstandingCustomers = [];
      try {
        const mongoose = require('mongoose');
        const db = currentConnection(mongoose.connection).db;
        const transactionCollection = db.collection('transaction');
        const { ObjectId } = require('mongodb');

        const pipeline = [
          {
            $match: {
              branch_id: new ObjectId(branchId),
              license: new ObjectId(user.license),
            },
          },
          {
            $group: {
              _id: {
                customer_id: '$customer_id',
                customer_name: '$customer_name',
              },
              totalInAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] },
              },
              totalOutAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] },
              },
              totalPendingAmount: { $sum: '$pending' },
            },
          },
          {
            $addFields: {
              totalAmountDue: { $subtract: ['$totalInAmount', '$totalOutAmount'] },
            },
          },
          {
            $addFields: {
              due: {
                $cond: [
                  {
                    $and: [{ $lt: ['$totalAmountDue', 0] }, { $gte: ['$totalPendingAmount', 0] }],
                  },
                  {
                    $round: [{ $add: ['$totalPendingAmount', { $abs: '$totalAmountDue' }] }, 2],
                  },
                  { $round: ['$totalPendingAmount', 2] },
                ],
              },
            },
          },
          {
            $match: {
              $or: [{ due: { $gt: 0 } }],
            },
          },
          { $sort: { updated_date: -1 } },
          { $limit: 4 },
        ];

        const aggregateAmount = await transactionCollection.aggregate(pipeline).toArray();

        // Check session for outstandingCustomersModal flag (PHP: $_SESSION['PosnicPro']['outstandingCustomersModal'] ?? false)
        const outstandingCustomersModal = req.session?.outstandingCustomersModal ?? false;

        outstandingCustomers = aggregateAmount.map((doc) => ({
          id: doc._id?.customer_id || '',
          name: doc._id?.customer_name || '',
          wallet: Number(
            (typeof doc.totalAmountDue === 'number' ? doc.totalAmountDue : 0).toFixed(2)
          ),
          pending: Number(
            (typeof doc.totalPendingAmount === 'number' ? doc.totalPendingAmount : 0).toFixed(2)
          ),
          due: Number((typeof doc.due === 'number' ? doc.due : 0).toFixed(2)),
          outstandingCustomersModal: outstandingCustomersModal,
        }));

        // Set session flag to true after first display (PHP: $_SESSION['PosnicPro']['outstandingCustomersModal'] = true)
        if (req.session && outstandingCustomers.length > 0) {
          req.session.outstandingCustomersModal = true;
        }
      } catch (err) {
        console.warn('Unable to fetch outstanding customers:', err.message);
      }

      // Build response payload mirroring PHP responseUserData()
      let userACLPlan = true;
      if (user.access && user.access.plan && typeof user.access.plan.read === 'boolean') {
        userACLPlan = user.access.plan.read;
      }

      const param = {
        sid: String(user._id),
        usertype: user.usertype,
        firstname: user.firstname,
        lastname: user.lastname,
        user_name: user.username,
        user_image: user.image,
        register_status: actualRegisterStatus,
        branch_image: checkUserBranch.logo,
        branch_name: checkUserBranch.branch_name,
        branch_phone: checkUserBranch.store_telephone,
        branch_email: checkUserBranch.store_email,
        branch_address: checkUserBranch.store_address,
        branch_timezone: checkUserBranch.time_zone,
        branch_timeformat: checkUserBranch.time_format || 'enable',
        currency_type: checkUserBranch.currency_type,
        branchCount: branchAccess.length,
        branchId: String(branchId),
        print_type: user.printing_design,
        plan: user.plan && user.plan.name ? user.plan.name : 'free',
        userACLPlan,
        outstanding_customers: outstandingCustomers,
      };

      // Log staff activity (PHP: changeUserLog in setSettings)
      BaseModel.changeUserLog(
        user._id,
        user.username || `${user.firstname || ''} ${user.lastname || ''}`.trim(),
        new Date(),
        branchId,
        checkUserBranch.branch_name || '',
        user.license,
        {
          userAgent: req.headers['user-agent'] || '',
          ip:
            req.ip ||
            req.connection?.remoteAddress ||
            req.headers['x-forwarded-for']?.split(',')[0] ||
            'unknown',
        }
      ).catch((err) => console.warn('changeUserLog failed:', err.message));

      // Generate legacy-style JWT payload that includes encrypted session_id,
      // mirroring the PHP behaviour for JWT tokens used by the legacy frontend.
      const token = signLegacyToken(user, req);
      const days = process.env.JWT_COOKIE_EXPIRES_IN
        ? parseInt(process.env.JWT_COOKIE_EXPIRES_IN)
        : 7;
      res.cookie(
        'jwt',
        token,
        authCookieOptions({
          expires: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        })
      );

      // Also include the legacy token in the response body for Electron client usage
      param.jwt_token = token;

      // Create or update session record in user_sessions collection (PHP-style logic)
      try {
        require('mongodb');
        const mongoClient = req.app.locals.mongoClient;

        if (mongoClient) {
          const dbName = process.env.MONGODB_URI?.split('/')?.pop()?.split('?')[0] || 'PosnicPro';
          const db = mongoClient.db(dbName);
          const userSessionsCollection = db.collection('user_sessions');

          // Check if user has sales.session_filter permission (PHP logic)
          const hasSessionFilterPermission = user.access?.sales?.session_filter === true;

          if (!hasSessionFilterPermission) {
            console.log(
              '⚠️ User does not have session filter permission - skipping session record creation'
            );
            // Skip session record creation for users without permission
          } else {
            // Check if user already has an active session (logout_time: null, is_active: true)
            const existingSession = await userSessionsCollection.findOne({
              user_id: user._id,
              logout_time: null,
              is_active: true,
            });

            const currentTime = new Date();

            if (existingSession) {
              // User has existing active session - update it (PHP behavior)
              console.log('📋 Found existing active session, updating...');
              console.log('📋 Original login time:', existingSession.login_time);

              const updateResult = await userSessionsCollection.updateOne(
                { _id: existingSession._id },
                {
                  $set: {
                    session_id: req.sessionID,
                    license: user.license,
                    branch_id: branchId,
                    ip_address: clientIp(req),
                    user_agent: req.get('User-Agent'),
                    updated_date: currentTime,
                  },
                }
              );

              if (updateResult.modifiedCount > 0) {
              } else {
              }
            } else {
              // No existing session - create new one
              console.log('📋 No existing session found, creating new...');

              const sessionRecord = {
                user_id: user._id,
                user_name: user.username || user.firstname,
                session_id: req.sessionID,
                login_time: currentTime,
                logout_time: null,
                is_active: true,
                created_date: currentTime,
                updated_date: currentTime,
                license: user.license,
                branch_id: branchId,
                ip_address: clientIp(req),
                user_agent: req.get('User-Agent'),
              };

              const insertResult = await userSessionsCollection.insertOne(sessionRecord);

              if (insertResult.insertedId) {
              } else {
              }
            }
          } // Close the else block for session filter permission
        } else {
        }
      } catch (sessionError) {
        console.error('❌ Error managing session record:', sessionError.message);
      }

      return res.status(200).json({
        type: 'success',
        message: 'Successfully login',
        data: param,
      });
    } catch (error) {
      // PHP: catch (Exception $e) { $response = ['status' => false, 'data' => null, 'message' => $e->getMessage()]; }
      console.error('Error in UsersController.legacyVerifyLogin:', error);
      return res.status(404).json({
        type: 'error',
        message: error.message || 'An error occurred',
        data: null,
      });
    }
  }

  async verify(req, res, next) {
    return this.legacyVerifyLogin(req, res, next);
  }

  async logOut(req, res) {
    try {
      console.log('🔥 LOGOUT METHOD CALLED!');
      console.log('🔥 Request URL:', req.url);
      console.log('🔥 Request method:', req.method);

      // Update session record in database
      try {
        require('mongodb');
        const mongoClient = req.app.locals.mongoClient;

        if (mongoClient) {
          const dbName = process.env.MONGODB_URI?.split('/')?.pop()?.split('?')[0] || 'PosnicPro';
          const db = mongoClient.db(dbName);
          const userSessionsCollection = db.collection('user_sessions');

          // Find and update active session for this user
          const logoutTime = new Date();
          let sessionUpdated = false;

          // Try to find session by user_id if available
          if (req.user?._id) {
            const updateResult = await userSessionsCollection.updateOne(
              {
                user_id: req.user._id,
                logout_time: null,
                is_active: true,
              },
              {
                $set: {
                  logout_time: logoutTime,
                  is_active: false,
                  updated_date: logoutTime,
                },
              }
            );

            sessionUpdated = updateResult.modifiedCount > 0;
          }

          // If not found by user_id, try by session ID
          if (!sessionUpdated && req.sessionID) {
            const updateResult = await userSessionsCollection.updateOne(
              {
                session_id: req.sessionID,
                logout_time: null,
                is_active: true,
              },
              {
                $set: {
                  logout_time: logoutTime,
                  is_active: false,
                  updated_date: logoutTime,
                },
              }
            );

            sessionUpdated = updateResult.modifiedCount > 0;
          }

          // If still not found, try any active session
          if (!sessionUpdated) {
            const updateResult = await userSessionsCollection.updateMany(
              {
                logout_time: null,
                is_active: true,
              },
              {
                $set: {
                  logout_time: logoutTime,
                  is_active: false,
                  updated_date: logoutTime,
                },
              }
            );

            sessionUpdated = updateResult.modifiedCount > 0;
          }

          if (sessionUpdated) {
          } else {
            console.log('⚠️ No active session found to update');
          }
        } else {
        }
      } catch (dbError) {
        console.error('❌ Error updating session record:', dbError.message);
      }

      // Destroy Express session
      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            console.error('❌ Error destroying Express session:', err);
          } else {
          }
        });
      }

      // Clear JWT cookie
      res.clearCookie('jwt', authCookieOptions());

      return res.status(200).json({
        type: 'success',
        message: 'User logout successfully',
        data: null,
      });
    } catch (error) {
      console.error('Error in UsersController.logOut:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * Verify user token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async verifyToken(req, res, next) {
    try {
      // If we reach here, the token is valid (validated by auth middleware)
      res.status(httpStatus.OK).json({
        status: 'success',
        data: {
          user: req.user,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Legacy endpoint: GET /users/userBranchSelection
   * Returns the list of branches the current user can access,
   * compatible with the original PHP API shape.
   *
   * This is called after successful authentication to show the branch selection UI.
   */
  async userBranchSelection(req, res) {
    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const user = await this.userModel
        .findById(req.user._id)
        .select('+branch_access +printing_design')
        .lean();

      if (!user) {
        return res.status(404).json({
          type: 'error',
          message: 'User not found',
          data: null,
        });
      }

      const branchAccess = Array.isArray(user.branch_access) ? user.branch_access : [];
      const printingDesign = Array.isArray(user.printing_design) ? user.printing_design : [];

      if (!branchAccess.length) {
        return res.status(200).json({
          type: 'success',
          message: 'No branches available for this user',
          data: { branch_id: [] },
        });
      }

      const branches = branchAccess.map((entry) => {
        const branchId = String(entry.branch_id || '');
        const design = printingDesign.find((p) => String(p.branch_id) === branchId);

        return {
          branch_access: branchId,
          branch_name: entry.branch_name || '',
          branch_image: entry.branch_image || 'store.png',
          printing_design: design?.printing_design || 'standard',
          printing_max_char: design?.printing_max_char || 'default',
        };
      });

      return res.status(200).json({
        type: 'success',
        message: 'success',
        data: {
          branch_id: branches,
        },
      });
    } catch (error) {
      console.error('Error in UsersController.userBranchSelection:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load branches. Please try again later.',
        data: {
          error: error.message,
          stack: error.stack,
        },
      });
    }
  }

  /**
   * Legacy endpoint: GET /users/getUserAccessDetails
   * Returns the legacy ACL/access document for the current user.
   */
  async getUserAccessDetails(req, res) {
    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const user = await this.userModel.findById(req.user._id).lean();

      if (!user) {
        return res.status(404).json({
          type: 'error',
          message: 'User not found',
          data: null,
        });
      }

      const access = user.access || {};

      if (!access.plan || typeof access.plan !== 'object') {
        access.plan = { read: true, write: false, delete: false };
      } else if (typeof access.plan.read !== 'boolean') {
        access.plan.read = true;
      }

      return res.status(200).json({
        type: 'success',
        message: 'successfully loaded',
        data: access,
      });
    } catch (error) {
      console.error('Error in UsersController.getUserAccessDetails:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load user access details. Please try again later.',
        data: {
          error: error.message,
          stack: error.stack,
        },
      });
    }
  }

  /**
   * Legacy endpoint: GET /users/getUserRegisterList
   * Returns registers associated with the current branch.
   */
  async getUserRegisterList(req, res) {
    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const user = await this.userModel
        .findById(req.user._id)
        .select('+branch_access +default_branch_id +branch')
        .lean();

      const branchAccess = Array.isArray(user?.branch_access) ? user.branch_access : [];

      const branchId =
        req.query?.branch ||
        user?.default_branch_id ||
        user?.branch?.toString?.() ||
        branchAccess[0]?.branch_id ||
        req.user.branch_id ||
        null;

      let registerData = [];

      // Try to find branch and get registers
      if (branchId) {
        try {
          const branch = await (
            req.tenantContext
              ? Branch.findOne({ _id: branchId, license: req.tenantContext.licenseId })
              : Branch.findById(branchId)
          ).lean();

          if (branch && Array.isArray(branch.register) && branch.register.length > 0) {
            registerData = branch.register.map((register) => ({
              register_id: register.register_id?.toString?.() || register.id?.toString?.() || '',
              register_name: register.register_name || '',
            }));
          }
        } catch (branchError) {}
      }

      // If no registers found, try to get any branch with registers
      if (registerData.length === 0) {
        try {
          const anyBranch = await Branch.findOne({
            'register.0': { $exists: true },
          }).lean();

          if (anyBranch && Array.isArray(anyBranch.register)) {
            registerData = anyBranch.register.map((register) => ({
              register_id: register.register_id?.toString?.() || register.id?.toString?.() || '',
              register_name: register.register_name || '',
            }));
          }
        } catch (fallbackError) {}
      }

      // If still no registers, return empty array
      // Frontend should handle the empty case and not make API calls
      return res.status(200).json({
        type: 'success',
        message: registerData.length === 0 ? 'No registers found' : 'success',
        data: registerData,
      });
    } catch (error) {
      console.error('Error in UsersController.getUserRegisterList:', error);
      return res.status(500).json({
        type: 'error',
        message: 'Unable to load register list. Please try again later.',
        data: {
          error: error.message,
          stack: error.stack,
        },
      });
    }
  }

  async userDefaultBranchSet(req, res) {
    try {
      const { id } = req.query;

      if (!id) {
        return this.error(res, 'Branch id is required', 400);
      }

      const hasBranchAccess =
        Array.isArray(req.user?.branch_access) &&
        req.user.branch_access.some((entry) => String(entry.branch_id) === String(id));
      if (!hasBranchAccess) {
        return this.error(res, 'You do not have access to the selected branch', 403);
      }

      const usersService = require('../services/user.service');
      const licenseId = req.tenantContext?.licenseId || req.user?.license;
      const result = await usersService.changeBranch(id, req.user?._id, licenseId);

      if (result.status === true) {
        const activeTenant = await persistActiveTenant(req, result.data, licenseId);

        // Log staff activity (PHP: changeUserLog in setSettings)
        BaseModel.changeUserLog(
          req.user._id,
          req.user.username || `${req.user.firstname || ''} ${req.user.lastname || ''}`.trim(),
          new Date(),
          result.data.branch_id,
          result.data.branch_name || '',
          activeTenant.licenseId,
          {
            userAgent: req.headers['user-agent'] || '',
            ip: clientIp(req),
          }
        ).catch((err) => console.warn('changeUserLog failed:', err.message));

        return this.success(res, result.data, 'branch choose successfully');
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in UsersController.userDefaultBranchSet:', error);
      return this.error(res, 'Unable to set default branch. Please try again later.', 500);
    }
  }

  /**
   * Get all users with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAll(req, res) {
    try {
      const limit =
        req.query.limit && parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = req.query.page && parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      let filters = {};

      // Parse filters if provided
      if (req.query.filters) {
        try {
          filters = JSON.parse(req.query.filters);
          // Convert date strings to Date objects if needed is handled by assignObj in model or we do it here if needed
          // userPage/assignFilterObjects in model handles type conversion if model has schema definition
        } catch (err) {
          return this.error(res, 'Incorrect format of filter', 404);
        }
      }

      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const options = {
        limit: limit,
        page: page,
        sort: { _id: -1 },
      };

      // Context for model method (mimics PHP static properties)
      const context = {
        // The selected session branch is the application's current branch.
        // req.user.branch_id can still contain the branch that was active when
        // the token was issued, so using it first can leak users from a
        // previously selected branch.
        currentBranch:
          req.tenantContext?.branchId ||
          req.session?.selectedBranchId ||
          req.session?.branch_id ||
          req.headers['x-branch-id'] ||
          req.user.branch_id,
        license: req.tenantContext?.licenseId || req.user.license,
        user: req.user,
      };

      const result = await this.userModel.userPage(filters, options, context);

      if (result.status === true) {
        // Apply MongoIDFilter to list (converts ObjectIds to {$oid} format)
        if (result.data && result.data.list) {
          result.data.list = this.mongoIDFilter(result.data.list);

          // Convert top-level _id to plain string for each user in list
          // Frontend uses _id directly as URL parameter, so it must be a string
          result.data.list = result.data.list.map((user) => {
            if (user._id && user._id.$oid) {
              return { ...user, _id: user._id.$oid };
            }
            return user;
          });
        }

        return this.success(res, result.data, result.message, 200);
      } else {
        return this.error(res, 'Details Not Found', 404, result.data);
      }
    } catch (error) {
      console.error('Error in getAll users:', error);
      return this.error(res, 'Failed to retrieve users: ' + error.message, 500);
    }
  }

  /**
   * Get a single user by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getOne(req, res) {
    try {
      const userId = this.extractObjectId(req.params.id || req.query.id);

      if (!userId) {
        return this.error(res, 'User ID is required', 400);
      }

      // Validate ObjectId format
      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        return this.error(res, 'Invalid User ID format', 400);
      }

      // A user may always fetch their OWN record (My Profile) even without the
      // user-management read permission; otherwise it needs user.read.
      const isSelf = String(req.user && req.user._id) === String(userId);
      if (!isSelf && !this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const user = await this.userModel.findById(userId).lean();

      if (!user) {
        return this.error(res, 'User Not Found', 404);
      }

      // Ensure defaults for arrays that might be missing in lean() or legacy data
      if (!user.registers) user.registers = [];
      if (!user.branch_access) user.branch_access = [];

      const filteredUser = this.mongoIDFilter(user);

      // Convert top-level _id to plain string for frontend compatibility
      if (filteredUser._id && filteredUser._id.$oid) {
        filteredUser._id = filteredUser._id.$oid;
      }

      return this.success(res, filteredUser, 'success');
    } catch (error) {
      console.error('Error in UsersController.getOne:', error);
      return this.error(res, 'Failed to retrieve user: ' + error.message, 500);
    }
  }

  /**
   * Update a user
   * Matches PHP users.php edit() which calls add(true, $id)
   * PHP: public function edit() { $id = $GLOBALS['input']['get']['id']; if (isset($id)) { $this->add(true, $id); } }
   */
  async edit(req, res) {
    try {
      // PHP: $id = $GLOBALS['input']['get']['id']; (from URL params)
      const id = req.params.id || req.query.id;

      if (!id) {
        return this.error(res, 'User ID is required', 400);
      }

      // PHP: if ($_SESSION['PosnicPro']['user_id'] === $id) { response('error', 'Unauthorized', null, 401); }
      // Note: PHP checks if trying to edit yourself and returns error, but this seems like a bug
      // The actual logic in userInsertUpdate allows editing yourself with special handling
      // So we skip this check and let add() handle it properly

      // PHP: $this->add(true, $id);
      return await this.add(req, res, true, id);
    } catch (error) {
      console.error('Error in UsersController.edit:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Update user password
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updatePassword(req, res) {
    try {
      const { currentPassword, newPassword, newPasswordConfirm } = req.body;

      // 1) Check if user exists and password is correct
      const user = await this.userModel.findById(req.user._id).select('+password');

      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return this.error(res, 'Your current password is incorrect', 403);
      }

      // 2) Check if new passwords match
      if (newPassword !== newPasswordConfirm) {
        return this.error(res, 'New passwords do not match', 400);
      }

      // 3) Update password
      user.password = newPassword;
      user.passwordChangedAt = Date.now() - 1000; // Ensure token is issued after password change
      await user.save();

      // 4) Log user in, send JWT
      createSendToken(user, 200, res);
    } catch (error) {
      console.error('Error in UsersController.updatePassword:', error);
      return this.error(res, 'Failed to update password: ' + error.message, 500);
    }
  }

  /**
   * Delete users (bulk support)
   * Matches PHP users.php delete() and user_model.php deleteUserCollectionData()
   */
  async delete(req, res) {
    try {
      // In JS, delete is usually by ID in params, but legacy might send body with array of IDs
      // PHP: $GLOBALS['input']['json']['data'] is array of IDs
      let ids = [];
      if (req.params.id) {
        ids = [req.params.id];
      } else if (req.body.data && Array.isArray(req.body.data)) {
        ids = req.body.data;
      } else if (req.query.id) {
        ids = [req.query.id];
      }

      if (ids.length === 0) {
        return this.error(res, 'UID is missing', 400);
      }

      if (!this.checkPermission('user', 'delete', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const userType = req.user._id.toString();
      const baseModel = new BaseModel('users');
      const user = req.user || {};

      // Set BaseModel context for backup
      const sessionBranchId =
        req.session?.selectedBranchId ||
        req.session?.branch_id ||
        user.branch_id ||
        user.branch?._id;
      if (sessionBranchId) {
        BaseModel.currentBranch = ObjectId.isValid(sessionBranchId)
          ? new ObjectId(sessionBranchId)
          : sessionBranchId;
      }

      const branchName = user.branch_name || user.branch?.branch_name || '';
      if (branchName) {
        BaseModel.currentBranchName = branchName;
      }

      if (user.license || user.license_id) {
        const license = user.license || user.license_id;
        BaseModel.license = ObjectId.isValid(license) ? new ObjectId(license) : license;
      }

      if (user._id) {
        BaseModel.loggedUser = ObjectId.isValid(user._id) ? new ObjectId(user._id) : user._id;
        BaseModel.loggedUserName = user.name || user.username || user.email || '';
      }

      // Verify users to delete
      for (const id of ids) {
        if (req.user.usertype === 'super_admin' || userType === id) {
          if (id === userType) {
            return this.error(res, 'You cannot delete your own account', 400);
          }
        }
      }

      const objectIds = ids.map((id) => new ObjectId(id));

      const condition = {
        _id: { $in: objectIds },
        license: req.user.license,
      };

      // Backup documents
      const usersToDelete = await this.userModel.find(condition).lean();
      for (const userDoc of usersToDelete) {
        await BaseModel.deletedDocumentBackup('users', userDoc);
        await baseModel.changeLog('users', req.user._id, userDoc._id, 'delete');
      }
      // Delete documents
      const deleteResult = await this.userModel.deleteMany(condition);

      if (deleteResult.deletedCount > 0) {
        return this.success(res, deleteResult.deletedCount, 'User deleted successfully', 200);
      } else {
        return this.error(res, 'User deleted unsuccessfully', 404);
      }
    } catch (error) {
      console.error('Error in UsersController.delete:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get user status report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async userstatusReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle branch parameter - can come as 'branch' or 'branch[]'
      let branchIds = req.query.branch || req.query['branch[]'] || [];
      if (!Array.isArray(branchIds)) {
        branchIds = [branchIds];
      }

      const data = {
        branchid: branchIds,
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
        user_id: req.query.field_input || '',
        license: req.user?.license || '',
      };

      // Apply session filtering if user has permission and dates are provided
      if (data.starting_date || data.ending_date) {
        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        // Update data with filtered dates
        data.starting_date = filteredDateRange.start_date;
        data.ending_date = filteredDateRange.end_date;
      } else {
      }

      // Call the model method to get report data
      const result = await this.userModel.userstatusReportPage(data, options);
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in UsersController.userstatusReportTable:', error);
      return this.error(res, 'Failed to retrieve user status report: ' + error.message, 500);
    }
  }

  /**
   * Filter MongoDB ObjectIDs to PHP BSON format {$oid: "string"}
   * Frontend expects: val.branch_id.$oid format
   * Converts ObjectIds and ObjectId-like strings to {$oid: "string"} format
   * @param {Array|Object} data - Array of documents or single document to filter
   * @returns {Array|Object} - Filtered data with ObjectIDs in {$oid: "string"} format
   */
  mongoIDFilter(data) {
    const convertObjectId = (value) => {
      if (!value) return value;

      // Check if it's a MongoDB ObjectId - convert to {$oid: "string"}
      if (
        value.constructor &&
        (value.constructor.name === 'ObjectID' || value.constructor.name === 'ObjectId')
      ) {
        return { $oid: value.toString() };
      }

      // Check if it's a string that looks like an ObjectId (24 hex chars)
      if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) {
        return { $oid: value };
      }

      // Already in {$oid: "string"} format
      if (value && typeof value === 'object' && value.$oid) {
        return value;
      }

      return value;
    };

    const processValue = (value) => {
      if (!value) return value;

      // Handle ObjectId conversion
      const converted = convertObjectId(value);
      if (converted && converted.$oid) return converted;

      // Handle arrays
      if (Array.isArray(value)) {
        return value.map((item) => processValue(item));
      }

      // Handle nested objects (but not {$oid} objects)
      if (typeof value === 'object' && !value.$oid && value.constructor.name === 'Object') {
        const processed = {};
        Object.keys(value).forEach((k) => {
          processed[k] = processValue(value[k]);
        });
        return processed;
      }

      return value;
    };

    if (!Array.isArray(data)) {
      // Handle single object
      if (!data || typeof data !== 'object') return data;

      const filtered = {};
      Object.keys(data).forEach((key) => {
        filtered[key] = processValue(data[key]);
      });

      // Convert top-level _id
      if (data._id) {
        filtered._id = convertObjectId(data._id);
      }

      return filtered;
    }

    // Handle array
    return data.map((item) => {
      if (!item || typeof item !== 'object') return item;

      const filtered = {};
      Object.keys(item).forEach((key) => {
        filtered[key] = processValue(item[key]);
      });

      // Convert top-level _id
      if (item._id) {
        filtered._id = convertObjectId(item._id);
      }

      return filtered;
    });
  }

  /**
   * Filter MongoDB dates to ISO strings (similar to PHP MongoDateFilter)
   * @param {Array} data - Array of documents to filter
   * @returns {Array} - Filtered array with dates converted to ISO strings
   */
  mongoDateFilter(data) {
    if (!Array.isArray(data)) return data;

    return data.map((item) => {
      const filtered = { ...item };
      Object.keys(filtered).forEach((key) => {
        if (filtered[key] instanceof Date) {
          filtered[key] = filtered[key].toISOString();
        }
      });
      return filtered;
    });
  }

  /**
   * PHP: getUserDetails()
   * Get user details without permission check
   * Calls getOne with access='no' to bypass permission check
   */
  async getUserDetails(req, res) {
    try {
      const rawId = req.query.id || req.params.id;

      const id = this.extractObjectId(rawId);

      if (!id) {
        return this.error(res, 'User Id Not Found', 400);
      }

      // Validate ObjectId format
      if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        return this.error(res, 'Invalid User ID format', 400);
      }

      // PHP: calls $this->getOne('no') which bypasses permission check
      // Use viewUserGet model method to match PHP behavior exactly
      // PHP includes apikey (line 19: 'select' => true) but excludes password, created_by, created_by_id, updated_by, updated_by_id, license
      const user = await this.userModel
        .findById(id)
        .select('-password -created_by -created_by_id -updated_by -updated_by_id -license')
        .lean();

      if (!user) {
        return this.error(res, 'User Not Found', 404);
      }

      // Ensure defaults for arrays that might be missing in lean() or legacy data
      if (!user.registers) user.registers = [];
      if (!user.branch_access) user.branch_access = [];

      // Apply MongoIDFilter to convert ObjectIds to PHP BSON format (PHP compatibility)
      const filteredUser = this.mongoIDFilter(user);

      // Convert top-level _id to plain string for frontend compatibility
      // Frontend uses this _id directly as URL parameter, so it must be a string
      if (filteredUser._id && filteredUser._id.$oid) {
        filteredUser._id = filteredUser._id.$oid;
      }

      return this.success(res, filteredUser, 'success');
    } catch (error) {
      console.error('Error in getUserDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getDataChanges()
   * Get data changes for synchronization
   */
  async getDataChanges(req, res) {
    try {
      const from = req.query.from || '';
      // UserModel is what this file imports; there is no User here. getDataChanges
      // is a schema static, so it is called on the model itself.
      const result = await UserModel.getDataChanges('users', from);

      if (result.status === true) {
        return this.success(res, result.data, 'Changes Retrieved');
      } else {
        return this.error(res, 'Not valid Input', 200, result.data);
      }
    } catch (error) {
      console.error('Error in getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportUsers()
   * Export users data - returns JSON with selected user details
   */
  async exportUsers(req, res) {
    try {
      // PHP line 500: Check permission
      if (!this.checkPermission('user', 'read', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      // PHP line 502: Get IDs from request body ($GLOBALS['input']['json'])
      const id = req.body;

      // PHP line 503: Call model method
      const response = await UserModel.exportUserOrder(id, req.user.license);

      // PHP lines 504-508: Return appropriate response
      if (response.status === true) {
        return this.success(res, response.data, response.message, 200);
      } else {
        return this.error(res, response.message || 'Users exported unsuccessfully', 404);
      }
    } catch (error) {
      console.error('Error in exportUsers:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getUserAjaxList()
   * Ajax autocomplete list for users
   */
  async getUserAjaxList(req, res) {
    try {
      const query = req.query.query || '';

      if (!query || query.length < 2) {
        return this.success(res, { query, suggestions: [] }, 'Enter at least 2 characters');
      }

      // UserModel is what this file imports; User does not exist here, so this
      // threw ReferenceError on every call. UserModel is a Mongoose model, so
      // the select/limit/lean chain below works unchanged.
      const users = await UserModel.find({
        $or: [
          { name: { $regex: searchPattern(query), $options: 'i' } },
          { username: { $regex: searchPattern(query), $options: 'i' } },
          { email: { $regex: searchPattern(query), $options: 'i' } },
        ],
        status: 'active',
      })
        .select('name username email')
        .limit(20)
        .lean();

      const suggestions = users.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
      }));

      return this.success(res, { query, suggestions }, 'Users retrieved successfully');
    } catch (error) {
      console.error('Error in getUserAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: uploadUserImage()
   * Upload user profile image
   */
  async uploadUserImage(req, res) {
    try {
      const fs = require('fs');
      const path = require('path');

      // If no file uploaded, return default image (matches PHP line 557-560)
      if (!req.file || !req.file.originalname) {
        return this.success(res, 'user.svg', 'Image uploaded successfully');
      }

      // Validate file extension (matches PHP line 554-556)
      const allowedExtensions = [
        'gif',
        'GIF',
        'jpg',
        'JPG',
        'png',
        'PNG',
        'jpeg',
        'JPEG',
        'bmp',
        'BMP',
      ];
      const fileExtension = path.extname(req.file.originalname).substring(1);

      if (!allowedExtensions.includes(fileExtension)) {
        return this.error(
          res,
          'Upload valid images. Only GIF, PNG, JPG, JPEG and BMP are allowed.',
          400
        );
      }

      // Validate file size - max 5MB (matches PHP line 574-576)
      if (req.file.size > 5242880) {
        return this.error(res, 'Image size exceeds 5MB', 400);
      }

      // Generate unique filename (matches PHP line 564-566)
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const uniqueId = Math.random().toString(36).substring(2, 15);
      const filename = `${timestamp}-posnic_user-${uniqueId}.${fileExtension}`;

      // Check storage type
      const storageType = process.env.STORAGE_TYPE || 'local';

      if (storageType === 's3') {
        // S3 upload (matches PHP line 578-590)
        try {
          // No ACL: the bucket has ACLs disabled and rejects any PutObject
          // that carries one. Public readability is the bucket policy's call.
          const result = await require('../utils/s3').uploadObject({
            key: filename,
            filePath: req.file.path,
            contentType: req.file.mimetype,
          });
          // Delete temp file after S3 upload
          fs.unlinkSync(req.file.path);
          return this.success(res, result.Location, 'Image uploaded successfully');
        } catch (error) {
          return this.error(res, error.message, 404);
        }
      } else {
        // Local storage (matches PHP line 592-599)
        const uploadDir = path.join(__dirname, '../../uploads/user_images/');

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const targetPath = path.join(uploadDir, filename);

        try {
          // Move file from temp location to target
          fs.renameSync(req.file.path, targetPath);

          // Build a public URL for the uploaded image using either an
          // explicit CLI_HOST override or the current request host.
          // This mirrors the behaviour in categories.controller and
          // avoids hard-coding localhost:5000, which breaks when the
          // API is served from a different port.
          const base =
            (process.env.CLI_HOST && process.env.CLI_HOST.trim()) ||
            `${req.protocol}://${req.get('host')}`;
          const normalizedBase = base.replace(/\/+$/, '');
          const imageUrl = `${normalizedBase}/uploads/user_images/${filename}`;

          return this.success(res, imageUrl, 'Image uploaded successfully');
        } catch (error) {
          return this.error(res, 'Image not uploaded', 404);
        }
      }
    } catch (error) {
      console.error('Error in uploadUserImage:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Validate that an extracted S3 key is a legitimate Posnic user-image filename.
   * Must match format generated by uploadUserImage():
   *   YYYY-MM-DDTHH-mm-ss-posnic_user-{randomId}.{extension}
   *
   * Examples accepted:
   *   - 2025-12-25T14-30-45-posnic_user-abc123.jpg ✓
   *   - 2025-09-02T15-22-08-posnic_user-k9j8l7m6n5.png ✓
   *
   * Examples rejected:
   *   - backups/2025-12-25T14-30-45-posnic_user-abc123.jpg ✗ (contains /)
   *   - user.svg ✗ (doesn't match pattern)
   *   - arbitrary.jpg ✗ (no -posnic_user- marker)
   *   - 2025-12-25T14-30-45-posnic_category-abc123.jpg ✗ (wrong marker)
   *
   * @param {string} key - The S3 key or bare filename to validate
   * @returns {boolean} True if valid Posnic user-image filename, false otherwise
   */
  isValidPosnicUserImageFilename(key) {
    if (!key || typeof key !== 'string') return false;
    if (key.includes('/') || key.includes('\\')) return false;

    // Match: YYYY-MM-DDTHH-mm-ss-posnic_user-{2-15 alphanumeric chars}.{extension}
    const userImagePattern =
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-posnic_user-[a-z0-9]{2,15}\.(gif|jpg|png|jpeg|bmp)$/i;
    return userImagePattern.test(key);
  }

  /**
   * PHP: userImageDelete()
   * Delete user profile image
   */
  async userImageDelete(req, res) {
    try {
      const requestedImageUrl = req.body.data;
      const bodyUserId = req.body.id;

      // Resolve the target user ID from body or authenticated request
      const userId =
        (bodyUserId && String(bodyUserId).trim()) || (req.user && (req.user._id || req.user.id));

      if (!userId) {
        return this.error(res, 'No user identified', 401);
      }

      /*
       * The rule getUser already uses: your own picture is always yours to
       * remove, anybody else's needs the user-management permission. Without
       * it the id simply arrives in the body and is obeyed, which was
       * survivable while this only reset a database field and is not now that
       * it destroys the file in the bucket.
       */
      const isSelf = String(req.user && (req.user._id || req.user.id)) === String(userId);
      if (!isSelf && !this.checkPermission('user', 'write', req.user)) {
        return this.error(res, 'Unauthorized', 403);
      }

      const User = this.userModel;
      const user = await User.findById(userId).select('image').lean();

      if (!user) {
        return this.error(res, 'User not found', 404);
      }

      const storedImageUrl = user.image || 'user.svg';

      // Handle empty/default image - idempotent operation
      if (!storedImageUrl || storedImageUrl.trim() === '' || storedImageUrl.includes('user.svg')) {
        return this.success(res, 'user.svg', 'Image was deleted');
      }

      const storageType = process.env.STORAGE_TYPE || 'local';

      /*
       * Clearing the object out of the bucket is BEST EFFORT, the way
       * categories.controller already treats category images.
       *
       * Two rules pulling in opposite directions. Never delete an object we
       * cannot positively identify as this user's picture, so anything
       * unrecognised is left where it is rather than guessed at. And never let
       * the bucket decide whether somebody may clear their own photograph: a
       * stale URL, a bucket renamed since, a key written by the old PHP app,
       * or an IAM policy without DeleteObject would otherwise leave that
       * person stuck with a picture they cannot remove. An orphaned file is
       * the cheaper failure.
       *
       * So every branch below skips the delete and carries on to the database.
       */
      if (storageType === 's3' && process.env.AWS_S3_BUCKET) {
        try {
          const key = this.resolveUserImageS3Key(storedImageUrl, requestedImageUrl);
          if (key) {
            await require('../utils/s3').deleteObject(key);
          }
        } catch (err) {
          console.error('Error deleting user image from S3:', err);
        }
      }

      await User.findByIdAndUpdate(userId, { image: 'user.svg' });

      return this.success(res, 'user.svg', 'Image was deleted');
    } catch (error) {
      console.error('Error in userImageDelete:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * The S3 key to remove for a stored user image, or null when the object
   * cannot be positively identified as one of ours. Never throws for a reason
   * that should merely skip the delete; the caller treats null as "leave it".
   *
   * @param {string} storedImageUrl     the URL held in the user record
   * @param {string} [requestedImageUrl] what the client believed it was
   * @returns {string|null}
   */
  resolveUserImageS3Key(storedImageUrl, requestedImageUrl) {
    // The client is working from a stale record; do not act on its guess.
    if (requestedImageUrl && requestedImageUrl !== storedImageUrl) {
      console.warn(
        '[userImageDelete] request does not match the stored image, leaving the object in place'
      );
      return null;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(storedImageUrl);
    } catch (err) {
      // A relative path, written by an older install, is not an S3 object.
      console.warn('[userImageDelete] stored image is not an absolute URL, leaving it in place');
      return null;
    }

    const key = parsedUrl.pathname.replace(/^\/+/, '');
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION;
    const publicUrl = process.env.AWS_S3_PUBLIC_URL;

    const allowedHosts = [];
    if (publicUrl) {
      try {
        allowedHosts.push(new URL(publicUrl).hostname);
      } catch (err) {
        // Ignore invalid public URL configuration and fall back to the bucket hosts.
      }
    }
    if (bucket) {
      allowedHosts.push(`${bucket}.s3.amazonaws.com`);
      if (region) {
        allowedHosts.push(`${bucket}.s3.${region}.amazonaws.com`);
      }
    }

    const prefix = 'uploads/user_images/';
    const isBareKey = this.isValidPosnicUserImageFilename(key);
    const isPrefixedKey =
      key.startsWith(prefix) && this.isValidPosnicUserImageFilename(key.substring(prefix.length));

    if (!isBareKey && !isPrefixedKey) {
      console.warn('[userImageDelete] key is not a Posnic user image, leaving it in place');
      return null;
    }

    if (!allowedHosts.includes(parsedUrl.hostname)) {
      console.warn('[userImageDelete] image is not on a known bucket host, leaving it in place');
      return null;
    }

    return key;
  }

  /**
   * PHP: updatePrintSetting()
   * Update user print settings
   */
  async updatePrintSetting(req, res) {
    try {
      const userId = req.user._id;
      const printSettings = req.body;

      const user = await this.userModel
        .findByIdAndUpdate(userId, { $set: { print_settings: printSettings } }, { new: true })
        .select('print_settings');

      if (!user) {
        return this.error(res, 'User not found', 404);
      }

      return this.success(res, user.print_settings, 'Print settings updated successfully');
    } catch (error) {
      console.error('Error in updatePrintSetting:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: printType()
   * Get available print types
   */
  async printType(req, res) {
    try {
      const printTypes = [
        { id: 'thermal', name: 'Thermal Printer', size: '80mm' },
        { id: 'a4', name: 'A4 Printer', size: '210mm x 297mm' },
        { id: 'pos', name: 'POS Printer', size: '58mm' },
      ];

      return this.success(res, printTypes, 'Print types retrieved successfully');
    } catch (error) {
      console.error('Error in printType:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: userProfile()
   * Update the logged-in user's profile (image, firstname, lastname)
   */
  async userProfile(req, res) {
    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const { image, name, lastname } = req.body;

      const updateData = {};
      if (image !== undefined) updateData.image = image;
      if (name !== undefined) updateData.firstname = name;
      if (lastname !== undefined) updateData.lastname = lastname;

      await this.userModel.findByIdAndUpdate(req.user._id, { $set: updateData }, { new: true });

      const profileDetails = {
        imagename: image || '',
        firstname: name || '',
        lastname: lastname || '',
      };

      return res.status(200).json({
        type: 'success',
        message: 'User details update successfully',
        data: profileDetails,
      });
    } catch (error) {
      console.error('Error in UsersController.userProfile:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * PHP: changeBranch()
   * Change the user's active branch
   */
  async changeBranch(req, res) {
    try {
      const { branch_no } = req.body;

      if (!branch_no) {
        return this.error(res, 'Valid branch ID is required', 400);
      }

      const hasBranchAccess =
        Array.isArray(req.user?.branch_access) &&
        req.user.branch_access.some((entry) => String(entry.branch_id) === String(branch_no));
      if (!hasBranchAccess) {
        return this.error(res, 'You do not have access to the selected branch', 403);
      }

      const usersService = require('../services/user.service');
      const licenseId = req.tenantContext?.licenseId || req.user?.license;
      const result = await usersService.changeBranch(branch_no, req.user?._id, licenseId);

      if (result.status === true) {
        const activeTenant = await persistActiveTenant(req, result.data, licenseId);

        // Log staff activity (PHP: changeUserLog in setSettings)
        BaseModel.changeUserLog(
          req.user._id,
          req.user.username || `${req.user.firstname || ''} ${req.user.lastname || ''}`.trim(),
          new Date(),
          result.data.branch_id,
          result.data.branch_name || '',
          activeTenant.licenseId,
          {
            userAgent: req.headers['user-agent'] || '',
            ip: clientIp(req),
          }
        ).catch((err) => console.warn('changeUserLog failed:', err.message));

        return this.success(res, result.data, 'branch changed successfully');
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in UsersController.changeBranch:', error);
      return this.error(res, 'Unable to change branch. Please try again later.', 500);
    }
  }

  /**
   * PHP: userVerify()
   * Verify user password for danger zone operations (e.g., delete all data)
   */
  async userVerify(req, res) {
    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const { password } = req.query;

      if (!password || String(password).length < 5 || String(password).length > 20) {
        return res.status(400).json({
          type: 'error',
          message: 'Validation error',
          data: null,
        });
      }

      // Check plan access
      const user = await this.userModel
        .findById(req.user._id)
        .select('+password +access +usertype')
        .lean();

      if (!user) {
        return res.status(404).json({
          type: 'error',
          message: 'User not found',
          data: null,
        });
      }

      const planAccess = user.access?.plan?.read || false;
      if (!planAccess) {
        return res.status(403).json({
          type: 'error',
          message: 'Unauthorized',
          data: null,
        });
      }

      // Base64 encode password for comparison (matching PHP behavior)
      const mypassword = Buffer.from(String(password).trim()).toString('base64');

      // Verify password
      const passwordValid = await bcrypt.compare(mypassword, user.password);

      if (passwordValid && user.usertype === 'super_admin') {
        return res.status(200).json({
          type: 'success',
          message: 'Valid Admin',
          data: null,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          message: 'Invalid Admin Password',
          data: null,
        });
      }
    } catch (error) {
      console.error('Error in UsersController.userVerify:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * PHP: updateNewPassword()
   * Update password using forgot password key
   */
  async updateNewPassword(req, res) {
    try {
      const { forgot_key_value, update_new_password, retype_new_password } = req.body;

      if (!forgot_key_value) {
        return res.status(400).json({
          type: 'error',
          message: 'Password reset key is required',
          data: null,
        });
      }

      if (!update_new_password || !retype_new_password) {
        return res.status(400).json({
          type: 'error',
          message: 'New password and confirmation are required',
          data: null,
        });
      }

      if (update_new_password !== retype_new_password) {
        return res.status(400).json({
          type: 'error',
          message: 'Password mismatch',
          data: null,
        });
      }

      // Find user by userkey
      const userRecords = await this.userModel
        .findOne({ userkey: forgot_key_value })
        .select('+password +userkey')
        .lean();

      if (!userRecords || userRecords.userkey !== forgot_key_value) {
        return res.status(200).json({
          type: 'exist',
          message: 'Already used this link, please contact posnic admin !.',
          data: null,
        });
      }

      // Hash new password (base64 encode first, matching PHP behavior)
      const passwordToHash = Buffer.from(update_new_password).toString('base64');
      const hashedPassword = await bcrypt.hash(passwordToHash, 12);

      // Generate new userkey
      const random =
        new Date().toLocaleDateString('en-GB').replace(/\//g, '') + Math.random().toString();
      const newUserKey = await bcrypt.hash(random, 10);

      // Update user
      await this.userModel.updateOne(
        { userkey: forgot_key_value },
        {
          $set: {
            password: hashedPassword,
            userkey: newUserKey,
          },
        }
      );

      return res.status(200).json({
        type: 'success',
        message: 'Password successfully updated',
        data: null,
      });
    } catch (error) {
      console.error('Error in UsersController.updateNewPassword:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * PHP: getUserKeyDetails()
   * Verify user key for password reset
   */
  async getUserKeyDetails(req, res) {
    try {
      const { user_key } = req.query;

      if (!user_key) {
        return res.status(400).json({
          type: 'error',
          message: 'User key is required',
          data: null,
        });
      }

      const userRecords = await this.userModel
        .findOne({ userkey: user_key })
        .select('+userkey +expire_date')
        .lean();

      if (!userRecords || userRecords.userkey !== user_key) {
        return res.status(200).json({
          type: 'error',
          message: 'Your key deactivated, please contact posnic admin !',
          data: null,
        });
      }

      // Check expiry
      const currentDate = new Date();
      if (userRecords.expire_date && new Date(userRecords.expire_date) <= currentDate) {
        return res.status(200).json({
          type: 'error',
          message: 'Your link expired, please contact posnic admin !',
          data: null,
        });
      }

      return res.status(200).json({
        type: 'success',
        message: 'User Key Verified Successfully',
        data: userRecords.userkey,
      });
    } catch (error) {
      console.error('Error in UsersController.getUserKeyDetails:', error);
      return res.status(200).json({
        type: 'error',
        message: 'Your key deactivated, please contact posnic admin !',
        data: null,
      });
    }
  }

  /**
   * PHP: ssoAuth()
   * Authenticate user via SSO token
   */
  async ssoAuth(req, res) {
    const mongoose = require('mongoose');
    const jwt = require('jsonwebtoken');
    const db = currentConnection(mongoose.connection).db;

    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          type: 'error',
          message: 'Token is required',
          data: null,
        });
      }

      const ssoCollection = db.collection('sso');
      const ssoRecord = await ssoCollection.findOne({
        token: token,
        status: 'active',
      });

      if (!ssoRecord) {
        return res.status(404).json({
          type: 'error',
          message: 'something went wrong, try again!',
          data: null,
        });
      }

      // Check expiry
      const currentDate = new Date();
      if (ssoRecord.expire_date && new Date(ssoRecord.expire_date) <= currentDate) {
        return res.status(404).json({
          type: 'error',
          message: 'something went wrong, try again!',
          data: null,
        });
      }

      // Find user
      const recordsFiltered = await this.userModel
        .findOne({
          email: ssoRecord.email,
          license: ssoRecord.license,
        })
        .select(
          '+password +branch_access +printing_design +access +plan +plan_access +activate +license +firstname +lastname +username +email +image +register_status +usertype'
        )
        .lean();

      if (!recordsFiltered) {
        return res.status(404).json({
          type: 'error',
          message: 'something went wrong, try again!',
          data: null,
        });
      }

      // Build response similar to legacyVerifyLogin
      const branchAccess = Array.isArray(recordsFiltered.branch_access)
        ? recordsFiltered.branch_access
        : [];
      const branchLength = branchAccess.length;

      if (branchLength < 1) {
        return res.status(404).json({
          type: 'error',
          message: 'User Have not Any Branch',
          data: null,
        });
      }

      let branchId = '';
      for (const data of branchAccess) {
        if (data.branch_id) {
          branchId = data.branch_id;
        }
      }

      const checkUserBranch = await Branch.findOne({
        license: ssoRecord.license,
        _id: branchId,
      }).lean();

      if (!checkUserBranch) {
        return res.status(404).json({
          type: 'error',
          message: "User don't have valid branch. Please contact Administrator",
          data: null,
        });
      }

      let userACLPlan = true;
      if (
        recordsFiltered.access &&
        recordsFiltered.access.plan &&
        typeof recordsFiltered.access.plan.read === 'boolean'
      ) {
        userACLPlan = recordsFiltered.access.plan.read;
      }

      const param = {
        sid: String(recordsFiltered._id),
        usertype: recordsFiltered.usertype,
        firstname: recordsFiltered.firstname,
        lastname: recordsFiltered.lastname,
        user_name: recordsFiltered.username,
        user_image: recordsFiltered.image,
        register_status: recordsFiltered.register_status,
        branch_image: checkUserBranch.logo,
        branch_name: checkUserBranch.branch_name,
        branch_phone: checkUserBranch.store_telephone,
        branch_email: checkUserBranch.store_email,
        branch_address: checkUserBranch.store_address,
        branch_timezone: checkUserBranch.time_zone,
        branch_timeformat: checkUserBranch.time_format || 'enable',
        currency_type: checkUserBranch.currency_type,
        branchCount: branchLength,
        branchId: String(branchId),
        print_type: recordsFiltered.printing_design,
        plan:
          recordsFiltered.plan && recordsFiltered.plan.name ? recordsFiltered.plan.name : 'free',
        userACLPlan,
      };

      // Establish the same authenticated state as the normal login flow.
      // Without this, SSO validates successfully but subsequent browser
      // requests are anonymous and the frontend returns to the login page.
      if (req.session) {
        req.session.userId = String(recordsFiltered._id);
        req.session.branch_id = String(branchId);
        req.session.outstandingCustomersModal = false;
      }

      const jwtToken = signLegacyToken(recordsFiltered, req);
      const days = process.env.JWT_COOKIE_EXPIRES_IN
        ? parseInt(process.env.JWT_COOKIE_EXPIRES_IN)
        : 7;
      res.cookie(
        'jwt',
        jwtToken,
        authCookieOptions({
          expires: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        })
      );

      param.jwt_token = jwtToken;

      // Consume the one-time SSO token only after login validation succeeds.
      await ssoCollection.updateOne(
        { token: token, status: 'active' },
        { $set: { status: 'deactive' } }
      );

      return res.status(200).json({
        type: 'success',
        message: 'Successfully login',
        data: param,
      });
    } catch (error) {
      console.error('Error in UsersController.ssoAuth:', error);
      return res.status(404).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * PHP: mobileLogin()
   * Mobile app login endpoint
   */
  async mobileLogin(req, res) {
    const mongoose = require('mongoose');
    const db = currentConnection(mongoose.connection).db;
    const loginCheckCollection = db.collection('login_check');

    try {
      const { username, password } = req.body || {};

      const myusername = String(username).trim();
      const mypassword = Buffer.from(String(password).trim()).toString('base64');

      const ip =
        req.ip ||
        req.connection?.remoteAddress ||
        req.headers['x-forwarded-for']?.split(',')[0] ||
        'unknown';

      let getIpAddress = await loginCheckCollection.findOne({ ip_address: ip });
      const currentTime = Math.floor(Date.now() / 1000);

      if (getIpAddress && process.env.NODE_ENV === 'production') {
        if (getIpAddress.banned > currentTime) {
          return res.status(404).json({
            type: 'error',
            message: 'You tried to sign in too many times with an incorrect account or password',
            data: 'incorrect',
          });
        }
      }

      if (!getIpAddress) {
        await loginCheckCollection.insertOne({
          ip_address: ip,
          banned: 0,
          login_count: 0,
        });
        getIpAddress = { ip_address: ip, banned: 0, login_count: 0 };
      }

      const recordsFiltered = await this.userModel
        .findOne({
          $or: [{ username: myusername }, { email: myusername }],
        })
        .select('+password +branch_access +activate +license')
        .lean();

      let isAuthenticated = false;
      if (recordsFiltered) {
        const usernameMatches = recordsFiltered.username === myusername;
        const emailMatches = recordsFiltered.email === myusername;
        const isActivated = recordsFiltered.activate === true;

        let passwordValid = false;
        if (recordsFiltered.password) {
          passwordValid = await bcrypt.compare(mypassword, recordsFiltered.password);
        }

        if (
          (usernameMatches && isActivated && passwordValid) ||
          (emailMatches && isActivated && passwordValid)
        ) {
          isAuthenticated = true;
        }
      }

      if (isAuthenticated) {
        await loginCheckCollection.updateOne(
          { ip_address: ip },
          { $set: { login_count: 0, banned: 0 } }
        );

        return res.status(200).json({
          type: 'success',
          message: 'Successfully login',
          data: recordsFiltered.branch_access || [],
        });
      } else {
        const currentCount = getIpAddress?.login_count || 0;
        const newCount = currentCount + 1;

        if (newCount >= 7) {
          const expireTime = currentTime + 60;
          await loginCheckCollection.updateOne(
            { ip_address: ip },
            { $set: { login_count: 0, banned: expireTime } }
          );
          return res.status(404).json({
            type: 'error',
            message: 'You tried to sign in too many times with an incorrect account or password',
            data: 'incorrect',
          });
        }

        await loginCheckCollection.updateOne(
          { ip_address: ip },
          { $set: { login_count: newCount } }
        );

        return res.status(404).json({
          type: 'error',
          message: LOGIN_FAILED_MESSAGE,
          data: null,
        });
      }
    } catch (error) {
      console.error('Error in UsersController.mobileLogin:', error);
      return res.status(404).json({
        type: 'error',
        message: error.message || 'An error occurred',
        data: null,
      });
    }
  }

  /**
   * PHP: kioskMobileLogin()
   * Kiosk mobile app login endpoint - returns branches with kiosk configuration
   */
  async kioskMobileLogin(req, res) {
    const mongoose = require('mongoose');
    const db = currentConnection(mongoose.connection).db;
    const loginCheckCollection = db.collection('login_check');

    try {
      const { username, password } = req.body || {};

      const myusername = String(username).trim();
      const mypassword = Buffer.from(String(password).trim()).toString('base64');

      const ip =
        req.ip ||
        req.connection?.remoteAddress ||
        req.headers['x-forwarded-for']?.split(',')[0] ||
        'unknown';

      let getIpAddress = await loginCheckCollection.findOne({ ip_address: ip });
      const currentTime = Math.floor(Date.now() / 1000);

      if (getIpAddress && process.env.NODE_ENV === 'production') {
        if (getIpAddress.banned > currentTime) {
          return res.status(404).json({
            type: 'error',
            message: 'You tried to sign in too many times with an incorrect account or password',
            data: 'incorrect',
          });
        }
      }

      if (!getIpAddress) {
        await loginCheckCollection.insertOne({
          ip_address: ip,
          banned: 0,
          login_count: 0,
        });
        getIpAddress = { ip_address: ip, banned: 0, login_count: 0 };
      }

      const recordsFiltered = await this.userModel
        .findOne({
          $or: [{ username: myusername }, { email: myusername }],
        })
        .select('+password +branch_access +activate +license +username')
        .lean();

      let isAuthenticated = false;
      if (recordsFiltered) {
        const usernameMatches = recordsFiltered.username === myusername;
        const emailMatches = recordsFiltered.email === myusername;
        const isActivated = recordsFiltered.activate === true;

        let passwordValid = false;
        if (recordsFiltered.password) {
          passwordValid = await bcrypt.compare(mypassword, recordsFiltered.password);
          if (!passwordValid) {
            const rawPassword = String(password).trim();
            passwordValid = await bcrypt.compare(rawPassword, recordsFiltered.password);
          }
        }

        if (
          (usernameMatches && isActivated && passwordValid) ||
          (emailMatches && isActivated && passwordValid)
        ) {
          isAuthenticated = true;
        }
      }

      if (isAuthenticated) {
        await loginCheckCollection.updateOne(
          { ip_address: ip },
          { $set: { login_count: 0, banned: 0 } }
        );

        const branchAccess = recordsFiltered.branch_access || [];

        // Build kiosk map from branches collection
        const branchIds = [];
        for (const b of branchAccess) {
          if (b.branch_id) {
            branchIds.push(
              mongoose.Types.ObjectId.isValid(b.branch_id)
                ? new mongoose.Types.ObjectId(b.branch_id)
                : b.branch_id
            );
          }
        }

        const kioskMap = {};

        if (branchIds.length > 0) {
          const branchCollection = db.collection('branches');
          const cursor = await branchCollection
            .find({
              'kiosk.branch_id': { $in: branchIds },
            })
            .toArray();

          for (const doc of cursor) {
            if (doc.kiosk && Array.isArray(doc.kiosk)) {
              for (const kioskEntry of doc.kiosk) {
                if (!kioskEntry.branch_id) continue;

                const bid = String(kioskEntry.branch_id);

                kioskMap[bid] = {
                  store_id: kioskEntry.store_id || null,
                  user_id: String(recordsFiltered._id),
                  user_name: recordsFiltered.username || null,
                  payment_cod: kioskEntry.payment_cod || null,
                  payment_number: kioskEntry.payment_number || null,
                  payment_razorpay: kioskEntry.payment_razorpay || null,
                };
              }
            }
          }
        }

        // Join branch_access + kiosk info per branch
        const joinedBranches = [];
        for (const b of branchAccess) {
          const branchIdStr = String(b.branch_id);

          const row = {
            branch_id: branchIdStr,
            branch_name: b.branch_name || '',
            branch_image: b.branch_image || '',
          };

          if (kioskMap[branchIdStr]) {
            const k = kioskMap[branchIdStr];
            if (k.store_id) row.store_id = k.store_id;
            if (k.user_id) row.user_id = String(k.user_id);
            if (k.user_name) row.user_name = k.user_name;
            if (k.payment_cod !== null) row.payment_cod = Boolean(k.payment_cod);
            if (k.payment_number !== null) row.payment_number = Boolean(k.payment_number);
            if (k.payment_razorpay !== null) row.payment_razorpay = Boolean(k.payment_razorpay);
          }

          joinedBranches.push(row);
        }

        const filteredBranches = joinedBranches.filter((row) => row.branch_id);

        return res.status(200).json({
          type: 'success',
          message: 'Successfully login',
          data: filteredBranches,
        });
      } else {
        const currentCount = getIpAddress?.login_count || 0;
        const newCount = currentCount + 1;

        if (newCount >= 7) {
          const expireTime = currentTime + 60;
          await loginCheckCollection.updateOne(
            { ip_address: ip },
            { $set: { login_count: 0, banned: expireTime } }
          );
          return res.status(404).json({
            type: 'error',
            message: 'You tried to sign in too many times with an incorrect account or password',
            data: 'incorrect',
          });
        }

        await loginCheckCollection.updateOne(
          { ip_address: ip },
          { $set: { login_count: newCount } }
        );

        return res.status(404).json({
          type: 'error',
          message: LOGIN_FAILED_MESSAGE,
          data: null,
        });
      }
    } catch (error) {
      console.error('Error in UsersController.kioskMobileLogin:', error);
      return res.status(404).json({
        type: 'error',
        message: error.message || 'An error occurred',
        data: null,
      });
    }
  }

  /**
   * PHP: ssoToken() - internal endpoint
   * Generate SSO token for a user (used by external posnic.com)
   */
  async ssoToken(req, res) {
    const mongoose = require('mongoose');
    const crypto = require('crypto');
    const config = require('../config/config');
    const db = currentConnection(mongoose.connection).db;

    try {
      // This endpoint requires posnic_key/posnic_secret headers
      const posnicKey = req.headers['posnickey'];
      const posnicSecret = req.headers['posnicsecret'];

      // Validate keys from environment
      if (posnicKey !== config.posnic_key || posnicSecret !== config.posnic_secret) {
        return res.status(401).json({
          type: 'error',
          message: 'Unauthorized',
          data: null,
        });
      }

      const { id, email, timezone } = req.body;

      if (!email) {
        return res.status(400).json({
          type: 'error',
          message: 'Email is required',
          data: null,
        });
      }

      // Find user by email
      const userDetails = await this.userModel.findOne({ email }).select('+license').lean();

      if (!userDetails) {
        return res.status(404).json({
          type: 'error',
          message: 'something went wrong, try again!',
          data: null,
        });
      }

      const ssoCollection = db.collection('sso');

      // Create dates
      const tz = timezone || 'UTC';
      const currentDate = new Date();
      const expireDate = new Date(currentDate.getTime() + 10 * 60 * 1000); // +10 minutes

      // Generate token
      const apiKey = crypto.randomBytes(16).toString('hex');
      const secret = crypto.randomBytes(32).toString('hex');
      const base64UrlHeader = Buffer.from(apiKey)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const base64UrlPayload = Buffer.from(secret)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const signature = crypto
        .createHmac('sha256', email)
        .update(base64UrlHeader + '.' + base64UrlPayload)
        .digest('hex');
      const base64UrlSignature = Buffer.from(signature)
        .toString('base64')
        .replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
      const token = base64UrlHeader + '.' + base64UrlPayload + '.' + base64UrlSignature;

      // Insert SSO record
      await ssoCollection.insertOne({
        userid: id,
        email: email,
        token: token,
        timezone: tz,
        created_date: currentDate,
        expire_date: expireDate,
        status: 'active',
        license: userDetails.license,
      });

      return res.status(200).json({
        type: 'success',
        message: 'success',
        data: { token },
      });
    } catch (error) {
      console.error('Error in UsersController.ssoToken:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }

  /**
   * PHP: ssoClientLogin()
   * Redirect user to SSO login on posnic.com
   */
  async ssoClientLogin(req, res) {
    const axios = require('axios');

    try {
      if (!req.user?._id) {
        return res.status(401).json({
          type: 'error',
          message: 'Authentication required',
          data: null,
        });
      }

      const userRecords = await this.userModel.findById(req.user._id).lean();

      if (!userRecords) {
        return res.status(404).json({
          type: 'error',
          message: 'User not found',
          data: null,
        });
      }

      const posnicKey = process.env.GUZZLE_KEY || process.env.POSNIC_KEY;
      const posnicSecret = process.env.GUZZLE_SECRET || process.env.POSNIC_SECRET;

      /*
       * The website mints the token now, not a PHP script.
       *
       * This pointed at api.posnic.com/user.php on a machine that has since
       * been deleted - and it had already stopped working before that, because
       * that origin no longer answered HTTPS, so Cloudflare returned 522 and
       * this button failed silently for anyone who pressed it.
       *
       * SSO_URL still overrides, for local work against a dev website.
       */
      const ssoUrlFromEnv = process.env.SSO_URL;
      const siteBase = (process.env.POSNIC_SITE_URL || 'https://posnic.com').replace(/\/+$/, '');
      const domainName = ssoUrlFromEnv || `${siteBase}/api/sso/token`;

      console.log('[ssoClientLogin] Calling SSO API:', domainName);
      console.log('[ssoClientLogin] User ID:', String(userRecords._id));
      console.log('[ssoClientLogin] User email:', userRecords.email);

      // Create form-encoded data (matching PHP's form_params)
      const formData = new URLSearchParams();
      formData.append('id', String(userRecords._id));
      formData.append('email', userRecords.email);

      /*
       * JSON, because the endpoint answering is now our own Node service
       * rather than a PHP script expecting form_params. The headers are
       * unchanged so an older website that still speaks the old shape keeps
       * working during a deploy where the two sides move separately.
       */
      const response = await axios.post(
        domainName,
        { id: String(userRecords._id), email: userRecords.email },
        {
          headers: {
            'Content-Type': 'application/json',
            posnickey: posnicKey,
            posnicsecret: posnicSecret,
            posnicsso: 'sso',
          },
          proxy: false,
          timeout: 10000,
        }
      );

      console.log('[ssoClientLogin] SSO API response:', JSON.stringify(response.data, null, 2));

      if (response.data?.data?.token) {
        /* One slash. The old line joined 'https://www.posnic.com/' to
           '/ssoauth.html' and produced a double slash in every link it ever
           made. And the page is a route now, not a .html file. */
        /* /api/... because posnic.com is fronted by CloudFront, which forwards
           only that prefix to the service; a bare /ssoauth answers 403 from the
           CDN, exactly as the old /ssoauth.html did. */
        const path = `${siteBase}/api/sso/auth?token=${encodeURIComponent(response.data.data.token)}`;

        console.log('[ssoClientLogin] Success! Returning path:', path);
        // Match PHP: type 'success', message 'valid', HTTP 200
        return res.status(200).json({
          type: 'success',
          message: 'valid',
          data: path,
        });
      } else {
        console.log('[ssoClientLogin] No token in response', response.data);
        // Match PHP: respond with type 'error', message 'not valid', HTTP 200
        return res.status(200).json({
          type: 'error',
          message: 'not valid',
          data: null,
        });
      }
    } catch (error) {
      console.error('[ssoClientLogin] Error:', error.message);
      if (error.response) {
        console.error('[ssoClientLogin] Response data:', error.response.data);
        console.error('[ssoClientLogin] Response status:', error.response.status);
      } else if (error.request) {
        console.error('[ssoClientLogin] No response received from SSO API');
      }
      // Match PHP: on exception, return type 'error' with HTTP 200 so
      // frontend can decide how to handle it without seeing a transport
      // error. Use the low-level error message (like PHP's $e->getMessage()),
      // but fall back to a friendly string if it's missing.
      const message =
        (error && error.message) ||
        'Unable to connect to the billing server. Please try again later.';

      return res.status(200).json({
        type: 'error',
        message,
        data: null,
      });
    }
  }

  /**
   * PHP: planUpdate()
   * Update user plan (internal endpoint for posnic.com)
   */
  async planUpdate(req, res) {
    const mongoose = require('mongoose');

    try {
      // This endpoint requires posnic_key/posnic_secret headers or params
      const posnicKey = req.headers['posnickey'] || req.params.key;
      const posnicSecret = req.headers['posnicsecret'] || req.params.secret;

      if (posnicKey !== process.env.POSNIC_KEY || posnicSecret !== process.env.POSNIC_SECRET) {
        return res.status(401).json({
          type: 'error',
          message: 'Unauthorized',
          data: null,
        });
      }

      const { license, email, name, max_sales, plan_expire, timezone, access, plan_access } =
        req.body;

      if (!license || !email) {
        return res.status(400).json({
          type: 'error',
          message: 'License and email are required',
          data: null,
        });
      }

      // Parse plan_access
      const parsedPlanAccess =
        typeof plan_access === 'string' ? JSON.parse(plan_access) : plan_access;

      // Calculate expire date
      const expireDate = new Date(plan_expire);

      // Update user
      await this.userModel.updateOne(
        {
          license: mongoose.Types.ObjectId.isValid(license)
            ? new mongoose.Types.ObjectId(license)
            : license,
          email: email,
        },
        {
          $set: {
            'plan.name': name,
            'plan.max_sales': max_sales,
            'plan.plan_expire': expireDate,
            'access.plan.read': access === 'true' || access === true,
            plan_access: parsedPlanAccess,
          },
        }
      );

      return res.status(200).json({
        type: 'success',
        message: 'Successfully updated',
        data: null,
      });
    } catch (error) {
      console.error('Error in UsersController.planUpdate:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message,
        data: null,
      });
    }
  }
}

module.exports = new UsersController();
