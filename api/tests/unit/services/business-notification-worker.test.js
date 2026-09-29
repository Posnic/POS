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
    prepareCloses: async () => {
      calls.push('prepareCloses');
    },
    push: async () => {
      calls.push('push');
    },
  });
  await worker.tick();
  expect(calls).toEqual(['approvals', 'daily', 'prepare', 'prepareCloses', 'push']);
});

const stockFlag = process.env.POSNIC_BUSINESS_STOCK_ALERTS;
afterEach(() => {
  if (stockFlag === undefined) delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
  else process.env.POSNIC_BUSINESS_STOCK_ALERTS = stockFlag;
});
const idleStages = {
  approvals: async () => {},
  drain: async () => {},
  prepare: async () => {},
  prepareCloses: async () => {},
  push: async () => {},
};

test('stock runtime is opt-in, caches tenant workers and retires removed or disabled databases', async () => {
  delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
  const one = { tenantDb: 'one', db: { databaseName: 'one' } };
  const two = { tenantDb: 'two', db: { databaseName: 'two' } };
  let rows = [one, one, two];
  const workers = [];
  const stockFactory = jest.fn(() => {
    const worker = { tick: jest.fn(async () => {}), stop: jest.fn() };
    workers.push(worker);
    return worker;
  });
  const worker = createNotificationWorker({ ...idleStages, tenants: () => rows, stockFactory });
  await worker.tick();
  expect(stockFactory).not.toHaveBeenCalled();
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  await worker.tick();
  await worker.tick();
  expect(stockFactory).toHaveBeenCalledTimes(2);
  expect(workers.map((w) => w.tick.mock.calls.length)).toEqual([2, 2]);
  rows = [one, { ...two, suspended: true }];
  await worker.tick();
  expect(workers[1].stop).toHaveBeenCalledTimes(1);
  rows = [];
  await worker.tick();
  expect(workers[0].stop).toHaveBeenCalledTimes(1);
  rows = [one];
  await worker.tick();
  expect(stockFactory).toHaveBeenCalledTimes(3);
  delete process.env.POSNIC_BUSINESS_STOCK_ALERTS;
  await worker.tick();
  expect(workers[2].stop).toHaveBeenCalledTimes(1);
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  await worker.tick();
  expect(stockFactory).toHaveBeenCalledTimes(4);
  worker.stop();
  expect(workers[3].stop).toHaveBeenCalledTimes(1);
});

test('stock runs before push and an unavailable stock pipeline does not suppress push', async () => {
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  const calls = [];
  const worker = createNotificationWorker({
    ...idleStages,
    tenants: () => [{ db: { databaseName: 'one' } }],
    stockFactory: () => ({
      stop() {},
      async tick() {
        calls.push('stock');
        throw new Error('offline');
      },
    }),
    push: async () => {
      calls.push('push');
    },
  });
  await worker.tick();
  expect(calls).toEqual(['stock', 'push']);
  worker.stop();
});

test('shutdown aborts a pending stock worker and skips subsequent push', async () => {
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const stock = {
    stop: jest.fn(),
    tick: jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
          started();
        })
    ),
  };
  const push = jest.fn();
  const worker = createNotificationWorker({
    ...idleStages,
    tenants: () => [{ db: { databaseName: 'one' } }],
    stockFactory: () => stock,
    push,
  });
  const pending = worker.tick();
  await entered;
  worker.stop();
  expect(stock.stop).toHaveBeenCalledTimes(1);
  release();
  await pending;
  expect(push).not.toHaveBeenCalled();
});
