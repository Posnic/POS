require('dotenv').config({ quiet: true });

module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 5000,
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0',
  },

  // Database configuration
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/PosnicPro',
    options: {
      useFindAndModify: false,
    },
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || null,
    expiresIn: process.env.JWT_EXPIRES_IN || '90d',
    cookieExpiresIn: process.env.JWT_COOKIE_EXPIRES_IN || 90,
  },

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || null,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  },

  // Security
  security: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10,
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
    },
  },

  // Email configuration
  email: {
    host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
    port: process.env.EMAIL_PORT || 2525,
    username: process.env.EMAIL_USERNAME || '',
    password: process.env.EMAIL_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'no-reply@Api_v2_express.com',
    secure: process.env.EMAIL_SECURE === 'true',
  },

  // Application URLs
  urls: {
    frontend: process.env.FRONTEND_URL || 'http://localhost:3000',
    api: process.env.API_URL || 'http://localhost:5000/api',
    publicServer:
      process.env.PUBLIC_SERVER_URL || process.env.SERVER_URL || process.env.CLI_HOST || '',
    corsOrigins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:3000'],
  },
  cliHost: process.env.PUBLIC_SERVER_URL || process.env.SERVER_URL || process.env.CLI_HOST || '',

  // File uploads
  uploads: {
    maxFileSize: parseInt(process.env.MAX_FILE_UPLOAD) || 5 * 1024 * 1024, // 5MB
    uploadPath: process.env.FILE_UPLOAD_PATH || './public/uploads',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    toFile: process.env.LOG_TO_FILE === 'true',
  },

  // Cache
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    ttl: parseInt(process.env.CACHE_TTL) || 3600, // 1 hour in seconds
  },

  // SMS Configuration
  sms: {
    provider: process.env.SMS_PROVIDER || 'msg91', // "msg91" or "brevo"
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY || null,
      templateId: process.env.MSG91_TEMPLATE_ID || null,
      apiUrl: 'https://control.msg91.com/api/v5/flow',
    },
    brevo: {
      apiKey: process.env.BREVO_API_KEY || process.env.SENDINBLUE_KEY || null,
      sender: process.env.SMS_SENDER || 'POSNIC',
    },
  },

  // AWS S3 Configuration
  s3: {
    version: process.env.S3_VERSION || 'latest',
    region: process.env.S3_REGION || 'ap-south-1',
    key: process.env.S3_KEY || null,
    secret: process.env.S3_SECRET || null,
    bucket: process.env.S3_BUCKET || null,
    smsBucket: 'msg91input',
  },

  // Encryption Configuration
  encryption: {
    key: process.env.ENCRYPTION_KEY || null,
    iv: process.env.ENCRYPTION_IV || null,
  },

  // Installation Configuration
  // These guard /api/install/add and /api/install/cleanup, and cleanup deletes
  // every record for a licence. They used to fall back to a fixed string in
  // this file, which meant a public repository shipped a working credential for
  // every deployment that had not overridden it.
  //
  // No fallback now. Unset means the check can never pass, so a shop that has
  // not been configured refuses installation rather than accepting anyone's.
  // A local desktop install sets these from its own generated pair.
  posnic_key: process.env.POSNIC_KEY || null,
  posnic_secret: process.env.POSNIC_SECRET || null,
};
