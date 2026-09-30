'use strict';
const access = require('../../../src/utils/branch-access');
const router = require('../../../src/routes/captain-access.routes');
const route = router.stack.find(layer => layer.route?.path === '/payment-settings' && layer.route.methods.post).route;
const handler = route.stack.at(-1).handle;
const value = { enabled: true, methods: ['Cash', 'Upi'], printReceipt: true };
let updateOne;
beforeEach(() => {
  updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  jest.spyOn(access, 'context').mockResolvedValue({ branchId: 'authorized-branch', license: 'authorized-license' });
});
afterEach(() => jest.restoreAllMocks());
async function save(body = value) {
  const req = { user: { role: 'manager' }, body, db: { collection: name => {
    expect(name).toBe('branches'); return { updateOne };
  } } };
  const res = { set: jest.fn(), json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res);
  return res;
}
test('a disappeared branch never receives a successful save acknowledgement', async () => {
  updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
  const res = await save();
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: { code: 'SERVER_ERROR', message: 'Settings changed. Refresh and try again.' } });
});
test('an already identical save succeeds and writes only authorized branch settings', async () => {
  updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
  const res = await save({ ...value, branchId: 'other', license: 'other', branch_upi_id: 'other@bank' });
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ saved: true, ...value });
  expect(updateOne).toHaveBeenCalledWith({ _id: 'authorized-branch', license: 'authorized-license' }, {
    $set: { captain_payments: value, updated_date: expect.any(Date) },
  });
});
test('a failed database write never returns saved', async () => {
  updateOne.mockRejectedValue(new Error('database unavailable'));
  const res = await save();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: { code: 'SERVER_ERROR', message: 'Please retry.' } });
});
