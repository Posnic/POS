'use strict';

describe('config/environment', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.MONGODB_URI_TEST;
    delete process.env.MONGODB_URI_PROD;
  });

  test('exports test environment defaults', () => {
    process.env.NODE_ENV = 'test';
    const env = require('../../../src/config/environment');
    expect(env.env).toBe('test');
    expect(env.isTest).toBe(true);
    expect(env.port).toBe(5001);
    expect(env.mongo.uri).toBe('mongodb://localhost:27017/posnicpro_test');
  });
});
