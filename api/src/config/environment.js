const env = process.env.NODE_ENV || 'development';

const config = {
  development: {
    env,
    port: process.env.PORT || 5000,
    mongo: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/PosnicPro',
      options: {
        // Removed deprecated options
      },
    },
    jwt: {
      // Never a literal, even in development - see config/signing-secret.
      secret: process.env.JWT_SECRET || require('./signing-secret').ephemeralSecret('JWT_SECRET'),
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
      cookieExpiresIn: process.env.JWT_COOKIE_EXPIRES_IN || 30,
    },
  },
  test: {
    env: 'test',
    port: process.env.TEST_PORT || 5001,
    mongo: {
      uri: process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/posnicpro_test',
      options: {
        // Removed deprecated options
      },
    },
  },
  production: {
    env: 'production',
    port: process.env.PORT || 5000,
    mongo: {
      uri: process.env.MONGODB_URI_PROD || process.env.MONGODB_URI,
      options: {
        // Removed deprecated options
      },
    },
  },
};

const envConfig = config[env] || config.development;

// Export environment variables
module.exports = {
  ...envConfig,
  isDevelopment: env === 'development',
  isTest: env === 'test',
  isProduction: env === 'production',
};

// For backward compatibility
module.exports.env = env;
module.exports.mongo = envConfig.mongo;
module.exports.port = envConfig.port;
