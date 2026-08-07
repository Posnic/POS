'use strict';

describe('config/index', () => {
  /*
   * The signing secrets have to be supplied, because the schema now requires
   * them rather than defaulting.
   *
   * They used to carry Joi defaults - "your_jwt_super_secret_key_change_in_production"
   * and the like - which meant the configuration validated with none set, and
   * the API would start and sign real tokens with a string printed in a public
   * repository. Required is the correct behaviour; this test just has to
   * behave like a real deployment and provide them.
   *
   * Test fixtures, not secrets: they sign nothing outside this file.
   */
  const REQUIRED_SECRETS = {
    JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-only-refresh-secret-0123456789ab',
    SESSION_SECRET: 'test-only-session-secret-0123456789ab',
  };

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_SECRETS);
  });

  afterEach(() => {
    jest.resetModules();
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_URI_TEST;
    for (const name of Object.keys(REQUIRED_SECRETS)) delete process.env[name];
  });

  test('exports development config by default', () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const config = require('../../../src/config/index');
    expect(config).toEqual(
      expect.objectContaining({
        env: 'development',
        port: expect.anything(),
      })
    );
  });
});
