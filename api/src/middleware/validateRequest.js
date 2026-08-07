const { validationResult, body, param, query } = require('express-validator');
const { ObjectId } = require('mongodb');

/**
 * Validation middleware that processes validation chains and formats errors
 * @param {Array} validations - Array of express-validator validation chains
 */
const validateRequest = (validations) => {
  return async (req, res, next) => {
    try {
      // Run all validations
      await Promise.all(validations.map((validation) => validation.run(req)));

      // Check for validation errors
      const errors = validationResult(req);

      if (errors.isEmpty()) {
        // Sanitize all request data if validation passes
        req.body = sanitizeInput(req.body);
        req.query = sanitizeInput(req.query);
        req.params = sanitizeInput(req.params);

        return next();
      }

      // Format validation errors
      const formattedErrors = errors.array().reduce((acc, error) => {
        // Handle nested fields (e.g., 'user.address.street')
        const path = error.param.split('.');
        let current = acc;

        while (path.length > 1) {
          const key = path.shift();
          current[key] = current[key] || {};
          current = current[key];
        }

        current[path[0]] = error.msg;
        return acc;
      }, {});

      return res.status(422).json({
        status: 'error',
        message: 'Validation failed',
        errors: formattedErrors,
        code: 422,
      });
    } catch (error) {
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error during validation',
        code: 500,
      });
    }
  };
};

/**
 * Sanitizes input data to prevent XSS and other injections
 * @param {*} data - Data to be sanitized
 * @returns {*} Sanitized data
 */
const sanitizeInput = (data) => {
  if (data === null || data === undefined) {
    return data;
  }

  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      // Remove HTML tags and trim whitespace
      return value.replace(/<[^>]*>?/gm, '').trim();
    }
    return value;
  };

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeInput(item));
  }

  if (
    data !== null &&
    typeof data === 'object' &&
    !(data instanceof ObjectId) &&
    !(data instanceof Date)
  ) {
    const sanitized = Array.isArray(data) ? [] : {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        sanitized[key] = sanitizeInput(data[key]);
      }
    }
    return sanitized;
  }

  return sanitizeValue(data);
};

/**
 * Common validation rules that can be reused across routes
 */
const commonValidators = {
  // MongoDB ObjectId validation
  mongoId: (field = 'id', location = 'params') => {
    const locations = {
      params: param,
      query: query,
      body: body,
    };

    return locations[location](field)
      .trim()
      .notEmpty()
      .withMessage(`${field} is required`)
      .isMongoId()
      .withMessage(`Invalid ${field} format`)
      .customSanitizer((value) => new ObjectId(value));
  },

  // Email validation
  email: (field = 'email', location = 'body') => {
    const locations = {
      params: param,
      query: query,
      body: body,
    };

    return locations[location](field)
      .trim()
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail();
  },

  // Password validation
  password: (field = 'password', location = 'body') => {
    const locations = {
      params: param,
      query: query,
      body: body,
    };

    return locations[location](field)
      .trim()
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/\d/)
      .withMessage('Password must contain at least one number')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter');
  },

  // Pagination validation
  pagination: () => [
    query('page').optional().isInt().withMessage('Page must be an integer').toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('sort').optional().isString().withMessage('Sort must be a string').trim(),
  ],
};

/**
 * Middleware to validate file uploads
 */
const validateFile = (fieldName, options = {}) => {
  const {
    required = true,
    fileTypes = ['image/jpeg', 'image/png', 'application/pdf'],
    maxSize = 5 * 1024 * 1024, // 5MB default
  } = options;

  return (req, res, next) => {
    if (!req.file && required) {
      return res.status(400).json({
        status: 'error',
        message: 'File is required',
        code: 400,
      });
    }

    if (req.file) {
      // Check file type
      if (!fileTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid file type. Allowed types: ${fileTypes.join(', ')}`,
          code: 400,
        });
      }

      // Check file size
      if (req.file.size > maxSize) {
        return res.status(400).json({
          status: 'error',
          message: `File size exceeds the maximum limit of ${maxSize / (1024 * 1024)}MB`,
          code: 400,
        });
      }
    }

    next();
  };
};

module.exports = {
  validateRequest,
  sanitizeInput,
  commonValidators,
  validateFile,
};
