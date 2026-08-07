const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');

/*
 * NOTE: nothing in this application mounts anything from this file.
 *
 * The live rate limiting is the general limiter in app.js plus the stricter
 * per-route ones in middleware/auth-rate-limit.js. This is left here because
 * the CORS options and helmet setup below may still be wanted, but do not
 * read it as evidence that these protections are running - they are not.
 *
 * The skip list below used to name /auth/login and /auth/refresh-token,
 * exempting the two routes that most need limiting from the limiter. Written,
 * presumably, meaning "these are special"; the effect was the opposite of the
 * intent, and it would have been a real hole the day somebody mounted this
 * believing it helped. Corrected rather than left as a trap.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  skip: (req) => {
    /* Authentication routes are never exempt - they are the reason to have a
       limiter. Only preflight, which carries no credentials and no body. */
    return req.method === 'OPTIONS';
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Security headers middleware
const securityHeaders = [
  // Set security HTTP headers
  helmet(),

  // Data sanitization against NoSQL query injection
  mongoSanitize(),

  // Data sanitization against XSS
  xss(),

  // Prevent parameter pollution
  hpp({
    whitelist: [
      'duration',
      'ratingsQuantity',
      'ratingsAverage',
      'maxGroupSize',
      'difficulty',
      'price',
    ],
  }),
];

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL : 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Id'],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
};

/*
 * Error handler for security-related errors.
 *
 * This used to open by calling isCelebrate(err). celebrate has never exported
 * anything by that name - the export is isCelebrateError - so the import was
 * undefined and the first line of this handler was a guaranteed TypeError. It
 * went unnoticed because nothing mounts this middleware and its only test mocks
 * celebrate, so the broken call was never made.
 *
 * The branch is gone rather than corrected: request validation here is
 * express-validator's, nothing in this API builds a celebrate validator, and so
 * no celebrate error can reach any handler. Keeping a fixed version would have
 * meant keeping the dependency, which carried two high advisories through a
 * pinned lodash, for a branch that cannot run.
 */
const securityErrorHandler = (err, req, res, next) => {
  // Handle security-related errors
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or missing authentication token',
      code: 401,
    });
  }

  // Pass to the next error handler if not a security error
  next(err);
};

// Request validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const errorDetails = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''),
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errorDetails,
      });
    }
    next();
  };
};

module.exports = {
  apiLimiter,
  securityHeaders,
  corsOptions,
  securityErrorHandler,
  validateRequest,
};
