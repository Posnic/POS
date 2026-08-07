'use strict';

jest.mock('../../../src/constants/settings.constants', () => ({
  VALIDATION_RULES: {
    STORE_NAME: { MIN: 2, MAX: 20 },
    STORE_EMAIL: { MAX: 50 },
    STORE_TELEPHONE: { MIN: 2, MAX: 20 },
    STORE_ADDRESS: { MIN: 2, MAX: 50 },
    PRINTING_ADDRESS: { MIN: 2, MAX: 50 },
    WEBSITE: { MIN: 0, MAX: 50 },
    CITY: { MAX: 50 },
    PINCODE: { MAX: 10 },
    TAX_NAME: { MIN: 1, MAX: 20 },
    TAX_VALUE: { MIN: 1, MAX: 20 },
    UNIT_NAME: { MIN: 1, MAX: 20 },
    UNIT_VALUE: { MIN: 1, MAX: 20 },
    DENOM_VALUE: { MIN: 1, MAX: 20 },
    PAYMENT_VALUE: { MIN: 1, MAX: 20 },
    DEFAULT_CUSTOMER: { MIN: 1, MAX: 20 },
    DEFAULT_SUPPLIER: { MIN: 1, MAX: 20 },
    PASSWORD: { MIN: 6, MAX: 20 },
    WAY2SMS_API: { MAX: 20 },
    WAY2SMS_USERID: { MAX: 20 },
    TEXTLOCAL_API: { MAX: 20 },
    TEXTLOCAL_SENDER: { MAX: 20 },
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
  });
  return {
    body: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
  };
});

const settings = require('../../../src/middleware/settings.validation');

describe('settings.validation', () => {
  test('exports validation groups', () => {
    expect(settings.validateGeneralSetting.length).toBeGreaterThan(0);
    expect(settings.validateChangePassword.length).toBeGreaterThan(0);
    expect(settings.validateTextLocalSmsSetting.length).toBeGreaterThan(0);
  });
});
