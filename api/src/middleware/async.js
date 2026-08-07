/**
 * Async middleware wrapper that handles errors in async route handlers
 * @param {Function} fn - The async route handler function
 * @returns {Function} A middleware function that handles async/await errors
 */
const asyncHandler = (fn) => (req, res, next) => {
  // Wrap the async function in a promise to handle both async/await and Promise rejections
  Promise.resolve(fn(req, res, next)).catch((err) => {
    // Log the error for debugging
    console.error('Async middleware error:', err);

    // If headers have already been sent, delegate to the default Express error handler
    if (res.headersSent) {
      return next(err);
    }

    // Handle specific error types
    if (err.name === 'ValidationError') {
      // Handle Mongoose validation errors
      const errors = Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    if (err.name === 'CastError') {
      // Handle invalid ObjectId errors
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format',
        error: err.message,
      });
    }

    if (err.code === 11000) {
      // Handle duplicate key errors
      const field = Object.keys(err.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: 'Duplicate key error',
        error: `${field} already exists`,
      });
    }

    // For custom ErrorResponse objects
    if (err.statusCode) {
      const response = {
        success: false,
        status: err.status || 'error',
        statusCode: err.statusCode,
        message: err.message,
      };

      if (err.errors) {
        response.errors = err.errors;
      }

      return res.status(err.statusCode).json(response);
    }

    // For any other errors, return a 500 response
    console.error('Unhandled error in async middleware:', err);
    res.status(500).json({
      success: false,
      status: 'error',
      statusCode: 500,
      message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });
};

module.exports = asyncHandler;
