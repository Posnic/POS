const { authCookieOptions } = require('../../../src/utils/auth-cookie');

describe('auth cookie options', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('uses cross-site secure cookies for local browser development', () => {
    process.env.NODE_ENV = 'development';
    expect(authCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  });

  test('uses cross-site secure cookies in production', () => {
    process.env.NODE_ENV = 'production';
    expect(authCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  });
});
