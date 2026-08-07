'use strict';

const { tokenTypes, tokenExpiration } = require('../../../src/config/tokens');

describe('config/tokens', () => {
  test('exports token types', () => {
    expect(tokenTypes).toEqual({
      ACCESS: 'access',
      REFRESH: 'refresh',
      RESET_PASSWORD: 'resetPassword',
      VERIFY_EMAIL: 'verifyEmail',
    });
  });

  test('exports token expirations', () => {
    expect(tokenExpiration).toEqual({
      ACCESS: '15m',
      REFRESH: '7d',
      RESET_PASSWORD: '10m',
      VERIFY_EMAIL: '24h',
    });
  });
});
