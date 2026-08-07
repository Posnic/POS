'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    optional: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });
  const validationResult = jest.fn();
  return { query: jest.fn(() => chain()), validationResult };
});

const { validationResult } = require('express-validator');
const dashboardValidation = require('../../../src/middleware/dashboard.validation');

describe('dashboard.validation', () => {
  test('exports filter validator', () => {
    expect(dashboardValidation.validateDashboardFilter).toHaveLength(1);
  });

  test('handleValidationErrors formats response', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'bad filter' }],
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    dashboardValidation.handleValidationErrors({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
