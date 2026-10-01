'use strict';
const mockFindOne = jest.fn();
jest.mock('../../../src/models/base.model', () => ({
  getDb: jest.fn(async () => ({ collection: () => ({ findOne: mockFindOne }) })),
}));
jest.mock('../../../src/services/ai-budget', () => ({ monthKey: () => '2026-10' }));
const service = require('../../../src/services/managed-ai-credits.service');

// Real balance arithmetic, races and recovery are tested against MongoDB by
// ask-posnic-database.integration.test.js; these pin early request validation.
test('no managed allowance can be opened without an authenticated shop', async () => {
  await expect(service.ensureAccount({})).rejects.toThrow('shop identity');
  await expect(service.reserve({}, {})).rejects.toThrow('shop identity');
});

test('a malformed hold identifier cannot become a MongoDB update path', async () => {
  await service.release({ licenseId: 'shop-a' }, { id: '$where.nested' });
  await service.reconcile(
    { licenseId: 'shop-a' },
    { id: '$where.nested' },
    { tokensIn: 1, tokensOut: 1 }
  );
  expect(mockFindOne).not.toHaveBeenCalled();
});
