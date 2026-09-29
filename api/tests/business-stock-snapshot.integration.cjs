'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { prepareDesktopStockObservation } = require('../src/services/business-stock-summary');
const {
  createSnapshotPages,
  assembleSnapshot,
  digestOf,
  FRESHNESS_MS,
} = require('../src/services/business-stock-snapshot-contract');
const {
  receiveCommunityStockSnapshot: receive,
  readCommunityStockSnapshotFact: read,
} = require('../src/services/business-stock-snapshot-community');
let mongo, client;
before(async () => {
  process.env.POSNIC_DESKTOP = '1';
  process.env.POSNIC_BUSINESS_LOCAL_REPORTING = '1';
  process.env.POSNIC_BUSINESS_STOCK_ALERTS = '1';
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : {},
  });
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(count = 103) {
  const db = client.db('snapshot_' + new ObjectId());
  let at = Date.now();
  const now = () => at;
  const branch = { id: String(new ObjectId()), license: String(new ObjectId()) };
  await db.collection('branches').insertOne({
    _id: new ObjectId(branch.id),
    license: new ObjectId(branch.license),
    notification_range: 3,
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
  if (count) await db.collection('items').insertMany(rows);
  const owner = {
    _id: branch.id,
    license: new ObjectId(branch.license),
    deviceId: 'local-installation',
    assignmentId: 'a'.repeat(43),
    epoch: 1,
  };
  await db.collection('business_reporting_publishers').insertOne(owner);
  const device = { deviceId: owner.deviceId, branches: [branch.id] };
  const scan = () => prepareDesktopStockObservation(db, branch, { now });
  const pages = async () => createSnapshotPages(await scan(), branch, { now });
  const send = (page, database = db) =>
    receive(
      database,
      device,
      { assignmentId: owner.assignmentId, epoch: owner.epoch, page },
      { now }
    );
  const get = (id, database = db) => read(database, branch, String(id), { now });
  return {
    db,
    branch,
    rows,
    owner,
    device,
    scan,
    pages,
    send,
    get,
    now,
    advance: (ms = 1000) => {
      at += ms;
    },
  };
}
test('real desktop snapshots include low items beyond 100, healthy facts and explicit unknowns', async () => {
  const f = await fixture();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[101]._id }, { $set: { available_quantity: 9 } });
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[102]._id }, { $unset: { available_quantity: '' } });
  const pages = await f.pages();
  assert.equal(pages.length, 2);
  assert.equal(pages[0].summary.lowItems.length, 100);
  assert.equal((await f.send(pages[1])).complete, false);
  assert.deepEqual(await f.get(f.rows[100]._id), { status: 'unavailable' });
  assert.equal((await f.send(pages[0])).complete, true);
  assert.equal((await f.get(f.rows[100]._id)).status, 'low');
  assert.equal((await f.get(f.rows[101]._id)).status, 'healthy');
  assert.equal((await f.get(f.rows[102]._id)).status, 'unknown');
  assert.equal((await f.get(f.rows[100]._id)).sourceComplete, false);
});
test('partial newer snapshots suppress older facts; explicit healthy and missing state replace low facts', async () => {
  const f = await fixture();
  for (const page of await f.pages()) await f.send(page);
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 10 } });
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[1]._id }, { $unset: { available_quantity: '' } });
  const next = await f.pages();
  await f.send(next[0]);
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
  await f.send(next[1]);
  assert.equal((await f.get(f.rows[0]._id)).status, 'healthy');
  assert.equal((await f.get(f.rows[1]._id)).status, 'unknown');
  f.advance(FRESHNESS_MS);
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
});
test('restart and lost database acknowledgement preserve an immutable transfer', async () => {
  const f = await fixture();
  const pages = await f.pages();
  let lost = false;
  const db = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_snapshot_pages' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (!lost) {
                lost = true;
                throw new Error('lost acknowledgement');
              }
              return result;
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  await assert.rejects(f.send(pages[0], db), /lost acknowledgement/);
  assert.equal((await f.send(pages[0])).complete, false);
  assert.equal((await f.send(pages[1])).complete, true);
  assert.equal((await f.send(pages[0])).complete, true);
  assert.equal(await f.db.collection('business_stock_snapshot_pages').countDocuments({}), 2);
  const changed = structuredClone(pages[1]);
  changed.facts[0].name = 'Changed';
  await assert.rejects(f.send(changed), /stock_snapshot_conflict/);
});
test('whole-observation digest and ordering reject mixed, missing, duplicated or tampered pages', async () => {
  const f = await fixture();
  const pages = await f.pages();
  assert.throws(() => assembleSnapshot([pages[0]], f.branch, { now: f.now }));
  assert.throws(() => assembleSnapshot([pages[0], pages[0]], f.branch, { now: f.now }));
  const changed = structuredClone(pages);
  changed[1].facts[0].name = 'Changed';
  assert.throws(() => assembleSnapshot(changed, f.branch, { now: f.now }));
  await f.send(changed[1]);
  await assert.rejects(f.send(changed[0]), /invalid_stock_snapshot/);
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
});
test('publisher handover cannot publish or read the former generation', async () => {
  const f = await fixture();
  const pages = await f.pages();
  await f.send(pages[0]);
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $set: { assignmentId: 'b'.repeat(43), epoch: 2 } });
  await assert.rejects(f.send(pages[1]), /publisher_not_assigned/);
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
  f.owner.assignmentId = 'b'.repeat(43);
  f.owner.epoch = 2;
  f.advance();
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await f.get(f.rows[0]._id)).status, 'low');
});
test('lookup rechecks publisher identity after reading facts and rejects corrupt retained pages', async () => {
  const f = await fixture();
  for (const page of await f.pages()) await f.send(page);
  const db = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_snapshot_pages' && property === 'findOne')
            return async (...args) => {
              const result = await target.findOne(...args);
              await f.db
                .collection('business_reporting_publishers')
                .updateOne({ _id: f.branch.id }, { $inc: { epoch: 1 } });
              return result;
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  assert.equal((await f.get(f.rows[0]._id, db)).status, 'unavailable');
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $set: { epoch: 1 } });
  await f.db
    .collection('business_stock_snapshot_pages')
    .updateOne({ 'page.pageIndex': 0 }, { $set: { 'page.facts.0.availableMilli': -999 } });
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
});
test('expired incomplete transfers can be replaced, but stale or overlapping observations cannot regress ready state', async () => {
  const f = await fixture();
  const old = await f.pages();
  await f.send(old[0]);
  f.advance(FRESHNESS_MS);
  await assert.rejects(f.send(old[1]), /stale_stock_snapshot/);
  const next = await f.pages();
  for (const page of next) await f.send(page);
  assert.equal((await f.get(f.rows[0]._id)).status, 'low');
  const changed = await f.scan();
  changed.facts[101].name = 'Changed';
  const sameTime = createSnapshotPages(changed, f.branch, { now: f.now });
  await assert.rejects(f.send(sameTime[0]), /stale_stock_snapshot/);
});
test('empty complete observations and scope rejection do not invent healthy inventory', async () => {
  const f = await fixture(0);
  const pages = await f.pages();
  assert.equal(pages.length, 1);
  assert.equal((await f.send(pages[0])).complete, true);
  assert.equal((await f.get(new ObjectId())).status, 'unknown');
  await assert.rejects(
    receive(
      f.db,
      { ...f.device, branches: [String(new ObjectId())] },
      { assignmentId: f.owner.assignmentId, epoch: 1, page: pages[0] },
      { now: f.now }
    ),
    /branch_access_denied/
  );
  const wrong = structuredClone(pages[0]);
  wrong.summary.license = String(new ObjectId());
  await assert.rejects(f.send(wrong), /invalid_stock_summary/);
  assert.equal(digestOf(assembleSnapshot(pages, f.branch, { now: f.now })), pages[0].snapshotId);
});

test('final publication is assignment-fenced and a lost commit acknowledgement is recoverable', async () => {
  for (const mode of ['handover', 'lost-ack']) {
    const f = await fixture(1);
    const [page] = await f.pages();
    let injected = false;
    const database = {
      collection(name) {
        const collection = f.db.collection(name);
        return new Proxy(collection, {
          get(target, property) {
            if (name === 'business_reporting_publishers' && property === 'updateOne')
              return async (...args) => {
                if (!injected && args[1].$set?.stockSnapshot) {
                  injected = true;
                  if (mode === 'handover')
                    await target.updateOne({ _id: f.branch.id }, { $inc: { epoch: 1 } });
                  const result = await target.updateOne(...args);
                  if (mode === 'lost-ack') throw new Error('lost final acknowledgement');
                  return result;
                }
                return target.updateOne(...args);
              };
            return typeof target[property] === 'function'
              ? target[property].bind(target)
              : target[property];
          },
        });
      },
    };
    await assert.rejects(
      f.send(page, database),
      mode === 'handover' ? /publisher_not_assigned/ : /lost final acknowledgement/
    );
    assert.equal(injected, true);
    if (mode === 'lost-ack') {
      assert.equal((await f.send(page)).complete, true);
      assert.equal((await f.get(f.rows[0]._id)).status, 'low');
    } else assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
  }
});

test('maximum observation remains 100 bounded pages and incomplete receipt avoids full assembly reads', async () => {
  const f = await fixture(1);
  const observation = await f.scan();
  observation.facts = Array.from({ length: 10000 }, (_, index) => ({
    ...observation.facts[0],
    itemId: (index + 1).toString(16).padStart(24, '0'),
  }));
  Object.assign(observation.summary, {
    coverage: {
      scannedItems: 10000,
      verifiedItems: 10000,
      excludedItems: 0,
      unavailableItems: 0,
      reasons: {},
    },
    lowItemCount: 10000,
    lowItems: observation.facts.slice(0, 100),
    listTruncated: true,
  });
  const pages = createSnapshotPages(observation, f.branch, { now: f.now });
  assert.equal(pages.length, 100);
  assert.ok(pages.every((page) => page.facts.length === 100));
  assert.equal(assembleSnapshot(pages, f.branch, { now: f.now }).facts.length, 10000);
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_snapshot_pages' && property === 'find')
            return () => {
              throw new Error('incomplete transfer must not read every retained fact');
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  assert.equal((await f.send(pages[99], database)).complete, false);
  const invalid = structuredClone(pages[0]);
  invalid.facts.push(invalid.facts[0]);
  await assert.rejects(f.send(invalid), /invalid_stock_snapshot/);
});
