'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });
  const validationResult = jest.fn();
  return { body: jest.fn(() => chain()), validationResult };
});

const { validationResult } = require('express-validator');
const branchesValidation = require('../../../src/middleware/branches.validation');

describe('branches.validation', () => {
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  test('handleValidationErrors returns readable errors', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'Bad branch' }],
    });

    const next = jest.fn();
    branchesValidation.handleValidationErrors({}, res(), next);
    expect(next).not.toHaveBeenCalled();
  });

  test('exports branch validation chains', () => {
    expect(branchesValidation.validateBranch).toHaveLength(6);
    expect(branchesValidation.validateBranchUpdate).toHaveLength(4);
  });
});
