'use strict';

jest.mock('../../../src/controllers/registers.controller', () => ({
  getDataChanges: jest.fn(),
  getcashField: jest.fn(),
  registerReportTable: jest.fn(),
  registeropendateFilter: jest.fn(),
  registerFindStatus: jest.fn(),
  registerAdd: jest.fn(),
  registerUpdate: jest.fn(),
  registerInDetail: jest.fn(),
  registerClose: jest.fn(),
  cashRegisterOpenManual: jest.fn(),
  getCashRegister: jest.fn(),
  registerCountedAmount: jest.fn(),
  registerPaymentNote: jest.fn(),
  registerSaleDetails: jest.fn(),
  getRegisterReportDetails: jest.fn(),
  getRegisterReportPdfDetails: jest.fn(),
  registerDenomsubmit: jest.fn(),
  editCashDenomination: jest.fn(),
  deleteCashDenomination: jest.fn(),
  deleteCashInOut: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/validateRequest', () => ({
  validateRequest: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../src/middleware/registers.validation', () => ({
  validateRegisterAdd: [],
  validateRegisterInDetail: [],
  validateRegisterClose: [],
  validateRegisterCountedAmount: [],
  validateRegisterPaymentNote: [],
  validateRegisterDenomsubmit: [],
  validateDeleteCashInOut: [],
  validateRegisterReportFilters: [],
  validateRegisterSaleDetails: [],
}));

const router = require('../../../src/routes/registers.routes');

describe('registers.routes', () => {
  test('exposes register routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /getDataChanges',
        'get /registerReportTable',
        'post /registerAdd',
        'post /registerInDetail',
        'post /registerClose',
        'post /deleteCashInOut',
      ])
    );
  });
});
