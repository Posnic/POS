'use strict';

const loadModule = (modulePath) => {
  jest.resetModules();
  return require(modulePath);
};

describe('config modules', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('config.js maps environment defaults correctly', () => {
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.HOST;
    delete process.env.MONGODB_URI;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_COOKIE_EXPIRES_IN;
    process.env.JWT_SECRET = 'your_jwt_super_secret_key_change_in_production';

    const config = loadModule('../../../src/config/config');

    expect(config.server).toEqual({
      // The port is parsed to a NUMBER now - a string port broke
      // listen() comparisons downstream.
      port: 5000,
      env: 'development',
      host: '0.0.0.0',
    });
    expect(config.database.uri).toBe('mongodb://localhost:27017/PosnicPro');
    expect(config.jwt.secret).toBe('your_jwt_super_secret_key_change_in_production');
    expect(config.session.cookie.secure).toBe(false);
  });

  test('environment.js exposes development defaults', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '6001';
    process.env.MONGODB_URI = 'mongodb://example/db';

    const config = loadModule('../../../src/config/environment');

    expect(config.env).toBe('development');
    expect(config.port).toBe('6001');
    expect(config.mongo.uri).toBe('mongodb://example/db');
    expect(config.isDevelopment).toBe(true);
    expect(config.isTest).toBe(false);
    expect(config.isProduction).toBe(false);
  });

  test('environment.js exposes test defaults', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI_TEST;

    const config = loadModule('../../../src/config/environment');

    expect(config.env).toBe('test');
    expect(config.port).toBe(5001);
    expect(config.mongo.uri).toBe('mongodb://localhost:27017/posnicpro_test');
    expect(config.mongo.options).toEqual({});
    expect(config.isTest).toBe(true);
  });

  test('index.js validates env and derives config', () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3005';
    process.env.CORS_ORIGIN = 'http://a.com,http://b.com';
    process.env.MONGODB_URI = 'mongodb://example/posnic';
    process.env.JWT_SECRET = 'secret';
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.JWT_REFRESH_SECRET = 'refresh';
    process.env.JWT_REFRESH_EXPIRES_IN = '1d';
    process.env.RATE_LIMIT_WINDOW_MS = '9000';
    process.env.RATE_LIMIT_MAX = '42';
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_PORT = '2525';
    process.env.EMAIL_USERNAME = 'user';
    process.env.EMAIL_PASSWORD = 'pass';
    process.env.EMAIL_FROM = 'from@example.com';
    process.env.HELMET_ENABLED = 'true';
    process.env.CSP_ENABLED = 'false';
    process.env.SESSION_SECRET = 'session';
    process.env.MAX_FILE_UPLOAD = '10';
    process.env.FILE_UPLOAD_PATH = '/tmp/uploads';
    process.env.LOG_LEVEL = 'warn';
    process.env.LOG_FILE = '/tmp/app.log';
    process.env.ERROR_LOG_FILE = '/tmp/error.log';
    process.env.SENDINBLUE_API_KEY = 'send-key';
    process.env.POSNIC_KEY = 'posnic';
    process.env.POSNIC_SECRET = 'secret';

    const config = loadModule('../../../src/config/index');

    expect(config.env).toBe('test');
    expect(config.port).toBe(3005);
    expect(config.cors.origin).toBe('http://a.com,http://b.com');
    expect(config.mongoose.url).toBe('mongodb://example/posnic-test');
    expect(config.rateLimit).toEqual({ windowMs: 9000, max: 42 });
    expect(config.upload.maxFileSize).toBe(10 * 1024 * 1024);
    expect(config.security).toEqual({ helmet: false, csp: false });
    expect(config.sendinblue_key).toBe('send-key');
    expect(config.api).toEqual({ posnicKey: 'posnic', posnicSecret: 'secret' });
  });
});
