const jwt = require('jsonwebtoken');
const moment = require('moment');
const config = require('../config/config');
const { tokenTypes } = require('../config/tokens');
require('../utils/appError');

/**
 * Generate token
 * @param {ObjectId} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {string} [secret]
 * @returns {string}
 */
const generateToken = (userId, expires, type, secret = config.jwt.secret) => {
  const payload = {
    sub: userId,
    iat: moment().unix(),
    exp: expires.unix(),
    type,
  };
  return jwt.sign(payload, secret);
};

/**
 * Verify token and return payload
 * @param {string} token
 * @param {string} type
 * @returns {Promise<Object>}
 */
const verifyToken = async (token, type) => {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (type && payload.type !== type) {
      throw new Error('Invalid token type');
    }
    return payload;
  } catch (error) {
    throw new Error('Invalid token', { cause: error });
  }
};

/**
 * Generate auth tokens
 * @param {Object} user
 * @returns {Object}
 */
const generateAuthTokens = (user) => {
  const accessTokenExpires = moment().add(config.jwt.accessExpirationMinutes, 'minutes');
  const accessToken = generateToken(
    user.id,
    accessTokenExpires,
    tokenTypes.ACCESS,
    config.jwt.secret
  );

  const refreshTokenExpires = moment().add(config.jwt.refreshExpirationDays, 'days');
  const refreshToken = generateToken(
    user.id,
    refreshTokenExpires,
    tokenTypes.REFRESH,
    config.jwt.secret
  );

  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires.toDate(),
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires.toDate(),
    },
  };
};

/**
 * Generate reset password token
 * @param {Object} user
 * @returns {string}
 */
const generateResetPasswordToken = (user) => {
  const expires = moment().add(config.jwt.resetPasswordExpirationMinutes, 'minutes');
  return generateToken(user.id, expires, tokenTypes.RESET_PASSWORD, config.jwt.secret);
};

/**
 * Generate verify email token
 * @param {Object} user
 * @returns {string}
 */
const generateVerifyEmailToken = (user) => {
  const expires = moment().add(config.jwt.verifyEmailExpirationMinutes, 'minutes');
  return generateToken(user.id, expires, tokenTypes.VERIFY_EMAIL, config.jwt.secret);
};

module.exports = {
  generateToken,
  verifyToken,
  generateAuthTokens,
  generateResetPasswordToken,
  generateVerifyEmailToken,
};
