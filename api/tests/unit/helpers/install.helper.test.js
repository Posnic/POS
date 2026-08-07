'use strict';

const helper = require('../../../src/helpers/install.helper');

describe('install.helper', () => {
  test('exports install helper functions', () => {
    expect(helper.isValidObjectId('a'.repeat(24))).toBe(true);
    expect(
      helper.sanitizeInstallData({ register_companyname: ' ACME ' }).register_companyname
    ).toBe('ACME');
  });
});
