'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { prepareDesktopStockObservation } = require('../src/services/business-stock-summary');
const {
  journalStockObservation,
  MAX_PENDING_EVENTS,
} = require('../src/services/business-stock-alert-journal');
let mongo, client, db;
const now = () => Date.parse('2026-09-29T10:00:00.000Z');
before(async () => {
  process.env.POSNIC_DESKTOP = '1';
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_alerts');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(count = 1) {
  const branch = { id: String(new ObjectId()), license: String(new ObjectId()) };
  await db.collection('branches').insertOne({
    _id: new ObjectId(branch.id),
    license: new ObjectId(branch.license),
    notification_range: 2,
  });
  const rows = Array.from({ length: count }, () => ({
    _id: new ObjectId(),
    license: new ObjectId(branch.license),
    branch_id: new ObjectId(branch.id),
    name: 'Rice',
    unit: 'kg',
    item_status: 'regular',
    track_inventory: true,
    available_quantity: 1,
  }));
  await db.collection('items').insertMany(rows);
  let tick = now() - 60000;
  const scan = () => prepareDesktopStockObservation(db, branch, { now: () => (tick += 1000) });
  const states = () =>
    db
      .collection('business_stock_alert_local')
      .find({ license: branch.license })
      .sort({ itemId: 1 })
      .toArray();
  const journal = (observation, options) =>
    journalStockObservation(db, observation, branch, { now, ...options });
  return { branch, rows, scan, states, journal };
}
test('desktop observation retains healthy facts and every low item beyond the public list cap', async () => {
  const f = await fixture(102);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[101]._id }, { $set: { available_quantity: 5 } });
  // Real elapsed clock: the deterministic per-call clock is intentionally too
  // expensive for a 102-row scan and is used only in the small fixtures below.
  const observation = await prepareDesktopStockObservation(db, f.branch);
  assert.equal(observation.summary.lowItems.length, 100);
  assert.equal(observation.summary.lowItemCount, 101);
  assert.equal(observation.facts.length, 102);
  assert.equal(observation.facts[101].low, false);
  const first = await journalStockObservation(db, observation, f.branch, { limit: 60 });
  assert.equal(first.processed, 60);
  assert.ok(first.nextAfter);
  const second = await journalStockObservation(db, observation, f.branch, {
    afterItemId: first.nextAfter,
  });
  assert.equal(second.processed, 42);
  assert.equal(second.nextAfter, null);
  const states = await f.states();
  assert.equal(states.length, 102);
  assert.equal(
    states.reduce((n, row) => n + row.pendingEvents.length, 0),
    101
  );
});
test('unknown and excluded observations never re-arm a low item; explicit healthy state does', async () => {
  const f = await fixture();
  await f.journal(await f.scan());
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $unset: { available_quantity: '' } });
  const unknown = await f.scan();
  assert.equal(unknown.summary.coverage.unavailableItems, 1);
  await f.journal(unknown);
  assert.equal((await f.states())[0].low, true);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 1, track_inventory: false } });
  await f.journal(await f.scan());
  assert.equal((await f.states())[0].low, true);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { track_inventory: true } });
  await f.journal(await f.scan());
  assert.equal((await f.states())[0].pendingEvents.length, 1);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 3 } });
  await f.journal(await f.scan());
  assert.equal((await f.states())[0].low, false);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: -0.125 } });
  await f.journal(await f.scan());
  const state = (await f.states())[0];
  assert.equal(state.episode, 2);
  assert.equal(state.pendingEvents.length, 2);
  assert.equal(state.pendingEvents[1].fact.availableMilli, -125);
  assert.notEqual(state.pendingEvents[0].eventId, state.pendingEvents[1].eventId);
});
test('concurrent replay and restart after a committed write cannot duplicate or lose a low episode', async () => {
  const f = await fixture(2),
    observation = await f.scan();
  let writes = 0;
  const interruptedDb = {
    collection(name) {
      const collection = db.collection(name);
      return {
        findOne: (...args) => collection.findOne(...args),
        async updateOne(...args) {
          const result = await collection.updateOne(...args);
          if (++writes === 1) throw new Error('process_stopped_after_commit');
          return result;
        },
      };
    },
  };
  await assert.rejects(
    journalStockObservation(interruptedDb, observation, f.branch, { now }),
    /process_stopped_after_commit/
  );
  await Promise.all([f.journal(observation), f.journal(observation), f.journal(observation)]);
  const states = await f.states();
  assert.equal(states.length, 2);
  assert.ok(states.every((row) => row.pendingEvents.length === 1 && row.episode === 1));
});
test('whole observation is checked before writes and low-list omission cannot masquerade as recovery', async () => {
  const f = await fixture(2),
    observation = await f.scan();
  let corrupt = structuredClone(observation);
  corrupt.facts[1].low = false;
  await assert.rejects(f.journal(corrupt), /invalid_stock_summary/);
  assert.equal((await f.states()).length, 0);
  corrupt = structuredClone(observation);
  corrupt.facts = observation.facts.slice(0, 1);
  await assert.rejects(f.journal(corrupt), /invalid_stock_observation/);
  assert.equal((await f.states()).length, 0);
  corrupt.facts = [observation.facts[0], observation.facts[0]];
  await assert.rejects(f.journal(corrupt), /invalid_stock_observation/);
});
test('stale observations do not undo healthy state and conflicting or overlapping observations fail', async () => {
  const f = await fixture(),
    first = await f.scan();
  await f.journal(first);
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 3 } });
  const healthy = await f.scan();
  await f.journal(healthy);
  await f.journal(first);
  assert.equal((await f.states())[0].low, false);
  const conflict = structuredClone(healthy);
  conflict.facts[0].availableMilli = 4000;
  await assert.rejects(f.journal(conflict), /conflicting_stock_observation/);
  const overlap = structuredClone(healthy);
  overlap.summary.preparedAt = new Date(
    Date.parse(healthy.summary.preparedAt) + 1000
  ).toISOString();
  await assert.rejects(f.journal(overlap), /overlapping_stock_observation/);
  assert.equal((await f.states())[0].pendingEvents.length, 1);
});
test('a full local outbox applies backpressure without advancing state or dropping older alerts', async () => {
  const f = await fixture();
  await f.journal(await f.scan());
  const [row] = await f.states();
  await db
    .collection('business_stock_alert_local')
    .updateOne(
      { _id: row._id },
      { $set: { low: false, pendingEvents: Array(MAX_PENDING_EVENTS).fill(row.pendingEvents[0]) } }
    );
  await assert.rejects(f.journal(await f.scan()), /stock_alert_backpressure/);
  const [after] = await f.states();
  assert.equal(after.low, false);
  assert.equal(after.episode, 1);
  assert.equal(after.pendingEvents.length, MAX_PENDING_EVENTS);
});
test('cancellation and desktop boundary prevent state changes', async () => {
  const f = await fixture(),
    observation = await f.scan();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.journal(observation, { signal: controller.signal }), /cancelled/);
  process.env.POSNIC_DESKTOP = '0';
  try {
    await assert.rejects(f.journal(observation), /desktop_required/);
  } finally {
    process.env.POSNIC_DESKTOP = '1';
  }
  assert.equal((await f.states()).length, 0);
});

test('elapsed budget returns a resumable position without starting another write', async () => {
  const f = await fixture(2),
    observation = await f.scan();
  let at = now();
  const delayedDb = {
    collection(name) {
      const collection = db.collection(name);
      return {
        async findOne(...args) {
          const row = await collection.findOne(...args);
          at += 3001;
          return row;
        },
        updateOne: (...args) => collection.updateOne(...args),
      };
    },
  };
  const progress = await journalStockObservation(delayedDb, observation, f.branch, {
    now: () => at,
  });
  assert.equal(progress.complete, false);
  assert.equal(progress.processed, 0);
  assert.equal(progress.nextAfter, null);
  assert.equal((await f.states()).length, 0);
  assert.equal((await f.journal(observation)).complete, true);
});
test('expired or foreign-scope observations cannot create journal entries', async () => {
  const f = await fixture(),
    observation = await f.scan();
  await assert.rejects(
    f.journal(observation, { now: () => now() + 86400001 }),
    /stale_stock_observation/
  );
  await assert.rejects(
    journalStockObservation(
      db,
      observation,
      { ...f.branch, license: String(new ObjectId()) },
      { now }
    ),
    /invalid_stock_summary/
  );
  assert.equal((await f.states()).length, 0);
});

test('an invalid legacy duplicate cannot leave a healthy fact available to re-arm alerts', async () => {
  const f = await fixture();
  await db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 5 } });
  await db
    .collection('items')
    .insertOne({ ...f.rows[0], _id: String(f.rows[0]._id), available_quantity: 'unknown' });
  await assert.rejects(f.scan(), /duplicate_stock_item/);
  assert.equal((await f.states()).length, 0);
});

const { createStockAlertWorker } = require('../src/services/business-stock-alert-worker');
const observationRow = (branch) =>
  db
    .collection('business_stock_alert_local')
    .findOne({ _id: 'observation:' + branch.license + ':' + branch.id });
test('worker persists an immutable observation, resumes page cursors after restart and releases completed facts', async () => {
  const f = await fixture(102);
  const observation = await prepareDesktopStockObservation(db, f.branch);
  const worker = createStockAlertWorker(db);
  const staged = await worker.stage(observation, f.branch);
  assert.equal(staged.duplicate, false);
  const reordered = {
    facts: observation.facts.map((fact) => Object.fromEntries(Object.entries(fact).reverse())),
    summary: observation.summary,
  };
  assert.equal((await worker.stage(reordered, f.branch)).duplicate, true);
  const other = structuredClone(observation);
  other.summary.preparedAt = new Date(Date.parse(observation.summary.preparedAt) + 1).toISOString();
  await assert.rejects(
    createStockAlertWorker(db, { now: () => Date.now() + 1000 }).stage(other, f.branch),
    /stock_observation_pending/
  );
  const first = await worker.tick();
  assert.equal(first.processed, 100);
  assert.equal(first.complete, false);
  assert.equal((await observationRow(f.branch)).afterItemId, observation.facts[99].itemId);
  worker.stop();
  const restarted = createStockAlertWorker(db);
  assert.equal((await restarted.tick()).complete, true);
  const row = await observationRow(f.branch);
  assert.equal(row.observation, undefined);
  assert.ok(row.completedAt instanceof Date);
  assert.equal((await restarted.stage(observation, f.branch)).duplicate, true);
  const items = (await f.states()).filter((state) => state.itemId);
  assert.equal(items.length, 102);
  assert.ok(items.every((state) => state.pendingEvents.length === 1));
});
test('worker replays journal writes after a crash before saving its cursor', async () => {
  const f = await fixture(2),
    observation = await f.scan();
  let at = now();
  const worker = createStockAlertWorker(db, {
    now: () => at,
    journal: async (...args) => {
      await journalStockObservation(...args);
      throw new Error('crash_before_cursor');
    },
  });
  await worker.stage(observation, f.branch);
  await assert.rejects(worker.tick(), /crash_before_cursor/);
  const interrupted = await observationRow(f.branch);
  assert.equal(interrupted.afterItemId, null);
  assert.ok(interrupted.observation);
  at += 300001;
  await createStockAlertWorker(db, { now: () => at }).tick();
  assert.equal((await observationRow(f.branch)).observation, undefined);
  assert.ok(
    (await f.states())
      .filter((state) => state.itemId)
      .every((state) => state.pendingEvents.length === 1)
  );
});
test('a worker that loses its lease cannot overwrite a successor cursor or completion', async () => {
  const f = await fixture(),
    observation = await f.scan();
  let at = now(),
    entered,
    resume;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  const worker = createStockAlertWorker(db, {
    now: () => at,
    journal: async (...args) => {
      entered();
      await paused;
      return journalStockObservation(...args);
    },
  });
  await worker.stage(observation, f.branch);
  const pending = worker.tick();
  await started;
  at += 30001;
  await createStockAlertWorker(db, { now: () => at }).tick();
  const completed = await observationRow(f.branch);
  resume();
  await pending;
  assert.deepEqual(await observationRow(f.branch), completed);
  assert.equal((await f.states()).find((state) => state.itemId).pendingEvents.length, 1);
});
test('expired staged observations are explicitly discarded without erasing pending events', async () => {
  const f = await fixture(),
    observation = await f.scan();
  let at = now();
  const worker = createStockAlertWorker(db, { now: () => at });
  await f.journal(observation);
  await worker.stage(observation, f.branch);
  at += 86400001;
  await worker.tick();
  const row = await observationRow(f.branch);
  assert.equal(row.observation, undefined);
  assert.equal(row.lastDiscarded.reason, 'stale_stock_observation');
  assert.equal((await f.states()).find((state) => state.itemId).pendingEvents.length, 1);
});
test('tampered staged facts cannot be journalled and Cloud cannot stage an observation', async () => {
  const f = await fixture(),
    observation = await f.scan();
  const worker = createStockAlertWorker(db, { now });
  await worker.stage(observation, f.branch);
  const row = await observationRow(f.branch);
  await db.collection('business_stock_alert_local').updateOne(
    { _id: row._id },
    {
      $set: {
        'observation.facts.0.availableMilli': 0,
        'observation.summary.lowItems.0.availableMilli': 0,
      },
    }
  );
  await assert.rejects(worker.tick(), /invalid_stock_observation_state/);
  assert.equal((await f.states()).filter((state) => state.itemId).length, 0);
  process.env.POSNIC_DESKTOP = '0';
  try {
    await assert.rejects(worker.stage(observation, f.branch), /desktop_required/);
  } finally {
    process.env.POSNIC_DESKTOP = '1';
  }
});

test('a corrupt queue record backs off so another branch can continue', async () => {
  const f = await fixture(),
    g = await fixture();
  const worker = createStockAlertWorker(db, { now });
  await worker.stage(await f.scan(), f.branch);
  await worker.stage(await g.scan(), g.branch);
  const row = await observationRow(f.branch);
  await db
    .collection('business_stock_alert_local')
    .updateOne(
      { _id: row._id },
      { $set: { revision: 'invalid', nextAttemptAt: new Date(now() - 1) } }
    );
  await assert.rejects(worker.tick(), /invalid_stock_observation_state/);
  const corrupt = await observationRow(f.branch);
  assert.equal(corrupt.leaseId, undefined);
  assert.equal(corrupt.nextAttemptAt.getTime(), now() + 300000);
  assert.equal((await worker.tick()).complete, true);
  assert.equal((await observationRow(g.branch)).observation, undefined);
});
test('a stopped worker preserves its observation for replay and does not advance a cursor', async () => {
  const f = await fixture(),
    observation = await f.scan();
  let at = now(),
    entered,
    resume;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  const worker = createStockAlertWorker(db, {
    now: () => at,
    journal: async (...args) => {
      const result = await journalStockObservation(...args);
      entered();
      await paused;
      return result;
    },
  });
  await worker.stage(observation, f.branch);
  const pending = worker.tick();
  await started;
  worker.stop();
  resume();
  await pending;
  assert.ok((await observationRow(f.branch)).observation);
  await assert.rejects(worker.stage(observation, f.branch), /worker_stopped/);
  at += 30001;
  await createStockAlertWorker(db, { now: () => at }).tick();
  assert.equal((await observationRow(f.branch)).observation, undefined);
  assert.equal((await f.states()).find((state) => state.itemId).pendingEvents.length, 1);
});
