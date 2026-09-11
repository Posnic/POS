const path = require('path');
const Joi = require('joi');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

// Define the schema for environment variables
const envVarsSchema = Joi.object()
  .keys({
    // Server
    NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
    PORT: Joi.alternatives().try(Joi.number(), Joi.string()).default(3000),
    HOST: Joi.string().default('0.0.0.0'),
    CORS_ORIGIN: Joi.string().default('*').description('CORS origin'),

    // Database
    MONGODB_URI: Joi.string()
      .default('mongodb://localhost:27017/posnic')
      .description('MongoDB connection URL'),
    MONGO_USERNAME: Joi.string().allow(''),
    MONGO_PASSWORD: Joi.string().allow(''),
    MONGO_DATABASE: Joi.string().default('posnic'),

    // JWT
    /*
     * No defaults for anything that signs.
     *
     * These carried Joi defaults - "your_jwt_super_secret_key_change_in_production"
     * and the like. A default is worse than a missing value here: it makes the
     * schema validate, so the API starts and signs real tokens with a string
     * printed in a public repository. Required, so a deployment without one
     * fails at startup where it can be seen, rather than quietly issuing
     * forgeable logins.
     *
     * verify-secrets checks the same names before the server listens; this is
     * the second lock on the same door, for any path that reads config without
     * going through it.
     */
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    JWT_EXPIRES_IN: Joi.string().default('90d').description('JWT expiration time'),
    JWT_REFRESH_SECRET: Joi.string().required().description('JWT refresh secret key'),
    JWT_REFRESH_EXPIRES_IN: Joi.string()
      .default('7d')
      .description('JWT refresh token expiration time'),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: Joi.alternatives()
      .try(Joi.number(), Joi.string())
      .default(15 * 60 * 1000), // 15 minutes
    RATE_LIMIT_MAX: Joi.alternatives().try(Joi.number(), Joi.string()).default(100),

    // Email (optional - allow empty to avoid hard-failing when SMTP is not configured)
    EMAIL_HOST: Joi.string().optional().allow('').description('SMTP host'),
    EMAIL_PORT: Joi.alternatives()
      .try(Joi.number(), Joi.string())
      .optional()
      .allow('')
      .description('SMTP port'),
    EMAIL_USERNAME: Joi.string().optional().allow('').description('SMTP username'),
    EMAIL_PASSWORD: Joi.string().optional().allow('').description('SMTP password'),
    EMAIL_FROM: Joi.string()
      .optional()
      .allow('')
      .description('The from field in the emails sent by the app'),

    // Security
    HELMET_ENABLED: Joi.boolean().default(true),
    CSP_ENABLED: Joi.boolean().default(true),

    // Session
    SESSION_SECRET: Joi.string().required(),

    // File Uploads
    MAX_FILE_UPLOAD: Joi.alternatives().try(Joi.number(), Joi.string()).default(5), // in MB
    FILE_UPLOAD_PATH: Joi.string().default(path.join(__dirname, '../../public/uploads')),

    // Logging
    LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
    LOG_FILE: Joi.string().default(path.join(__dirname, '../../logs/app.log')),
    ERROR_LOG_FILE: Joi.string().default(path.join(__dirname, '../../logs/error.log')),

    // Third-party Services
    RAZORPAY_KEY_ID: Joi.string(),
    RAZORPAY_KEY_SECRET: Joi.string(),
    AWS_ACCESS_KEY_ID: Joi.string(),
    AWS_SECRET_ACCESS_KEY: Joi.string(),
    AWS_REGION: Joi.string(),
    AWS_BUCKET_NAME: Joi.string(),
    SENDINBLUE_API_KEY: Joi.string(),

    // Guards the install and cleanup endpoints, and cleanup deletes a whole
    // shop. No default: a fixed one in a public repository is a working
    // credential for anybody who has not overridden it.
    POSNIC_KEY: Joi.string().optional(),
    POSNIC_SECRET: Joi.string().optional(),
  })
  .unknown();

// Validate environment variables
const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Export the validated configuration
module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  host: envVars.HOST,
  cors: {
    origin: envVars.CORS_ORIGIN,
  },
  mongoose: {
    url: envVars.MONGODB_URI + (envVars.NODE_ENV === 'test' ? '-test' : ''),
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      user: envVars.MONGO_USERNAME || undefined,
      pass: envVars.MONGO_PASSWORD || undefined,
      dbName: envVars.MONGO_DATABASE,
    },
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: envVars.JWT_EXPIRES_IN,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
  },
  rateLimit: {
    windowMs: Number(envVars.RATE_LIMIT_WINDOW_MS),
    max: Number(envVars.RATE_LIMIT_MAX),
  },
  email: {
    host: envVars.EMAIL_HOST,
    port: envVars.EMAIL_PORT,
    auth: {
      user: envVars.EMAIL_USERNAME,
      pass: envVars.PASSWORD,
    },
    from: envVars.EMAIL_FROM,
  },
  security: {
    helmet: envVars.HELMET_ENABLED === 'true',
    csp: envVars.CSP_ENABLED === 'true',
  },
  session: {
    secret: envVars.SESSION_SECRET,
  },
  upload: {
    maxFileSize: Number(envVars.MAX_FILE_UPLOAD) * 1024 * 1024, // Convert to bytes
    uploadPath: envVars.FILE_UPLOAD_PATH,
  },
  logs: {
    level: envVars.LOG_LEVEL,
    logFile: envVars.LOG_FILE,
    errorLogFile: envVars.ERROR_LOG_FILE,
  },
  razorpay: {
    keyId: envVars.RAZORPAY_KEY_ID,
    keySecret: envVars.RAZORPAY_KEY_SECRET,
  },
  aws: {
    accessKeyId: envVars.AWS_ACCESS_KEY_ID,
    secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
    region: envVars.AWS_REGION,
    bucket: envVars.AWS_BUCKET_NAME,
  },
  sendinblue: {
    apiKey: envVars.SENDINBLUE_API_KEY,
  },
  sendinblue_key: envVars.SENDINBLUE_API_KEY, // For backward compatibility
  api: {
    posnicKey: envVars.POSNIC_KEY,
    posnicSecret: envVars.POSNIC_SECRET,
  },
};
