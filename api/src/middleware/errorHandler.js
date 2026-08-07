require('jsonwebtoken');
require('mongodb');

// Custom Error Classes
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(errors, message = 'Validation failed') {
    super(message, 422);
    this.errors = errors;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409);
  }
}

// Error handling utilities
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new ValidationError(errors, message);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again!', 401);
const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

// Error response handlers
const sendErrorDev = (err, req, res) => {
  console.error('ERROR 💥', err);

  const response = {
    // PHP-compatible envelope for legacy frontend
    type: 'error',
    message: err.message || 'An error occurred',
    data: null,
    // Keep existing status/error payload for API consumers
    status: 'error',
    error: {
      statusCode: err.statusCode || 500,
      status: err.status || 'error',
      isOperational: err.isOperational || false,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        name: err.name,
        ...(err.errors && { errors: err.errors }),
      }),
    },
  };

  return res.status(err.statusCode || 500).json(response);
};

const sendErrorProd = (err, req, res) => {
  // Log the error for server-side monitoring
  if (!err.isOperational) {
    console.error('ERROR 💥', err);
  }

  // For API requests
  if (req.originalUrl.startsWith('/api')) {
    // Operational, trusted error: send message to client
    if (err.isOperational) {
      return res.status(err.statusCode || 500).json({
        // PHP-compatible envelope
        type: 'error',
        message: err.message,
        data: null,
        // Existing fields
        status: 'error',
        error: {
          statusCode: err.statusCode,
          status: err.status,
          isOperational: true,
          ...(err.errors && { errors: err.errors }),
        },
      });
    }

    // Programming or other unknown error: don't leak error details
    return res.status(500).json({
      type: 'error',
      message: 'Something went wrong!',
      data: null,
      status: 'error',
      error: {
        statusCode: 500,
        status: 'error',
        isOperational: false,
      },
    });
  }

  // For non-API requests (rendered website)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      type: 'error',
      message: err.message,
      data: null,
      status: 'error',
    });
  }

  // Unknown error in production
  return res.status(500).json({
    type: 'error',
    message: 'Something went wrong!',
    data: null,
    status: 'error',
  });
};

/*
 * Main error handling middleware.
 *
 * It must answer. This tested NODE_ENV against "development" and "production"
 * and did nothing at all when it was neither - no response, no status, nothing
 * written - so the request simply hung until the client gave up. Under
 * NODE_ENV=test that was every error: a request for a path that does not exist
 * never came back with a 404, it never came back at all.
 *
 * The route sweep found this and reported it as hundreds of routes timing out,
 * which read like a slow test and was really one middleware that never
 * replied. Any deployment with NODE_ENV unset behaves the same way.
 *
 * So an unrecognised environment now takes the production path: it says as
 * little as possible about the failure, which is the safe direction to be wrong
 * in.
 */
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err, message: err.message, name: err.name };

    // Handle specific error types
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

    /*
     * A celebrate branch stood here. Request validation in this API is
     * express-validator's; nothing builds a celebrate validator, so no celebrate
     * error could ever arrive. Keeping the branch meant keeping the dependency,
     * which carried two high advisories through a lodash it pins, for code that
     * could not run.
     */

    sendErrorProd(error, req, res);
  }
};

// Not Found Handler
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(
    `The requested resource '${req.originalUrl}' was not found on this server.`
  );

  // If this is an API request, send JSON response immediately
  if (req.originalUrl.startsWith('/api')) {
    return res.status(error.statusCode).json({
      type: 'error',
      message: error.message,
      data: null,
      status: 'error',
      error: {
        statusCode: error.statusCode,
        status: error.status,
        isOperational: error.isOperational,
      },
    });
  }

  // Otherwise, pass to the next error handler
  next(error);
};

// Export the error handler and other utilities
module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,

  // Export the process error handlers as a function that can be called with the server
  setupProcessHandlers: (server) => {
    // Unhandled Rejection Handler
    process.on('unhandledRejection', (err) => {
      console.error('UNHANDLED REJECTION! 💥 Shutting down...');
      console.error(err.name, err.message);

      // Close server & exit process
      if (server && typeof server.close === 'function') {
        server.close(() => {
          console.error('💥 Process terminated!');
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    });

    // Uncaught Exception Handler
    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
      console.error(err.name, err.message);

      // Close server & exit process
      if (server && typeof server.close === 'function') {
        server.close(() => {
          console.error('💥 Process terminated!');
          process.exit(1);
        });
      } else {
        process.exit(1);
      }
    });
  },
};
