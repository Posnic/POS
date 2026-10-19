'use strict';
const access = require('../../../src/utils/branch-access');
const router = require('../../../src/routes/captain-access.routes');
const handler = (method) =>
  router.stack
    .find((l) => l.route?.path === '/table-settings' && l.route.methods[method])
    .route.stack.at(-1).handle;
let updateOne, updateMany, branch;
beforeEach(() => {
  updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  updateMany = jest.fn();
  branch = {};
  jest
    .spyOn(access, 'context')
    .mockImplementation(async () => ({ branch, branchId: 'branch', license: 'license' }));
});
afterEach(() => jest.restoreAllMocks());
async function call(method, body = {}, role = 'manager') {
  const res = { set: jest.fn(), json: jest.fn(), status: jest.fn().mockReturnThis() };
  await handler(method)(
    { body, user: { role }, db: { collection: () => ({ updateOne, updateMany }) } },
    res
  );
  return res;
}
test('requirements default to existing table rule and optional guests', async () => {
  expect((await call('get')).json.mock.calls[0][0]).toMatchObject({
    tableRequired: true,
    guestsRequired: false,
  });
  branch = { captain_allow_unassigned: true, restaurant_require_guests: true };
  expect((await call('get')).json.mock.calls[0][0]).toMatchObject({
    tableRequired: false,
    guestsRequired: true,
  });
});
test('saving requirements is branch scoped and preserves cleaning state', async () => {
  await call('post', { tableRequired: true, guestsRequired: true });
  expect(updateOne).toHaveBeenCalledWith(
    { _id: 'branch', license: 'license' },
    {
      $set: {
        captain_allow_unassigned: false,
        restaurant_require_guests: true,
        updated_date: expect.any(Date),
      },
    }
  );
  expect(updateMany).not.toHaveBeenCalled();
});
test('saving cleaning alone preserves requirements', async () => {
  await call('post', { cleaningEnabled: true });
  expect(updateOne.mock.calls[0][1].$set).toEqual({
    captain_table_cleaning: true,
    updated_date: expect.any(Date),
  });
});
test('invalid preference and unauthorized staff cannot write', async () => {
  expect((await call('post', { guestsRequired: 'true' })).status).toHaveBeenCalledWith(422);
  expect((await call('post', { guestsRequired: true }, 'staff')).status).toHaveBeenCalledWith(403);
  expect(updateOne).not.toHaveBeenCalled();
});
