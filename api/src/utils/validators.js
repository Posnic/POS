const Joi = require('joi');

// Common validation patterns
const patterns = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  phone: /^[0-9]{10,15}$/,
  objectId: /^[0-9a-fA-F]{24}$/,
  username: /^[a-zA-Z0-9_]{3,30}$/,
};

// Common validation messages
const messages = {
  'string.empty': '{#label} cannot be empty',
  'string.pattern.base': 'Please provide a valid {#label}',
  'any.required': '{#label} is required',
  'string.min': '{#label} must be at least {#limit} characters long',
  'string.max': '{#label} must not exceed {#limit} characters',
  'string.email': 'Please provide a valid email address',
  'string.base': '{#label} must be a string',
  'number.base': '{#label} must be a number',
  'boolean.base': '{#label} must be a boolean',
  'array.base': '{#label} must be an array',
  'object.unknown': 'Unknown field: {#child}',
};

// Common validation rules
const common = {
  email: Joi.string().email().pattern(patterns.email).required().messages({
    'string.email': messages['string.email'],
    'string.empty': messages['string.empty'],
    'any.required': messages['any.required'],
  }),

  password: Joi.string().min(8).pattern(patterns.password).required().messages({
    'string.pattern.base':
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    'string.min': messages['string.min'],
    'string.empty': messages['string.empty'],
    'any.required': messages['any.required'],
  }),

  objectId: Joi.string().pattern(patterns.objectId).message('Invalid ID format'),
};

// Validation schemas
const authSchemas = {
  register: Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: common.email,
    password: common.password,
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Passwords do not match',
      'any.required': 'Please confirm your password',
    }),
    role: Joi.string().valid('user', 'admin').default('user'),
  }),

  login: Joi.object({
    email: common.email,
    password: Joi.string().required().messages({
      'string.empty': 'Password is required',
    }),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required().messages({
      'string.empty': 'Refresh token is required',
    }),
  }),

  forgotPassword: Joi.object({
    email: common.email,
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: common.password,
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Passwords do not match',
      'any.required': 'Please confirm your password',
    }),
  }),
};

const userSchemas = {
  updateProfile: Joi.object({
    name: Joi.string().min(3).max(50),
    email: Joi.string().email(),
    phone: Joi.string().pattern(patterns.phone).allow('', null),
    photo: Joi.string().uri().allow('', null),
    bio: Joi.string().max(500).allow('', null),
  }).min(1),

  updatePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: common.password,
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Passwords do not match',
      'any.required': 'Please confirm your new password',
    }),
  }),
};

// Query params validation
const queryParams = {
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sort: Joi.string().default('-createdAt'),
    fields: Joi.string(),
    search: Joi.string(),
  }),
};

// Helper function to validate request
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property], {
      abortEarly: false,
      allowUnknown: property === 'query', // Allow unknown query params
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''),
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors,
      });
    }

    next();
  };
};

module.exports = {
  patterns,
  messages,
  common,
  auth: authSchemas,
  user: userSchemas,
  query: queryParams,
  validate,
};
