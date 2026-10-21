const { start, applyQueued } = require('../../../src/services/extension-shard-runtime');

test('shard loads verified runtime without using a tenant or control database for activation', async () => {
  const release = jest.fn();
  const initialize = jest
    .fn()
    .mockResolvedValue({ loaded: ['example.connector'], failures: [], release });
  expect(await start({ initialize })).toBe(release);
  expect(initialize).toHaveBeenCalledWith({});
});

test('activation selects the unique authorized shop and deduplicates hostname aliases', async () => {
  const request = {
    license: '111111111111111111111111',
    branchId: '222222222222222222222222',
    id: 'example.connector',
  };
  const a = { tenantDb: 'a', db: { collection: () => ({ findOne: async () => null }) } };
  const b = {
    tenantDb: 'b',
    db: { collection: () => ({ findOne: async () => ({ _id: request.branchId }) }) },
  };
  const queue = { read: () => request, apply: jest.fn() };
  await applyQueued({ tenants: [a, b, b], queue, options: { root: '/packages' } });
  expect(queue.apply).toHaveBeenCalledWith({ root: '/packages', db: b.db });
  queue.apply.mockClear();
  await expect(
    applyQueued({ tenants: [a, { ...b, suspended: true }], queue, options: { root: '/packages' } })
  ).rejects.toThrow('extension_install_tenant_ambiguous');
  expect(queue.apply).not.toHaveBeenCalled();
});

test('another shop depending on a global package prevents a single-shop upgrade', async () => {
  const request = {
    license: '111111111111111111111111',
    branchId: '222222222222222222222222',
    id: 'example.connector',
  };
  const a = {
    tenantDb: 'a',
    db: {
      collection: (name) => ({
        findOne: async () => (name === 'extension_installations' ? {} : null),
      }),
    },
  };
  const b = { tenantDb: 'b', db: { collection: () => ({ findOne: async () => ({}) }) } };
  const queue = { read: () => request, apply: jest.fn() };
  await expect(
    applyQueued({ tenants: [a, b], queue, options: { root: '/packages' } })
  ).rejects.toThrow('extension_install_multi_tenant_upgrade_required');
  expect(queue.apply).not.toHaveBeenCalled();
});

test('invalid package configuration does not stop other shops starting', async () => {
  const log = jest.fn();
  expect(
    await start({
      initialize: async () => {
        throw new Error('extension_trust_key_missing');
      },
      log,
    })
  ).toBeUndefined();
  expect(log).toHaveBeenCalledWith(
    '[EXTENSIONS] Could not read installed packages:',
    'extension_trust_key_missing'
  );
});

test('a refused queued upgrade still loads previously installed verified packages', async () => {
  const release = jest.fn();
  const initialize = jest.fn().mockResolvedValue({ failures: [], release });
  const log = jest.fn();
  const queue = { read: () => ({ license: 'invalid' }), apply: jest.fn() };
  expect(await start({ initialize, queue, options: { root: '/packages' }, log })).toBe(release);
  expect(queue.apply).not.toHaveBeenCalled();
  expect(initialize).toHaveBeenCalledWith({});
  expect(log).toHaveBeenCalledWith(
    '[EXTENSIONS] Queued installation not applied:',
    'extension_install_scope_invalid'
  );
});
