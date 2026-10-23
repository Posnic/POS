'use strict';
const { ObjectId } = require('mongodb');
const controller = require('../../../src/controllers/items.controller');
test.each(['Hong Kong', 'United Kingdom', 'India'])(
  'GST readiness is scoped and country-gated for %s',
  async (country) => {
    const branchId = new ObjectId(),
      licenseId = new ObjectId();
    const findOne = jest.fn(async () => ({ country }));
    const req = {
      user: { access: { report: { read: true } } },
      itemContext: { branchId, licenseId },
      db: {
        collection: (name) => {
          expect(name).toBe('branches');
          return { findOne };
        },
      },
    };
    const scope = {
      setRequestContext: jest.fn(),
      service: { listForGstReadiness: jest.fn(async () => []) },
      error: jest.fn(),
      success: jest.fn(),
    };
    const res = {};
    await controller.gstReadiness.call(scope, req, res);
    expect(findOne).toHaveBeenCalledWith({ _id: branchId, license: licenseId });
    if (country === 'India') {
      expect(scope.service.listForGstReadiness).toHaveBeenCalledTimes(1);
      expect(scope.success).toHaveBeenCalled();
    } else {
      expect(scope.service.listForGstReadiness).not.toHaveBeenCalled();
      expect(scope.error).toHaveBeenCalledWith(
        res,
        'GST readiness is available only for Indian branches.',
        403
      );
    }
  }
);
