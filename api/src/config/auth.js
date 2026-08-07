const { isProduction } = require('./environment');
const { ephemeralSecret } = require('./signing-secret');

// Default JWT configuration
const getJwtConfig = () => ({
  // Secret key for signing JWT tokens. Never a literal - see signing-secret.
  secret: process.env.JWT_SECRET || ephemeralSecret('JWT_SECRET'),

  // Token expiration
  accessToken: {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m', // Shorter for better security
    type: 'access',
  },
  refreshToken: {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    type: 'refresh',
  },

  // Token issuer and audience
  issuer: process.env.JWT_ISSUER || 'posnicpro-api',
  audience: process.env.JWT_AUDIENCE || 'posnicpro-client',

  // Algorithm for signing
  algorithm: 'HS256',
});

// API Keys configuration
const getApiKeys = () => {
  // Load API keys from environment variables if available
  const apiKeysEnv = process.env.API_KEYS;
  if (apiKeysEnv) {
    try {
      return JSON.parse(apiKeysEnv);
    } catch (error) {
      console.error('Failed to parse API_KEYS environment variable', error);
    }
  }

  /*
   * No API_KEYS, no API keys.
   *
   * Two were returned here by default - dev_web_key_12345 and
   * dev_mobile_key_12345 - labelled "for development only". Nothing in the API
   * reads config.apiKeys today, so they authenticated nothing; but once this
   * repository is public they are two published credentials sitting in the
   * config object, waiting for the first piece of code that decides to check
   * against it.
   *
   * An empty set fails closed. A caller presenting a key gets no match, which
   * is the correct answer when the operator has not configured any.
   */
  return {};
};

// Password policy
const passwordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  maxAgeDays: 90, // Password expiration in days
  history: 5, // Number of previous passwords to remember
  maxAttempts: 5, // Maximum failed login attempts
  lockoutTime: 15, // Lockout time in minutes after max attempts
};

// Rate limiting for authentication endpoints
const rateLimiting = {
  // Login attempts rate limiting
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login requests per windowMs
    message: 'Too many login attempts, please try again later',
  },
  // Password reset requests
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Too many password reset requests, please try again later',
  },
};

// Session management
const sessionConfig = {
  // Cookie settings
  cookie: {
    name: 'posnicpro_session',
    httpOnly: true,
    secure: isProduction, // Only send over HTTPS in production
    sameSite: 'lax', // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    domain: process.env.COOKIE_DOMAIN || 'localhost',
  },

  // Session storage options
  store: {
    // Can be 'memory', 'redis', or 'mongo'
    type: process.env.SESSION_STORE || 'memory',

    // Redis connection options (if using redis)
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
    },

    // MongoDB connection options (if using mongo)
    mongo: {
      collection: 'sessions',
      ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    },
  },
};

// OAuth providers configuration
const oauthProviders = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:
      process.env.GOOGLE_CALLBACK_URL || `${process.env.BASE_URL}/api/auth/google/callback`,
  },
  facebook: {
    clientId: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL:
      process.env.FACEBOOK_CALLBACK_URL || `${process.env.BASE_URL}/api/auth/facebook/callback`,
  },
  // Add more OAuth providers as needed
};

// CORS configuration
const corsConfig = {
  origin: isProduction
    ? ['https://your-production-domain.com']
    : ['http://localhost:3000', 'http://localhost:8080'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Id'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

// Export the complete auth configuration
module.exports = {
  // JWT configuration
  jwt: getJwtConfig(),

  // API keys
  apiKeys: getApiKeys(),

  // Password policy
  password: passwordPolicy,

  // Rate limiting
  rateLimiting,

  // Session management
  session: sessionConfig,

  // OAuth providers
  oauth: oauthProviders,

  // CORS configuration
  cors: corsConfig,

  // Security headers
  securityHeaders: {
    // Enable security headers
    enabled: true,

    // Security headers configuration
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'",
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    },
  },

  // CSRF protection
  csrf: {
    // Enable CSRF protection
    enabled: true,

    // Cookie options for CSRF token
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
    },
  },
};
