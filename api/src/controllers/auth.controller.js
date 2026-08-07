const { redact } = require('../utils/redact');
const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { AppError } = require('../utils/appError');
const { Email } = require('../utils/email');
const { createAndSendToken } = require('./auth-utils.controller');
require('../utils/findUserByIdentifier');

// Helper function to filter object fields
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

exports.register = async (req, res, next) => {
  try {
    /*
     * The role is not the caller's to choose.
     *
     * This read role straight from the request body, and the schema's enum
     * accepts "admin" and "super_admin" - so whoever reached this endpoint
     * decided what they would be. Privilege is granted by an administrator
     * afterwards, never claimed in the request that creates the account.
     *
     * The same goes for anything else that decides what an account can see:
     * usertype, access, license and branch all belong to the tenant, not to the
     * body of a registration.
     */
    const newUser = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      passwordConfirm: req.body.passwordConfirm,
      // role deliberately omitted - the schema default is "staff".
    });

    const url = `${req.protocol}://${req.get('host')}/me`;
    await new Email(newUser, url).sendWelcome();

    createAndSendToken(newUser, 201, res, req);
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    // 🔍 DEBUG - Check if login method is called
    console.log('🔥 LOGIN METHOD CALLED!');
    console.log('🔥 Email:', req.body?.email);
    console.log('🔥 Request body:', redact(req.body));

    const { email, password } = req.body;

    // 1) Check if email and password exist
    if (!email || !password) {
      return next(new AppError('Please provide email and password!', 400));
    }

    // 2) Check if user exists && password is correct
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    // 3) If everything ok, send token to client
    createAndSendToken(user, 200, res, req);
  } catch (err) {
    next(err);
  }
};

exports.protect = async (req, res, next) => {
  try {
    // 1) Getting token and check if it's there
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    // 2) Verification token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // 4) Check if user changed password after the token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return next(new AppError('User recently changed password! Please log in again.', 401));
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser;
    res.locals.user = currentUser;
    next();
  } catch (err) {
    next(err);
  }
};

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};

exports.forgotPassword = async (req, res, next) => {
  try {
    // 1) Get user based on POSTed email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return next(new AppError('There is no user with that email address.', 404));
    }

    // 2) Generate the random reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // 3) Send it to user's email
    try {
      const resetURL = `${req.protocol}://${req.get(
        'host'
      )}/api/v1/users/resetPassword/${resetToken}`;

      await new Email(user, resetURL).sendPasswordReset();

      res.status(200).json({
        status: 'success',
        message: 'Token sent to email!',
      });
    } catch (err) {
      console.error('Error sending password reset email:', err);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new AppError('There was an error sending the email. Try again later!', 500));
    }
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    // 1) Get user based on the token
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    // 2) If token has not expired, and there is user, set the new password
    if (!user) {
      return next(new AppError('Token is invalid or has expired', 400));
    }

    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // 3) Update changedPasswordAt property for the user
    // 4) Log the user in, send JWT
    createAndSendToken(user, 200, res);
  } catch (err) {
    next(err);
  }
};

exports.updatePassword = async (req, res, next) => {
  try {
    // 1) Get user from collection
    const user = await User.findById(req.user.id).select('+password');

    // 2) Check if POSTed current password is correct
    if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
      return next(new AppError('Your current password is wrong.', 401));
    }

    // 3) If so, update password
    user.password = req.body.password;
    user.passwordConfirm = req.body.passwordConfirm;
    await user.save();
    // User.findByIdAndUpdate will NOT work as intended!

    // 4) Log user in, send JWT
    createAndSendToken(user, 200, res);
  } catch (err) {
    next(err);
  }
};

// Helper function to get user data
const getUserData = (user) => {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
  };
};

// Get current user
// (protected route - requires authentication)
exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

// Get user by ID
// (admin route - requires admin privileges)
exports.getUser = async (req, res, next) => {
  try {
    const user = req.tenantContext
      ? await User.findOne({
          _id: req.params.id,
          license: req.tenantContext?.licenseId,
          branch_access: {
            $elemMatch: {
              branch_id: req.tenantContext?.branchId,
              branch_name: req.tenantContext?.branchName,
            },
          },
        })
      : await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('No user found with that ID', 404));
    }
    res.status(200).json({
      status: 'success',
      data: {
        user: getUserData(user),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get all users
// (admin route - requires admin privileges)
exports.getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find(
      req.tenantContext
        ? {
            license: req.tenantContext?.licenseId,
            branch_access: {
              $elemMatch: {
                branch_id: req.tenantContext?.branchId,
                branch_name: req.tenantContext?.branchName,
              },
            },
          }
        : {}
    );
    res.status(200).json({
      status: 'success',
      results: users.length,
      data: {
        users: users.map((user) => getUserData(user)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Update user
// (protected route - requires authentication)
exports.updateMe = async (req, res, next) => {
  try {
    // 1) Create error if user POSTs password data
    if (req.body.password || req.body.passwordConfirm) {
      return next(
        new AppError('This route is not for password updates. Please use /updateMyPassword.', 400)
      );
    }

    // 2) Filtered out unwanted fields names that are not allowed to be updated
    const filteredBody = filterObj(req.body, 'name', 'email');

    // 3) Update user document
    const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      status: 'success',
      data: {
        user: getUserData(updatedUser),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Delete user (set active to false)
// (protected route - requires authentication)
exports.deleteMe = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { active: false });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (err) {
    next(err);
  }
};

// Update user (admin only)
// (admin route - requires admin privileges)
exports.updateUser = async (req, res, next) => {
  try {
    const { license, license_id, branch, branch_id, branchId, branch_name, ...safeUpdate } =
      req.body;
    const user = req.tenantContext
      ? await User.findOneAndUpdate(
          {
            _id: req.params.id,
            license: req.tenantContext?.licenseId,
            branch_access: {
              $elemMatch: {
                branch_id: req.tenantContext?.branchId,
                branch_name: req.tenantContext?.branchName,
              },
            },
          },
          safeUpdate,
          {
            new: true,
            runValidators: true,
          }
        )
      : await User.findByIdAndUpdate(req.params.id, req.body, {
          new: true,
          runValidators: true,
        });

    if (!user) {
      return next(new AppError('No user found with that ID', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        user: getUserData(user),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Delete user (admin only)
// (admin route - requires admin privileges)
exports.deleteUser = async (req, res, next) => {
  try {
    const user = req.tenantContext
      ? await User.findOneAndDelete({
          _id: req.params.id,
          license: req.tenantContext?.licenseId,
          branch_access: {
            $elemMatch: {
              branch_id: req.tenantContext?.branchId,
              branch_name: req.tenantContext?.branchName,
            },
          },
        })
      : await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return next(new AppError('No user found with that ID', 404));
    }

    res.status(204).json({
      status: 'success',
      data: null,
    });
  } catch (err) {
    next(err);
  }
};

// Verify token or handle legacy login
// (public route - handles both token verification and legacy login)
exports.verifyToken = async (req, res, next) => {
  try {
    // Check if this is a legacy login request (has username and password)
    if (req.body.username && req.body.password) {
      const userController = require('./users.controller');
      return userController.legacyVerifyLogin(req, res);
    }

    // Otherwise, handle token verification
    const token = req.cookies.jwt || req.headers.authorization?.split(' ')[1] || req.body.token;

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in! Please log in to get access.',
      });
    }

    // Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token no longer exists.',
      });
    }

    // Check if user changed password after the token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        status: 'error',
        message: 'User recently changed password! Please log in again.',
      });
    }

    // If we reach here, the token is valid
    res.status(200).json({
      status: 'success',
      data: {
        user: currentUser,
      },
    });
  } catch (error) {
    // Handle JWT specific errors
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again.',
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired! Please log in again.',
      });
    }

    // Handle any other unexpected errors
    console.error('Token verification error:', error);
    res.status(500).json({
      status: 'error',
      message: 'An error occurred while verifying the token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
