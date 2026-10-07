'use strict';

const mockResolve = jest.fn();
jest.mock(
  '../../../src/repositories/settings.repository',
  () =>
    class {
      resolveGroup(...args) {
        return mockResolve(...args);
      }
    }
);
jest.mock('../../../src/services/ask-posnic-platform.service', () => ({
  scope: () => ({ license: 'shop', branch_id: 'outlet', user_id: 'owner' }),
}));
const feature = require('../../../src/services/ask-posnic-feature');
const context = { licenseId: 'shop', branchId: 'outlet' };

test.each([undefined, false, 'false', 1, 'yes', null])(
  'Ask Posnic stays off for %p',
  async (value) => {
    mockResolve.mockResolvedValue({
      status: true,
      data: { values: { ask_posnic_enabled: value, ai_enabled: true } },
    });
    expect(await feature.enabled(context)).toBe(false);
    expect(mockResolve).toHaveBeenLastCalledWith('features', context);
  }
);

test.each([true, 'true'])(
  'explicit opt-in %p enables Ask Posnic independently of other AI',
  async (value) => {
    mockResolve.mockResolvedValue({
      status: true,
      data: { values: { ask_posnic_enabled: value, ai_enabled: false } },
    });
    expect(await feature.enabled(context)).toBe(true);
  }
);

test('off blocks requests before their handler can run and allows them after enabling', async () => {
  const next = jest.fn();
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  mockResolve.mockResolvedValue({ status: true, data: { values: {} } });
  await feature.requireEnabled({}, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ASK_POSNIC_DISABLED' }));
  mockResolve.mockResolvedValue({ status: true, data: { values: { ask_posnic_enabled: true } } });
  await feature.requireEnabled({}, res, next);
  expect(next).toHaveBeenCalledTimes(1);
});

test('settings failure never opens the feature', async () => {
  mockResolve.mockResolvedValue({ status: false });
  expect(await feature.enabled(context)).toBe(false);
  const next = jest.fn();
  const error = new Error('settings unavailable');
  mockResolve.mockRejectedValue(error);
  await feature.requireEnabled({}, {}, next);
  expect(next).toHaveBeenCalledWith(error);
});

test('scheduled reports are stopped before reading or sending shop data when off', async () => {
  mockResolve.mockResolvedValue({ status: true, data: { values: {} } });
  const db = { collection: jest.fn() };
  await expect(
    require('../../../src/services/ask-posnic-runner.service').authorize(db, {
      license: 'shop',
      branch_id: 'outlet',
      user_id: 'owner',
    })
  ).rejects.toThrow('Ask Posnic is disabled');
  expect(db.collection).not.toHaveBeenCalled();
});
