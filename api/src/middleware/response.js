/**
 * Standardized response helper middleware
 * Implements the same response format as PHP backend: {status, message, data, code}
 */

/**
 * Send a success response
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {*} data - Response data
 * @param {number} code - HTTP status code (default: 200)
 */
const success = (res, message = 'Operation completed successfully', data = null, code = 200) => {
  if (!res || typeof res.status !== 'function' || typeof res.json !== 'function') {
    console.error('Invalid response object provided to success()');
    return;
  }

  // If data is provided but no message, use a default success message
  if (data && !message) {
    message = 'Operation completed successfully';
  }

  // PHP-compatible response format
  const response = {
    type: 'success', // Changed from 'status' to match PHP
    message,
    data: data !== null && data !== undefined ? data : null,
  };

  return res.status(code).json(response);
};

/**
 * Send an error response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {*} data - Additional error data
 * @param {number} code - HTTP status code (default: 400)
 */
const error = (res, message = 'An error occurred', data = null, code = 400) => {
  if (!res || typeof res.status !== 'function' || typeof res.json !== 'function') {
    console.error('Invalid response object provided to error()');
    return;
  }

  // If we get an Error object, extract the message
  if (message instanceof Error) {
    data = message.data || data;
    code = message.statusCode || code;
    message = message.message || 'An unexpected error occurred';
  }

  // PHP-compatible response format
  const response = {
    type: 'error', // Changed from 'status' to match PHP
    message,
    data: data !== null && data !== undefined ? data : null,
  };

  return res.status(code).json(response);
};

/**
 * Middleware to add response helpers to res object
 */
const responseMiddleware = (req, res, next) => {
  // Add response methods to the response object
  res.success = (message, data, code) => success(res, message, data, code);
  res.error = (message, data, code) => error(res, message, data, code);

  // Add a safe method that ensures the response hasn't been sent yet
  res.safeJson = (data, status = 200, message = '') => {
    if (res.headersSent) {
      console.warn('Headers already sent, cannot send response');
      return;
    }

    // If data is an error object, use the error handler
    if (data instanceof Error) {
      return res.error(data);
    }

    // If status is an error status, format as error
    if (status >= 400) {
      return res.error(message || 'An error occurred', data, status);
    }

    // Otherwise, format as success
    return res.success(message, data, status);
  };

  // Add a not found helper
  res.notFound = (message = 'Resource not found') => {
    return res.error(message, null, 404);
  };

  // Add a validation error helper
  res.validationError = (errors, message = 'Validation failed') => {
    return res.error(message, { errors }, 422);
  };

  // Add an unauthorized helper
  res.unauthorized = (message = 'Unauthorized') => {
    return res.error(message, null, 401);
  };

  // Add a forbidden helper
  res.forbidden = (message = 'Forbidden') => {
    return res.error(message, null, 403);
  };

  next();
};

// Export the middleware and helper functions
module.exports = {
  success,
  error,
  responseMiddleware,
};
