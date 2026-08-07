const httpStatus = require('http-status');
const { User } = require('../models');
// Token was used by logout and refreshAuth without ever being imported, so both
// threw ReferenceError instead of doing their work.
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const { tokenTypes } = require('../config/tokens');
const logger = require('../config/logger');

/**
 * Register a new user
 * @param {Object} userBody
 * @returns {Promise<User>}
 */
const register = async (userBody) => {
  if (await User.isEmailTaken(userBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  const user = await User.create({
    ...userBody,
    // Set default role if not provided
    role: userBody.role || 'user',
  });

  // Generate email verification token
  const verifyEmailToken = await tokenService.generateVerifyEmailToken(user);

  // TODO: Send verification email
  logger.info(`Email verification token for ${user.email}: ${verifyEmailToken}`);

  return user;
};

/**
 * Login with email and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object, tokens: Object}>}
 */
const login = async (email, password) => {
  const user = await User.findOne({ email });

  if (!user || !(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }

  if (!user.isActive) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Account is deactivated');
  }

  // Update last login timestamp
  await user.updateLastLogin();

  // Generate tokens
  const tokens = await tokenService.generateAuthTokens(user);

  return { user, tokens };
};

/**
 * Logout
 * @param {string} refreshToken
 * @returns {Promise}
 */
const logout = async (refreshToken) => {
  const refreshTokenDoc = await Token.findOne({
    token: refreshToken,
    type: tokenTypes.REFRESH,
    blacklisted: false,
  });

  if (!refreshTokenDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  await refreshTokenDoc.remove();
};

/**
 * Refresh auth tokens
 * @param {string} refreshToken
 * @returns {Promise<Object>}
 */
const refreshAuth = async (refreshToken) => {
  try {
    const refreshTokenDoc = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH);
    const user = await User.findById(refreshTokenDoc.user);

    if (!user) {
      throw new Error();
    }

    await refreshTokenDoc.remove();
    return tokenService.generateAuthTokens(user);
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
};

/**
 * Reset password
 * @param {string} resetPasswordToken
 * @param {string} newPassword
 * @returns {Promise}
 */
const resetPassword = async (resetPasswordToken, newPassword) => {
  try {
    const resetPasswordTokenDoc = await tokenService.verifyToken(
      resetPasswordToken,
      tokenTypes.RESET_PASSWORD
    );

    const user = await User.findById(resetPasswordTokenDoc.user);

    if (!user) {
      throw new Error();
    }

    user.password = newPassword;
    await user.save();

    // Delete all refresh tokens for the user
    await Token.deleteMany({ user: user.id, type: tokenTypes.REFRESH });

    // Delete the used reset password token
    await resetPasswordTokenDoc.remove();

    // TODO: Send password reset confirmation email
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
  }
};

/**
 * Verify email
 * @param {string} verifyEmailToken
 * @returns {Promise}
 */
const verifyEmail = async (verifyEmailToken) => {
  try {
    const verifyEmailTokenDoc = await tokenService.verifyToken(
      verifyEmailToken,
      tokenTypes.VERIFY_EMAIL
    );

    const user = await User.findById(verifyEmailTokenDoc.user);

    if (!user) {
      throw new Error();
    }

    // Mark email as verified
    user.isEmailVerified = true;
    await user.save();

    // Delete the used verification token
    await verifyEmailTokenDoc.remove();
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Email verification failed');
  }
};

module.exports = {
  register,
  login,
  logout,
  refreshAuth,
  resetPassword,
  verifyEmail,
};
