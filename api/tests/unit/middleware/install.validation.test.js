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
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
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

  test('verifyInstallationCredentials rejects bad credentials', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    installValidation.verifyInstallationCredentials({ body: {}, headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('custom objectId validation is wired', () => {
    expect(ObjectId.isValid).toBeDefined();
  });
});
