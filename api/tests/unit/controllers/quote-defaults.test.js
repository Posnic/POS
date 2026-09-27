'use strict';
const mockResolveGroup = jest.fn();
jest.mock(
  '../../../src/repositories/settings.repository',
  () =>
    class {
      resolveGroup(...args) {
        return mockResolveGroup(...args);
      }
    }
);
jest.mock('../../../src/repositories/quote.repository', () => class {});
const controller = require('../../../src/controllers/quotes.controller');
const req = {
  user: {
    branch_id: '64b000000000000000000001',
    license: '64b000000000000000000002',
    access: { sale: { read: true }, setting: { read: false } },
  },
};
const response = () => {
  const res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => jest.clearAllMocks());
test('cashier can read effective pricing defaults, without settings access or unrelated settings', async () => {
  mockResolveGroup.mockResolvedValue({
    status: true,
    data: {
      values: {
        quote_pricing_mode: 'markup',
        quote_show_markup: true,
        quote_default_bank_details: 'private bank details',
      },
    },
  });
  const res = response();
  await controller.defaults(req, res);
  expect(res.json.mock.calls[0][0].data).toEqual({ pricing_mode: 'markup', show_markup: true });
  expect(mockResolveGroup).toHaveBeenCalledWith(
    'documents',
    expect.objectContaining({ branchId: req.user.branch_id, licenseId: req.user.license })
  );
});
test('missing preferences keep discount mode and a failed lookup is not a silent mode change', async () => {
  mockResolveGroup
    .mockResolvedValueOnce({ status: true, data: { values: {} } })
    .mockResolvedValueOnce({ status: false });
  const res = response();
  await controller.defaults(req, res);
  expect(res.json.mock.calls[0][0].data).toEqual({ pricing_mode: 'discount', show_markup: false });
  await controller.defaults(req, res);
  expect(res.status).toHaveBeenCalledWith(503);
});
test('quote read permission is required', async () => {
  const res = response();
  await controller.defaults({ user: { access: { sale: { read: false } } } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockResolveGroup).not.toHaveBeenCalled();
});
