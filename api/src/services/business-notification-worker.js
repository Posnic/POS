'use strict';
const { drainDue, prepareUpcoming } = require('./business-notifications');
const { prepareRegisterCloses } = require('./business-register-notifications');
const { drainPush } = require('./business-push');
const { drainApprovalAlerts } = require('./business-approval-notifications');
const { createStockNotificationWorker } = require('./business-stock-notification-worker');

// A shared shard visits a bounded number of tenant databases per tick. Host aliases
// do not duplicate work, and the cursor advances even when one tenant is unavailable.
function createNotificationWorker({
  tenants,
  run = (_tenant, work) => work(),
  drain = drainDue,
  prepare = prepareUpcoming,
  prepareCloses = prepareRegisterCloses,
  push = drainPush,
  approvals = drainApprovalAlerts,
  stockFactory = createStockNotificationWorker,
}) {
  const stockWorkers = new Map();
  async function stock(db) {
    if (process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1' || stopped) return;
    if (!stockWorkers.has(db)) stockWorkers.set(db, stockFactory(db));
    await stockWorkers.get(db).tick();
  }
  let cursor = 0,
    running = false,
    stopped = false;
  return {
    stop() {
      stopped = true;
      for (const worker of stockWorkers.values()) worker.stop();
      stockWorkers.clear();
    },
    async tick() {
      if (running || stopped) return;
      running = true;
      try {
        const rows = [
          ...new Map(
            tenants()
              .filter((t) => t && !t.suspended && t.db)
              .map((t) => [t.tenantDb || t.db.databaseName, t])
          ).values(),
        ];
        const activeDatabases = new Set(rows.map((row) => row.db));
        for (const [db, worker] of stockWorkers) {
          if (!activeDatabases.has(db) || process.env.POSNIC_BUSINESS_STOCK_ALERTS !== '1') {
            worker.stop();
            stockWorkers.delete(db);
          }
        }
        const started = Date.now();
        for (let n = 0; n < Math.min(10, rows.length) && !stopped; n++) {
          const tenant = rows[cursor % rows.length];
          cursor = (cursor + 1) % rows.length;
          try {
            await run(tenant, async () => {
              for (const stage of [approvals, drain, prepare, prepareCloses, stock, push]) {
                if (stopped) break;
                try {
                  await stage(tenant.db, { limit: 5 });
                } catch {
                  /* One unavailable channel must not starve other notifications. */
                }
              }
            });
          } catch {
            /* Retry on a later visit; never log financial data or secrets. */
          }
          if (Date.now() - started >= 3000) break;
        }
      } finally {
        running = false;
      }
    },
  };
}
function startNotifications(options) {
  const worker = createNotificationWorker(options);
  const timer = setInterval(() => void worker.tick().catch(() => {}), 15000);
  timer.unref();
  void worker.tick().catch(() => {});
  return () => {
    clearInterval(timer);
    worker.stop();
  };
}
module.exports = { createNotificationWorker, startNotifications };
