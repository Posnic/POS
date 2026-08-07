/**
 * Response Helper
 * Standardized response formatting for controllers
 */

const { HTTP_STATUS, RESPONSE_TYPES } = require('../constants/users.constants');

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {String} message - Success message
 * @param {Number} statusCode - HTTP status code (default: 200)
 */
const sendSuccess = (res, data = null, message = 'Success', statusCode = HTTP_STATUS.OK) => {
  return res.status(statusCode).json({
    type: RESPONSE_TYPES.SUCCESS,
    message,
    data,
  });
};

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 * @param {Number} statusCode - HTTP status code (default: 500)
 * @param {*} data - Optional error data
 */
const sendError = (
  res,
  message = 'An error occurred',
  statusCode = HTTP_STATUS.INTERNAL_ERROR,
  data = null
) => {
  return res.status(statusCode).json({
    type: RESPONSE_TYPES.ERROR,
    message,
    data,
  });
};

/**
 * Send validation error response
 * @param {Object} res - Express response object
 * @param {Array} errors - Validation errors array
 */
const sendValidationError = (res, errors = []) => {
  return res.status(HTTP_STATUS.BAD_REQUEST).json({
    type: RESPONSE_TYPES.ERROR,
    message: 'Validation Error',
    data: errors,
  });
};

/**
 * Send unauthorized response
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 */
const sendUnauthorized = (res, message = 'Unauthorized') => {
  return res.status(HTTP_STATUS.UNAUTHORIZED).json({
    type: RESPONSE_TYPES.ERROR,
    message,
    data: null,
  });
};

/**
 * Send not found response
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 */
const sendNotFound = (res, message = 'Resource not found') => {
  return res.status(HTTP_STATUS.NOT_FOUND).json({
    type: RESPONSE_TYPES.ERROR,
    message,
    data: null,
  });
};

/**
 * Handle service response
 * Maps service layer response to HTTP response
 * @param {Object} res - Express response object
 * @param {Object} serviceResponse - Response from service layer
 * @param {Object} options - Optional configuration { successCode, errorCode }
 */
const handleServiceResponse = (res, serviceResponse, options = {}) => {
  const { successCode = HTTP_STATUS.OK, errorCode = HTTP_STATUS.INTERNAL_ERROR } = options;

  if (!serviceResponse) {
    return sendError(res, 'Service returned no response', errorCode);
  }

  // Handle different response status types
  if (serviceResponse.status === true) {
    return sendSuccess(res, serviceResponse.data, serviceResponse.message, successCode);
  }

  if (serviceResponse.status === 'exist') {
    return res.status(HTTP_STATUS.NOT_ACCEPTABLE).json({
      type: RESPONSE_TYPES.ERROR,
      message: serviceResponse.message,
      data: serviceResponse.data,
    });
  }

  if (serviceResponse.status === 'none') {
    return sendNotFound(res, serviceResponse.message);
  }

  if (serviceResponse.status === 'incorrect' || serviceResponse.status === false) {
    return sendError(res, serviceResponse.message, errorCode, serviceResponse.data);
  }

  if (serviceResponse.status === 'success') {
    return sendSuccess(res, serviceResponse.data, serviceResponse.message, successCode);
  }

  // Default error handling
  return sendError(
    res,
    serviceResponse.message || 'Operation failed',
    errorCode,
    serviceResponse.data
  );
};

module.exports = {
  sendSuccess,
  sendError,
  sendValidationError,
  sendUnauthorized,
  sendNotFound,
  handleServiceResponse,
};
