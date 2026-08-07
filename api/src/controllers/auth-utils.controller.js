const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { authCookieOptions } = require('../utils/auth-cookie');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = authCookieOptions({
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
  });

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

const verifyToken = async (token) => {
  return await promisify(jwt.verify)(token, process.env.JWT_SECRET);
};

const getTokenFromRequest = (req) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }
  return token;
};

const createAndSendToken = async (user, statusCode, res, req) => {
  // 🔍 SIMPLE DEBUG - Check if this function is called
  console.log('🔥 createAndSendToken called!');
  console.log('🔥 User:', user?.email);
  console.log('🔥 Status:', statusCode);
  console.log('🔥 req exists:', !!req);

  const token = signToken(user._id);

  // 🔍 SESSION CREATION DEBUG - ADD THIS
  console.log('\n🔍 LOGIN SESSION DEBUG');
  console.log('=======================');

  // 1. Check user authentication
  console.log('📋 1. User Authentication:');
  console.log('req.user exists:', !!req?.user);
  console.log('user parameter exists:', !!user);
  if (user) {
    console.log('User email:', user.email);
    console.log('User ID:', user._id);
    console.log('User access:', JSON.stringify(user.access, null, 2));
  } else {
    console.log('❌ NO USER FOUND - Authentication failed');
  }

  // 2. Check permission
  console.log('\n📋 2. Permission Check:');
  const hasPermission = !!(
    user &&
    user.access &&
    user.access.sales &&
    user.access.sales.session_filter === true
  );
  console.log('Has session filter permission:', hasPermission);

  if (!hasPermission) {
    console.log('❌ NO PERMISSION - User does not have access.sales.session_filter: true');
    console.log(
      '💡 Fix with: db.users.updateOne({email:"' +
        (user?.email || 'user@example.com') +
        '"}, {$set: {"access.sales.session_filter": true}})'
    );
  }

  // 3. Check database connection
  console.log('\n📋 3. Database Connection:');
  console.log('req.db exists:', !!req?.db);
  console.log('req.app.locals.mongoClient exists:', !!req?.app?.locals?.mongoClient);

  let db = req?.db;
  if (!db && req?.app?.locals?.mongoClient) {
    const mongoClient = req.app.locals.mongoClient;
    const dbName = process.env.MONGODB_URI?.split('/')?.pop()?.split('?')[0] || 'posnicpro';
    db = mongoClient.db(dbName);
    console.log('✅ Using mongoClient from app.locals');
  }

  if (!db) {
    console.log('❌ NO DATABASE CONNECTION');
    console.log('💡 Fix: Add to app.js -> app.locals.mongoClient = mongoClient;');
  }

  // 4. Try session creation (only if has permission and database available)
  if (hasPermission && db) {
    console.log('\n📋 4. Session Creation:');

    try {
      const { ObjectId } = require('mongodb');
      const loginTime = new Date();
      const sessionId = req.sessionID || 'session_' + Date.now();

      // Prepare session data
      const sessionData = {
        user_id: new ObjectId(user._id),
        username: user.username || user.email,
        email: user.email,
        license: new ObjectId(user.license),
        session_id: sessionId,
        login_time: loginTime,
        logout_time: null,
        is_active: true,
        ip_address: req.ip || '127.0.0.1',
        created_date: loginTime,
      };

      console.log('Session data prepared:', JSON.stringify(sessionData, null, 2));

      const userSessionsCollection = db.collection('user_sessions');

      // Mark previous sessions inactive
      const updateResult = await userSessionsCollection.updateMany(
        { user_id: sessionData.user_id, is_active: true },
        { $set: { is_active: false } }
      );
      console.log('Previous sessions marked inactive:', updateResult.modifiedCount);

      // Check existing session
      const existingSession = await userSessionsCollection.findOne({
        user_id: sessionData.user_id,
        logout_time: null,
      });

      let sessionRecordId;

      if (existingSession) {
        // Reactivate existing
        await userSessionsCollection.updateOne(
          { _id: existingSession._id },
          {
            $set: {
              session_id: sessionId,
              ip_address: sessionData.ip_address,
              is_active: true,
              updated_date: new Date(),
            },
          }
        );

        sessionRecordId = existingSession._id;
        console.log('✅ Existing session reactivated:', existingSession._id);

        // Set session data
        if (req.session) {
          req.session.PosnicPro = {
            ...req.session.PosnicPro,
            current_session_id: existingSession._id.toString(),
            session_login_time: existingSession.login_time,
          };
        }
      } else {
        // Create new
        const result = await userSessionsCollection.insertOne(sessionData);
        sessionRecordId = result.insertedId;
        console.log('✅ New session created:', result.insertedId);

        // Set session data
        if (req.session) {
          req.session.PosnicPro = {
            ...req.session.PosnicPro,
            current_session_id: result.insertedId.toString(),
            session_login_time: loginTime,
          };
        }
      }

      // Verify record
      const createdRecord = await userSessionsCollection.findOne({
        _id: sessionRecordId,
      });

      if (createdRecord) {
        console.log('✅ DATABASE RECORD VERIFIED:');
        console.log(JSON.stringify(createdRecord, null, 2));
      } else {
        console.log('❌ RECORD NOT FOUND IN DATABASE');
      }

      console.log('\n🎉 SESSION CREATION SUCCESS!');
    } catch (error) {
      console.log('❌ SESSION CREATION ERROR:', error.message);
      console.log('Stack:', error.stack);
    }
  } else {
    console.log('\n📋 4. No Session Creation:');
    if (!hasPermission) {
      console.log('❌ No permission');
    }
    if (!db) {
      console.log('❌ No database connection');
    }
  }

  console.log('=======================\n');

  // Set cookie
  const cookieOptions = authCookieOptions({
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
  });

  res.cookie('jwt', token, cookieOptions);

  // Format response according to database structure
  const responseData = {
    sid: user._id,
    usertype: user.role || 'user',
    firstname: user.firstname || '',
    lastname: user.lastname || '',
    user_name: user.email,
    user_image: user.image || '',
    register_status: user.register_status || 'Open',
    branch_image: user.branch_image || '',
    branch_name: user.branch_name || '',
    branch_phone: user.branch_phone || '',
    branch_email: user.branch_email || '',
    branch_address: user.branch_address || '',
    branch_timezone: user.branch_timezone || 'UTC',
    branch_timeformat: user.branch_timeformat || '12h',
    currency_type: user.currency_type || 'USD',
    branchCount: user.branch_access ? user.branch_access.length : 0,
    branchId: user.default_branch_id || '',
    print_type: user.printing_design || [
      {
        printing_design: 'standard',
        printing_max_char: 'default',
        printing_size: 'receipt_medium',
      },
    ],
    plan: user.plan?.name || 'free',
    userACLPlan: true,
  };

  res.status(statusCode).json({
    type: 'success',
    message: 'Successfully logged in',
    data: responseData,
  });
};

module.exports = {
  signToken,
  createSendToken,
  verifyToken,
  getTokenFromRequest,
  createAndSendToken,
};
