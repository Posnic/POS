'use strict';

jest.mock('../../../src/controllers/receivings.controller', () => ({
  create: jest.fn(),
  getAll: jest.fn(),
  receivingReportTable: jest.fn(),
  supplierReceivingReportTable: jest.fn(),
  returnReceivingReportTable: jest.fn(),
  receivingsGraphicalReports: jest.fn(),
  productBasedReceivingReturnDetails: jest.fn(),
  getSummary: jest.fn(),
  pendingReceivingReportTable: jest.fn(),
  pendingSupplierReportTable: jest.fn(),
  receivedReceiving: jest.fn(),
  returnReceiving: jest.fn(),
  getDataChanges: jest.fn(),
  receivingsPdf: jest.fn(),
  emailToSupplier: jest.fn(),
  exportReceivings: jest.fn(),
  supplierReceivingDetails: jest.fn(),
  uploadReceivingImage: jest.fn(),
  pendingReceivingProductDetails: jest.fn(),
  returnReceivingProductView: jest.fn(),
  returnPrintDetails: jest.fn(),
  gstTwoReportTable: jest.fn(),
  gstNineReportTable: jest.fn(),
  companyPriceUpdate: jest.fn(),
  returnReceivingProductDetails: jest.fn(),
  delete: jest.fn(),
  getById: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));

const router = require('../../../src/routes/receivings.routes');

describe('receivings.routes', () => {
  test('exposes key receiving routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'post /',
        'get /',
        'get /summary',
        'post /returnReceiving',
        'put /returnReceiving',
        'get /:id',
        'patch /:id/status',
      ])
    );
  });
});
