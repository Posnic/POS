'use strict';

jest.mock('../../../src/controllers/branches.controller', () => {
  const make = jest.fn();
  return {
    getAll: make,
    getOptions: make,
    getOneStore: make,
    userRegisterBranchSelect: make,
    getBranchList: make,
    getBranchDetails: make,
    getDataChanges: make,
    exportBranches: make,
    getBranchRegisterList: make,
    getStats: make,
    search: make,
    toggleStatus: make,
    getOne: make,
    add: make,
    edit: make,
    delete: make,
    resetPaymentGateway: make,
    resetPhonepePaymentGateway: make,
    resetEmailSetting: make,
  };
});

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

jest.mock('../../../src/middleware/branches.validation', () => ({
  validateBranch: [],
  validateBranchUpdate: [],
  handleValidationErrors: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/branches.routes');

describe('branches.routes', () => {
  test('exposes branch routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /',
        'get /options',
        'get /getBranchList',
        'get /getBranchDetails',
        'post /exportBranches',
        'patch /:id/toggle-status',
        'post /',
        'put /:id',
        'delete /delete',
        'delete /:id',
      ])
    );
  });
});
