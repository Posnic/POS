const { createNotificationWorker } = require('../../../src/services/business-notification-worker');

test('shard scheduling deduplicates aliases, skips suspended tenants and advances fairly after failures', async () => {
  const tenants = Array.from({ length: 13 }, (_, i) => ({
    tenantDb: String(i),
    db: { databaseName: String(i) },
  }));
  const calls = [];
  const worker = createNotificationWorker({
    tenants: () => [...tenants, tenants[0], { tenantDb: 'blocked', db: {}, suspended: true }],
    run: async (tenant, work) => {
      calls.push(tenant.tenantDb);
      return work();
    },
    drain: async (db) => {
      if (db.databaseName === '2') throw new Error('offline');
    },
    prepare: async () => {},
  });
  await worker.tick();
  expect(calls).toEqual(tenants.slice(0, 10).map((t) => t.tenantDb));
  await worker.tick();
  expect(calls.slice(10, 13)).toEqual(['10', '11', '12']);
  worker.stop();
  await worker.tick();
  expect(calls).toHaveLength(20);
});

test('a slow drain cannot overlap another tick and shutdown stops subsequent tenants', async () => {
  let release;
  const drain = jest.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const worker = createNotificationWorker({
    tenants: () => [{ db: { databaseName: 'one' } }, { db: { databaseName: 'two' } }],
    drain,
  });
  const pending = worker.tick();
  await worker.tick();
  expect(drain).toHaveBeenCalledTimes(1);
  worker.stop();
  release();
  await pending;
  expect(drain).toHaveBeenCalledTimes(1);
});

test('approval materialization precedes push and one channel failure cannot suppress the remaining stages', async () => {
  const calls = [];
  const worker = createNotificationWorker({
    tenants: () => [{ db: { databaseName: 'one' } }],
    approvals: async () => {
      calls.push('approvals');
    },
    drain: async () => {
      calls.push('daily');
      throw new Error('daily unavailable');
    },
    prepare: async () => {
      calls.push('prepare');
    },
    push: async () => {
      calls.push('push');
    },
  });
  await worker.tick();
  expect(calls).toEqual(['approvals', 'daily', 'prepare', 'push']);
});
