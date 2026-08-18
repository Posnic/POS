'use strict';

jest.mock('../../../src/constants/install.constants', () => ({
  FIELD_LIMITS: {
    COMPANY_NAME_MIN: 2,
    COMPANY_NAME_MAX: 20,
    USERNAME_MIN: 2,
    USERNAME_MAX: 20,
    EMAIL_MAX: 50,
    PHONE_MAX: 15,
  },
  ERROR_MESSAGES: {
    COMPANY_NAME_REQUIRED: 'company required',
    COMPANY_NAME_LENGTH: 'company length',
    USERNAME_REQUIRED: 'user required',
    EMAIL_REQUIRED: 'email required',
    VALID_EMAIL_REQUIRED: 'valid email',
    PHONE_LENGTH: 'phone length',
    LICENSE_ID_REQUIRED: 'license required',
    UNAUTHORIZED: 'unauthorized',
  },
}));

jest.mock('express-validator', () => {
  /*
   * A self-returning chain: every method call yields the chain again, so a
   * validator gaining a new chain method (.if() was the one that broke the
   * enumerated version of this mock) never fails the suite at load time.
   */
  const chain = () =>
    new Proxy(function () {}, {
      get: (target, prop) => {
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        return chain();
      },
      apply: () => chain(),
    });
  return { body: jest.fn(() => chain()) };
});

jest.mock('mongodb', () => ({
  ObjectId: { isValid: jest.fn() },
}));

const { ObjectId } = require('mongodb');
const installValidation = require('../../../src/middleware/install.validation');

describe('install.validation', () => {
  test('exports installation validators', () => {
    expect(installValidation.validateInstallation.length).toBeGreaterThan(0);
    expect(installValidation.validateCleanup.length).toBeGreaterThan(0);
  });

  test('unconfigured means CLOSED: no POSNIC_KEY/SECRET answers 503, never lets anyone in', () => {
    const config = require('../../../src/config/config');
    delete config.posnic_key;
    delete config.posnic_secret;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    installValidation.verifyInstallationCredentials({ body: {}, headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('configured + wrong credentials answers 401', () => {
    const config = require('../../../src/config/config');
    config.posnic_key = 'right-key';
    config.posnic_secret = 'right-secret';
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    installValidation.verifyInstallationCredentials(
      { body: { key: 'wrong', secret: 'wrong' }, headers: {} },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    delete config.posnic_key;
    delete config.posnic_secret;
  });

  test('custom objectId validation is wired', () => {
    expect(ObjectId.isValid).toBeDefined();
  });
});
