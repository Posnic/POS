/**
 * Custom ErrorResponse class to handle API errors
 * @extends Error
 */
class ErrorResponse extends Error {
  /**
   * Create an error response
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {Object} [errors] - Additional error details
   */
  constructor(message, statusCode, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Create a 400 Bad Request error
   * @param {string} message - Error message
   * @param {Object} [errors] - Additional error details
   * @returns {ErrorResponse}
   */
  static badRequest(message = 'Bad Request', errors = null) {
    return new ErrorResponse(message, 400, errors);
  }

  /**
   * Create a 401 Unauthorized error
   * @param {string} message - Error message
   * @returns {ErrorResponse}
   */
  static unauthorized(message = 'Not authorized to access this route') {
    return new ErrorResponse(message, 401);
  }

  /**
   * Create a 403 Forbidden error
   * @param {string} message - Error message
   * @returns {ErrorResponse}
   */
  static forbidden(message = 'Forbidden') {
    return new ErrorResponse(message, 403);
  }

  /**
   * Create a 404 Not Found error
   * @param {string} resource - Name of the resource not found
   * @returns {ErrorResponse}
   */
  static notFound(resource = 'Resource') {
    return new ErrorResponse(`${resource} not found`, 404);
  }

  /**
   * Create a 409 Conflict error
   * @param {string} message - Error message
   * @param {Object} [errors] - Additional error details
   * @returns {ErrorResponse}
   */
  static conflict(message = 'Conflict', errors = null) {
    return new ErrorResponse(message, 409, errors);
  }

  /**
   * Create a 422 Validation error
   * @param {Object} errors - Validation errors
   * @returns {ErrorResponse}
   */
  static validationError(errors) {
    return new ErrorResponse('Validation Error', 422, errors);
  }

  /**
   * Create a 500 Internal Server Error
   * @param {string} message - Error message
   * @returns {ErrorResponse}
   */
  static serverError(message = 'Internal Server Error') {
    return new ErrorResponse(message, 500);
  }

  /**
   * Format error response for the client
   * @param {Object} error - The error object
   * @returns {Object} Formatted error response
   */
  static formatError(error) {
    if (error instanceof ErrorResponse) {
      return {
        success: false,
        status: error.status,
        statusCode: error.statusCode,
        message: error.message,
        ...(error.errors && { errors: error.errors }),
      };
    }

    // Default error response for unhandled errors
    return {
      success: false,
      status: 'error',
      statusCode: 500,
      message: 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    };
  }
}

module.exports = ErrorResponse;
