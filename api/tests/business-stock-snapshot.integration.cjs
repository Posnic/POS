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

test(
  'actual desktop snapshot pages traverse Gateway and match Community receipts and retained state',
  { skip: !process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT },
  async () => {
    const path = require('node:path');
    const gatewayRoot = process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT;
    const { MongoClient: GatewayClient } = require(
      path.join(gatewayRoot, 'apps/sync-gateway/node_modules/mongodb')
    );
    const { receiveStockSnapshot } = require(
      path.join(gatewayRoot, 'apps/sync-gateway/src/business-stock-snapshots')
    );
    const gateway = await GatewayClient.connect(mongo.getUri());
    try {
      const f = await fixture();
      await f.db
        .collection('items')
        .updateOne({ _id: f.rows[102]._id }, { $set: { available_quantity: 10 } });
      const pages = await f.pages();
      const cloud = gateway.db('cloud_' + f.db.databaseName);
      // Read through each driver's own BSON implementation.
      const source = gateway.db(f.db.databaseName);
      await cloud.collection('branches').insertOne(await source.collection('branches').findOne({}));
      await cloud
        .collection('business_reporting_publishers')
        .insertOne(await source.collection('business_reporting_publishers').findOne({}));
      for (const page of [...pages].reverse()) {
        const localReceipt = await f.send(page);
        const cloudReceipt = await receiveStockSnapshot(
          cloud,
          f.device,
          { assignmentId: f.owner.assignmentId, epoch: f.owner.epoch, page },
          { now: f.now }
        );
        assert.deepEqual(cloudReceipt, localReceipt);
      }
      const localOwner = await f.db
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      const cloudOwner = await cloud
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      assert.deepEqual(cloudOwner.stockSnapshot, localOwner.stockSnapshot);
      assert.equal(cloudOwner.stockSnapshot.summary.coverage.verifiedItems, 103);
      assert.equal(cloudOwner.stockSnapshot.summary.lowItemCount, 102);
      const healthyPage = await cloud
        .collection('business_stock_snapshot_pages')
        .findOne({ 'page.pageIndex': 1 });
      assert.equal(healthyPage.page.facts.at(-1).low, false);
      await assert.rejects(
        receiveStockSnapshot(
          cloud,
          { ...f.device, deviceId: 'other' },
          { assignmentId: f.owner.assignmentId, epoch: f.owner.epoch, page: pages[0] },
          { now: f.now }
        ),
        /publisher_not_assigned/
      );
    } finally {
      await gateway.close();
    }
  }
);

async function senderFixture(count = 103) {
  const f = await fixture(count);
  const crypto = require('node:crypto');
  const {
    createStockSnapshotSender,
    createCommunityStockSnapshotTransport,
  } = require('../src/services/business-stock-snapshot-sender');
  f.device.deviceId = f.owner.deviceId = 'community-' + crypto.randomUUID();
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $set: { deviceId: f.device.deviceId } });
  await f.db.collection('business_reporting_local').insertMany([
    { _id: 'community-installation', deviceId: f.device.deviceId },
    {
      _id: f.branch.id + ':stock',
      kind: 'job',
      publisherMode: 'community',
      summaryKind: 'stock',
      license: f.branch.license,
      branchId: f.branch.id,
      assignmentId: f.owner.assignmentId,
      epoch: f.owner.epoch,
      expiresAt: new Date(f.now() + 600000),
    },
  ]);
  const send = createCommunityStockSnapshotTransport(f.db, { now: f.now });
  const sender = (transport = send, database = f.db) =>
    createStockSnapshotSender(database, { now: f.now, send: transport });
  const state = () => f.db.collection('business_stock_alert_local').findOne({ kind: 'snapshot' });
  return { ...f, send, sender, state };
}

test('durable sender resumes the identical page after a lost server acknowledgement and releases completed facts', async () => {
  const f = await senderFixture();
  const observation = await f.scan();
  let lost = false;
  const sent = [];
  const first = f.sender(async (publication, options) => {
    sent.push(structuredClone(publication));
    const receipt = await f.send(publication, options);
    if (!lost) {
      lost = true;
      throw new Error('lost response');
    }
    return receipt;
  });
  await first.stage(observation, f.branch, 'community');
  await assert.rejects(first.tick(), /lost response/);
  assert.equal((await f.state()).nextPage, 0);
  f.advance(10000);
  const resumed = f.sender(async (publication, options) => {
    sent.push(structuredClone(publication));
    return f.send(publication, options);
  });
  assert.deepEqual(await resumed.tick(), { sent: 2, complete: true });
  assert.deepEqual(sent[0], sent[1]);
  assert.equal((await f.state()).observation, undefined);
  assert.equal((await f.state()).lastReceipt.complete, true);
  assert.equal((await f.get(f.rows[102]._id)).status, 'low');
  assert.equal((await resumed.stage(observation, f.branch, 'community')).duplicate, true);
});

test('sender persists a bounded cursor and restart sends remaining pages, not a new snapshot', async () => {
  const f = await senderFixture(1003);
  const sender = f.sender();
  await sender.stage(await f.scan(), f.branch, 'community');
  assert.deepEqual(await sender.tick(), { sent: 10, complete: false });
  assert.equal((await f.state()).nextPage, 10);
  assert.equal((await f.get(f.rows[0]._id)).status, 'unavailable');
  assert.deepEqual(await f.sender().tick(), { sent: 1, complete: true });
  assert.equal((await f.get(f.rows[1002]._id)).status, 'low');
});

test('sender refuses invalid or incomplete final receipts and preserves the frozen publisher after reassignment', async () => {
  const f = await senderFixture(1);
  const sender = f.sender(async (publication, options) => ({
    ...(await f.send(publication, options)),
    complete: false,
  }));
  await sender.stage(await f.scan(), f.branch, 'community');
  await assert.rejects(sender.tick(), /invalid_stock_snapshot_receipt/);
  assert.equal((await f.state()).nextPage, 0);
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $inc: { epoch: 1 } });
  await f.db
    .collection('business_reporting_local')
    .updateOne({ kind: 'job' }, { $inc: { epoch: 1 } });
  f.advance(10000);
  await assert.rejects(f.sender().tick(), /publisher_not_assigned/);
  assert.equal((await f.state()).epoch, 1);
});

test('expired sender observations are discarded explicitly and fresh staging requires a live assignment', async () => {
  const f = await senderFixture(1);
  const sender = f.sender();
  const old = await f.scan();
  await sender.stage(old, f.branch, 'community');
  f.advance();
  await assert.rejects(
    sender.stage(await f.scan(), f.branch, 'community'),
    /stock_snapshot_pending/
  );
  f.advance(FRESHNESS_MS);
  assert.deepEqual(await sender.tick(), { discarded: true });
  assert.equal((await f.state()).lastDiscarded.reason, 'stale_stock_snapshot');
  assert.equal((await f.state()).observation, undefined);
  await f.db
    .collection('business_reporting_local')
    .updateOne({ kind: 'job' }, { $set: { expiresAt: new Date(0) } });
  await assert.rejects(
    sender.stage(await f.scan(), f.branch, 'community'),
    /stock_snapshot_assignment_required/
  );
  assert.equal(await f.db.collection('business_stock_snapshot_pages').countDocuments({}), 0);
});

test('late responses after lease loss or stop cannot advance a snapshot cursor', async () => {
  for (const mode of ['lease-loss', 'stop']) {
    const f = await senderFixture(1);
    const sender = f.sender(async (publication, options) => {
      const receipt = await f.send(publication, options);
      if (mode === 'stop') sender.stop();
      else
        await f.db
          .collection('business_stock_alert_local')
          .updateOne({ kind: 'snapshot' }, { $set: { leaseId: 'successor' } });
      return receipt;
    });
    await sender.stage(await f.scan(), f.branch, 'community');
    await sender.tick();
    assert.equal((await f.state()).nextPage, 0);
    assert.ok((await f.state()).observation);
    f.advance(31000);
    assert.deepEqual(await f.sender().tick(), { sent: 1, complete: true });
  }
});

test('tampered source snapshots cannot be retried, silently overwritten or transmitted', async () => {
  const f = await senderFixture(1);
  let sent = false;
  const sender = f.sender(async () => {
    sent = true;
    throw new Error('unexpected send');
  });
  const observation = await f.scan();
  await sender.stage(observation, f.branch, 'community');
  await f.db
    .collection('business_stock_alert_local')
    .updateOne({ kind: 'snapshot' }, { $set: { 'observation.facts.0.name': 'Changed' } });
  await assert.rejects(
    sender.stage(observation, f.branch, 'community'),
    /invalid_stock_snapshot_state/
  );
  await assert.rejects(sender.tick());
  assert.equal(sent, false);
  assert.equal((await f.state()).nextPage, 0);
});

async function cloudSenderFixture(count = 103, transform) {
  const f = await senderFixture(count);
  const path = require('node:path'),
    root = process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT;
  const { MongoClient: GatewayClient } = require(
    path.join(root, 'apps/sync-gateway/node_modules/mongodb')
  );
  const { createStockSnapshotPublisher } = require(
    path.join(root, 'apps/sync-agent/src/business-stock-snapshots')
  );
  const { receiveStockSnapshot } = require(
    path.join(root, 'apps/sync-gateway/src/business-stock-snapshots')
  );
  const {
    createStockSnapshotAgentTransport,
  } = require('../src/services/business-stock-snapshot-agent-transport');
  const { createStockSnapshotSender } = require('../src/services/business-stock-snapshot-sender');
  const gateway = await GatewayClient.connect(mongo.getUri());
  const agentDb = gateway.db(f.db.databaseName),
    cloud = gateway.db('cloud_sender_' + f.db.databaseName);
  await cloud.collection('branches').insertOne(await agentDb.collection('branches').findOne({}));
  await cloud
    .collection('business_reporting_publishers')
    .insertOne(await agentDb.collection('business_reporting_publishers').findOne({}));
  await f.db
    .collection('business_reporting_local')
    .updateOne({ kind: 'job' }, { $set: { publisherMode: 'cloud' } });
  await f.db.collection('business_reporting_local').insertOne({
    _id: 'desktop-runtime',
    protocolVersion: 2,
    stockSnapshotVersion: 1,
    expiresAt: new Date(f.now() + 1200000),
    stockSnapshotExpiresAt: new Date(f.now() + 1200000),
  });
  const publications = [];
  const request = async (route, body) => {
    if (route === '/v1/business/reporting/claim')
      return { branchId: f.branch.id, assignmentId: f.owner.assignmentId, epoch: f.owner.epoch };
    assert.equal(route, '/v1/business/reporting/stock-snapshot');
    publications.push(structuredClone(body));
    return receiveStockSnapshot(cloud, f.device, body, { now: f.now });
  };
  const sender = createStockSnapshotSender(f.db, {
    now: f.now,
    send: createStockSnapshotAgentTransport(f.db, { now: f.now }),
  });
  const agent = (hook) =>
    createStockSnapshotPublisher({
      db: agentDb,
      now: f.now,
      send: hook ? (route, body) => hook(route, body, request) : request,
    });
  return { ...f, gateway, cloud, sender, agent, publications, transform };
}
const cloudTest = { skip: !process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT };
test(
  'real desktop mailbox, agent and Gateway resume after lost acknowledgement and consume exact saved receipts',
  cloudTest,
  async () => {
    const f = await cloudSenderFixture();
    try {
      await f.sender.stage(await f.scan(), f.branch, 'cloud');
      await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
      let lost = false;
      const first = f.agent(async (route, body, request) => {
        const response = await request(route, body);
        if (route.endsWith('/stock-snapshot') && !lost) {
          lost = true;
          throw new Error('lost cloud response');
        }
        return response;
      });
      await assert.rejects(first.tick(), /lost cloud response/);
      assert.equal((await f.state()).transportNextPage, 0);
      f.advance(10000);
      assert.deepEqual(await f.agent().tick(), { sent: 2, complete: true });
      assert.deepEqual(f.publications[0], f.publications[1]);
      assert.deepEqual(await f.sender.tick(), { sent: 2, complete: true });
      assert.equal((await f.state()).observation, undefined);
      assert.equal((await f.state()).transportReceipts, undefined);
      assert.equal((await f.state()).nextTransportAt, undefined);
      const ready = await f.cloud
        .collection('business_reporting_publishers')
        .findOne({ _id: f.branch.id });
      assert.equal(ready.stockSnapshot.summary.coverage.verifiedItems, 103);
      f.advance();
      await f.sender.stage(await f.scan(), f.branch, 'cloud');
      await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
      assert.equal((await f.state()).transportNextPage, 0);
      assert.equal((await f.state()).transportBinding, undefined);
    } finally {
      await f.gateway.close();
    }
  }
);
test(
  'Cloud snapshot capability is rechecked after assignment lookup and stale heartbeat fields cannot authorize upload',
  cloudTest,
  async () => {
    const f = await cloudSenderFixture(1);
    try {
      await f.sender.stage(await f.scan(), f.branch, 'cloud');
      await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
      const agent = f.agent(async (route, body, request) => {
        const result = await request(route, body);
        if (route.endsWith('/claim'))
          await f.db
            .collection('business_reporting_local')
            .updateOne(
              { _id: 'desktop-runtime' },
              { $set: { expiresAt: new Date(f.now() + 1300000) } }
            );
        return result;
      });
      await assert.rejects(agent.tick(), /stock_snapshot_worker_unavailable/);
      assert.equal(f.publications.length, 0);
      f.advance(10000);
      assert.equal(await f.agent().tick(), undefined);
      assert.equal(await f.cloud.collection('business_stock_snapshot_pages').countDocuments({}), 0);
    } finally {
      await f.gateway.close();
    }
  }
);
test(
  'Cloud snapshot agent does not acknowledge malformed receipts or late responses after a lease replacement',
  cloudTest,
  async () => {
    for (const mode of ['receipt', 'lease']) {
      const f = await cloudSenderFixture(1);
      try {
        await f.sender.stage(await f.scan(), f.branch, 'cloud');
        await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
        const agent = f.agent(async (route, body, request) => {
          const result = await request(route, body);
          if (route.endsWith('/stock-snapshot')) {
            if (mode === 'receipt') return { ...result, complete: false };
            await f.db
              .collection('business_stock_alert_local')
              .updateOne({ kind: 'snapshot' }, { $set: { transportLeaseId: 'successor' } });
          }
          return result;
        });
        if (mode === 'receipt')
          await assert.rejects(agent.tick(), /invalid_stock_snapshot_receipt/);
        else await agent.tick();
        assert.equal((await f.state()).transportNextPage, 0);
        assert.equal((await f.state()).transportReceipts, undefined);
        f.advance(31000);
        assert.deepEqual(await f.agent().tick(), { sent: 1, complete: true });
        assert.deepEqual(await f.sender.tick(), { sent: 1, complete: true });
      } finally {
        await f.gateway.close();
      }
    }
  }
);
test(
  'Cloud snapshot agent cannot adopt a replacement assignment when binding its staged observation',
  cloudTest,
  async () => {
    const f = await cloudSenderFixture(1);
    try {
      await f.sender.stage(await f.scan(), f.branch, 'cloud');
      await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
      const agent = f.agent(async (route, body, request) =>
        route.endsWith('/claim')
          ? { branchId: f.branch.id, assignmentId: 'z'.repeat(43), epoch: 2 }
          : request(route, body)
      );
      await assert.rejects(agent.tick(), /publisher_not_assigned/);
      assert.equal((await f.state()).assignmentId, f.owner.assignmentId);
      assert.equal(f.publications.length, 0);
    } finally {
      await f.gateway.close();
    }
  }
);

test(
  'existing agent reporting tick drains the snapshot mailbox and keeps ordinary work discovery',
  cloudTest,
  async () => {
    const f = await cloudSenderFixture(1);
    try {
      await f.sender.stage(await f.scan(), f.branch, 'cloud');
      await assert.rejects(f.sender.tick(), /stock_snapshot_awaiting_agent/);
      const path = require('node:path');
      const { createBusinessPublisher } = require(
        path.join(
          process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT,
          'apps/sync-agent/src/business-reporting'
        )
      );
      const { receiveStockSnapshot } = require(
        path.join(
          process.env.POSNIC_BUSINESS_TEST_GATEWAY_ROOT,
          'apps/sync-gateway/src/business-stock-snapshots'
        )
      );
      let work = 0;
      const publisher = createBusinessPublisher({
        db: f.db,
        now: f.now,
        send: async (route, body) => {
          if (route.endsWith('/work')) {
            work++;
            return [];
          }
          if (route.endsWith('/claim'))
            return {
              branchId: f.branch.id,
              assignmentId: f.owner.assignmentId,
              epoch: f.owner.epoch,
            };
          assert.equal(route, '/v1/business/reporting/stock-snapshot');
          return receiveStockSnapshot(f.cloud, f.device, body, { now: f.now });
        },
      });
      await publisher.tick();
      assert.equal(work, 1);
      assert.equal((await f.state()).transportReceipts['0'].complete, true);
    } finally {
      await f.gateway.close();
    }
  }
);

async function recipientFixture() {
  const f = await fixture();
  const user = {
    _id: new ObjectId(),
    license: new ObjectId(f.branch.license),
    activate: true,
    usertype: 'manager',
    access: { item: { read: true } },
    branch_access: [{ branch_id: new ObjectId(f.branch.id) }],
  };
  await f.db.collection('users').insertOne(user);
  await f.db
    .collection('branches')
    .updateOne(
      { _id: new ObjectId(f.branch.id) },
      { $set: { branch_name: 'Central', currency: 'INR', time_zone: 'Asia/Kolkata' } }
    );
  const context = await require('../src/services/business-access')
    .createBusinessAccess(f.db, { now: f.now })
    .contextFor(user);
  const {
    saveStockPreference,
  } = require('../src/services/business-stock-notification-preferences');
  await saveStockPreference(
    f.db,
    context,
    f.branch.id,
    {
      expectedRevision: 0,
      enabled: true,
      minimumIntervalMinutes: 15,
      quiet: { enabled: false, start: '22:00', end: '07:00' },
    },
    { now: f.now }
  );
  for (const page of await f.pages()) await f.send(page);
  const target = {
    accountId: String(user._id),
    businessId: f.branch.license,
    branchId: f.branch.id,
  };
  const readPage = (options = {}, database = f.db) =>
    require('../src/services/business-stock-recipient').readRecipientStockPage(database, target, {
      now: f.now,
      ...options,
    });
  return { ...f, user, context, target, readPage };
}
test('stock-only recipients page the complete verified set on Cloud without desktop mode', async () => {
  const f = await recipientFixture();
  assert.equal(f.context.capabilities.includes('overview.read'), false);
  process.env.POSNIC_DESKTOP = '0';
  try {
    const first = await f.readPage();
    assert.equal(first.status, 'ready');
    assert.equal(first.facts.length, 100);
    assert.equal(first.summary.sourceComplete, false);
    const last = await f.readPage({ cursor: first.nextCursor });
    assert.equal(last.facts.length, 3);
    assert.equal(last.nextCursor, null);
  } finally {
    process.env.POSNIC_DESKTOP = '1';
  }
});
test('recipient selection enforces current ACL, branch membership, account activation and tenant', async () => {
  const f = await recipientFixture();
  for (const change of [
    { 'access.item.read': false },
    { 'access.item.read': true, branch_access: [] },
    { branch_access: f.user.branch_access, activate: false },
  ]) {
    await f.db.collection('users').updateOne({ _id: f.user._id }, { $set: change });
    assert.equal((await f.readPage()).status, 'denied');
  }
  await f.db.collection('users').updateOne({ _id: f.user._id }, { $set: { activate: true } });
  const read = require('../src/services/business-stock-recipient').readRecipientStockPage;
  assert.equal(
    (await read(f.db, { ...f.target, businessId: String(new ObjectId()) }, { now: f.now })).status,
    'denied'
  );
});
test('recipient snapshot cursors cannot combine observations or cross opt-in activations', async () => {
  const f = await recipientFixture();
  const first = await f.readPage();
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await f.readPage({ cursor: first.nextCursor })).status, 'unavailable');
  const {
    saveStockPreference,
  } = require('../src/services/business-stock-notification-preferences');
  const settings = {
    minimumIntervalMinutes: 15,
    quiet: { enabled: false, start: '22:00', end: '07:00' },
  };
  await saveStockPreference(
    f.db,
    f.context,
    f.branch.id,
    { ...settings, enabled: false, expectedRevision: 1 },
    { now: f.now }
  );
  assert.equal((await f.readPage()).status, 'disabled');
  f.advance();
  await saveStockPreference(
    f.db,
    f.context,
    f.branch.id,
    { ...settings, enabled: true, expectedRevision: 2 },
    { now: f.now }
  );
  assert.equal((await f.readPage({ cursor: first.nextCursor })).status, 'changed');
  assert.equal((await f.readPage()).status, 'unavailable');
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await f.readPage()).status, 'ready');
});
test('recipient cadence and branch-time quiet hours defer without loading stock pages', async () => {
  const f = await recipientFixture();
  const prefs = f.db.collection('business_stock_notification_preferences');
  await prefs.updateOne(
    { accountId: f.target.accountId },
    { $set: { lastNotifiedAt: new Date(f.now() - 5 * 60000) } }
  );
  const result = await f.readPage();
  assert.equal(result.status, 'deferred');
  assert.equal(result.retryAt.getTime(), f.now() + 10 * 60000);
  const moment = require('moment-timezone'),
    local = moment(f.now()).tz('Asia/Kolkata');
  await prefs.updateOne(
    { accountId: f.target.accountId },
    {
      $unset: { lastNotifiedAt: '' },
      $set: {
        quiet: {
          enabled: true,
          start: local.format('HH:mm'),
          end: local.clone().add(30, 'minutes').format('HH:mm'),
        },
      },
    }
  );
  const guarded = {
    collection(name) {
      if (name === 'business_stock_snapshot_pages')
        throw new Error('quiet recipients must not load stock');
      return f.db.collection(name);
    },
  };
  const quiet = await f.readPage({}, guarded);
  assert.equal(quiet.status, 'deferred');
  assert.ok(quiet.retryAt.getTime() > f.now());
});
test('recipient permission or preference changes during the snapshot read discard the candidate', async () => {
  for (const mode of ['acl', 'revision']) {
    const f = await recipientFixture();
    const guarded = {
      collection(name) {
        const collection = f.db.collection(name);
        return new Proxy(collection, {
          get(target, property) {
            if (name === 'business_stock_snapshot_pages' && property === 'findOne')
              return async (...args) => {
                const row = await target.findOne(...args);
                if (mode === 'acl')
                  await f.db
                    .collection('users')
                    .updateOne({ _id: f.user._id }, { $set: { 'access.item.read': false } });
                else
                  await f.db
                    .collection('business_stock_notification_preferences')
                    .updateOne({ accountId: f.target.accountId }, { $inc: { revision: 1 } });
                return row;
              };
            return typeof target[property] === 'function'
              ? target[property].bind(target)
              : target[property];
          },
        });
      },
    };
    assert.equal((await f.readPage({}, guarded)).status, mode === 'acl' ? 'denied' : 'changed');
  }
});
test('corrupt snapshot page indexes and future recipient cadence fail closed', async () => {
  const f = await recipientFixture();
  await f.db
    .collection('business_reporting_publishers')
    .updateOne(
      { _id: f.branch.id },
      { $set: { 'stockSnapshot.pages.0.first': String(new ObjectId()) } }
    );
  assert.equal((await f.readPage()).status, 'unavailable');
  await f.db
    .collection('business_stock_notification_preferences')
    .updateOne(
      { accountId: f.target.accountId },
      { $set: { lastNotifiedAt: new Date(f.now() + 1) } }
    );
  await assert.rejects(f.readPage(), /preference_unavailable/);
});

const journalRecipient = (f, options = {}, database = f.db) =>
  require('../src/services/business-stock-recipient-journal').journalRecipientStockPage(
    database,
    f.target,
    { now: f.now, ...options }
  );
const recipientRows = (f) =>
  f.db
    .collection('business_stock_recipient_state')
    .find({ accountId: f.target.accountId })
    .sort({ itemId: 1 })
    .toArray();
test('recipient journal creates a full baseline, resumes partial pages and deduplicates concurrent replay', async () => {
  const f = await recipientFixture();
  const first = await journalRecipient(f, { limit: 1 });
  assert.equal(first.queued, 1);
  assert.equal(first.processed, 1);
  assert.equal(first.next.afterItemId, String(f.rows[0]._id));
  const rest = await journalRecipient(f, first.next);
  assert.equal(rest.processed, 99);
  const end = await journalRecipient(f, rest.next);
  assert.equal(end.queued, 3);
  assert.equal(end.next, null);
  const before = await recipientRows(f);
  assert.equal(before.length, 103);
  assert.ok(before.every((row) => row.pending && row.episode === 1));
  const replay = await Promise.all([journalRecipient(f), journalRecipient(f)]);
  assert.ok(replay.every((result) => result.queued === 0));
  assert.deepEqual(
    (await recipientRows(f)).map((row) => row.pending.id),
    before.map((row) => row.pending.id)
  );
});
test('recipient journal observes healthy transitions during quiet hours, while unknown stock cannot re-arm', async () => {
  const f = await recipientFixture();
  await journalRecipient(f, { limit: 1 });
  const original = (await recipientRows(f))[0].pending.id;
  const moment = require('moment-timezone'),
    local = moment(f.now()).tz('Asia/Kolkata');
  await f.db.collection('business_stock_notification_preferences').updateOne(
    { accountId: f.target.accountId },
    {
      $set: {
        quiet: {
          enabled: true,
          start: local.format('HH:mm'),
          end: local.clone().add(30, 'minutes').format('HH:mm'),
        },
      },
    }
  );
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $unset: { available_quantity: '' } });
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await f.readPage()).status, 'deferred');
  await journalRecipient(f);
  assert.equal((await recipientRows(f))[0].pending.id, original);
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  await journalRecipient(f);
  let state = (await recipientRows(f))[0];
  assert.equal(state.pending, undefined);
  assert.equal(state.lastSuppressed.reason, 'verified_healthy');
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 1 } });
  for (const page of await f.pages()) await f.send(page);
  await journalRecipient(f);
  state = (await recipientRows(f))[0];
  assert.equal(state.episode, 2);
  assert.notEqual(state.pending.id, original);
  assert.equal((await f.readPage()).status, 'deferred');
});
test('a reporting publisher handover cannot repeat a recipient low episode', async () => {
  const f = await recipientFixture();
  await journalRecipient(f);
  const before = (await recipientRows(f)).map((row) => row.pending.id);
  f.owner.assignmentId = 'q'.repeat(43);
  f.owner.epoch = 2;
  await f.db
    .collection('business_reporting_publishers')
    .updateOne({ _id: f.branch.id }, { $set: { assignmentId: f.owner.assignmentId, epoch: 2 } });
  f.advance();
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await journalRecipient(f)).queued, 0);
  assert.deepEqual(
    (await recipientRows(f)).map((row) => row.pending.id),
    before
  );
});
test('recipient replay after a lost database acknowledgement cannot duplicate pending identities', async () => {
  const f = await recipientFixture();
  let failed = false;
  const guarded = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_recipient_state' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (!failed) {
                failed = true;
                throw new Error('lost recipient write');
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
  await assert.rejects(journalRecipient(f, {}, guarded), /lost recipient write/);
  const persisted = (await recipientRows(f))[0].pending.id;
  const resumed = await journalRecipient(f);
  assert.equal(resumed.queued, 99);
  assert.equal((await recipientRows(f))[0].pending.id, persisted);
});
test('new opt-in replaces old recipient identities while corrupt state cannot be overwritten', async () => {
  const f = await recipientFixture();
  await journalRecipient(f, { limit: 1 });
  const old = (await recipientRows(f))[0];
  const {
    saveStockPreference,
  } = require('../src/services/business-stock-notification-preferences');
  const settings = {
    minimumIntervalMinutes: 15,
    quiet: { enabled: false, start: '22:00', end: '07:00' },
  };
  await saveStockPreference(
    f.db,
    f.context,
    f.branch.id,
    { ...settings, enabled: false, expectedRevision: 1 },
    { now: f.now }
  );
  f.advance();
  await saveStockPreference(
    f.db,
    f.context,
    f.branch.id,
    { ...settings, enabled: true, expectedRevision: 2 },
    { now: f.now }
  );
  for (const page of await f.pages()) await f.send(page);
  await journalRecipient(f, { limit: 1 });
  const next = (await recipientRows(f))[0];
  assert.notEqual(next.pending.id, old.pending.id);
  assert.notEqual(next.activationId, old.activationId);
  assert.equal(next.episode, 1);
  await f.db
    .collection('business_stock_recipient_state')
    .updateOne({ _id: next._id }, { $set: { 'pending.id': 'forged' } });
  await assert.rejects(journalRecipient(f), /invalid_stock_recipient_state/);
});

test('acknowledged recipient candidates do not return while the same item remains low', async () => {
  const f = await recipientFixture();
  await journalRecipient(f, { limit: 1 });
  const row = (await recipientRows(f))[0];
  await f.db
    .collection('business_stock_recipient_state')
    .updateOne(
      { _id: row._id, 'pending.id': row.pending.id },
      { $unset: { pending: '' }, $set: { lastDelivered: row.pending.id } }
    );
  f.advance();
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await journalRecipient(f, { limit: 1 })).queued, 0);
  assert.equal((await recipientRows(f))[0].pending, undefined);
  assert.equal((await recipientRows(f))[0].episode, 1);
});

const recipientWorker = (f, options = {}) =>
  require('../src/services/business-stock-recipient-worker').createStockRecipientWorker(f.db, {
    now: f.now,
    ...options,
  });
const scanPreference = (f) =>
  f.db
    .collection('business_stock_notification_preferences')
    .findOne({ accountId: f.target.accountId });
test('recipient scan worker persists a page cursor and resumes after process recreation', async () => {
  const f = await recipientFixture();
  assert.deepEqual(await recipientWorker(f).tick({ maxPages: 1 }), {
    pages: 1,
    queued: 100,
    state: 'partial',
  });
  assert.equal((await scanPreference(f)).cursor.cursor.pageIndex, 1);
  f.advance();
  assert.deepEqual(await recipientWorker(f).tick(), { pages: 1, queued: 3, state: 'complete' });
  const preference = await scanPreference(f);
  assert.equal(preference.cursor, undefined);
  assert.ok(preference.lastScannedSnapshotId);
  assert.equal(preference.nextScanAt.getTime(), f.now() + 60000);
  assert.equal((await recipientRows(f)).length, 103);
});
test('recipient scan crash after journalling replays safely without losing a page or duplicating candidates', async () => {
  const f = await recipientFixture();
  const { journalRecipientStockPage } = require('../src/services/business-stock-recipient-journal');
  const worker = recipientWorker(f, {
    journal: async (...args) => {
      await journalRecipientStockPage(...args);
      throw new Error('crash before cursor');
    },
  });
  await assert.rejects(worker.tick(), /crash before cursor/);
  assert.equal((await scanPreference(f)).cursor, undefined);
  const before = (await recipientRows(f)).map((row) => row.pending.id);
  f.advance(60000);
  assert.deepEqual(await recipientWorker(f).tick(), { pages: 2, queued: 3, state: 'complete' });
  assert.deepEqual(
    (await recipientRows(f)).slice(0, 100).map((row) => row.pending.id),
    before
  );
});
test('recipient scan cannot overwrite successor leases or preferences edited during work', async () => {
  for (const mode of ['lease', 'settings', 'stop']) {
    const f = await recipientFixture();
    const {
      journalRecipientStockPage,
    } = require('../src/services/business-stock-recipient-journal');
    const worker = recipientWorker(f, {
      journal: async (...args) => {
        const result = await journalRecipientStockPage(...args);
        if (mode === 'lease')
          await f.db
            .collection('business_stock_notification_preferences')
            .updateOne({ accountId: f.target.accountId }, { $set: { leaseId: 'successor' } });
        else if (mode === 'stop') worker.stop();
        else
          await require('../src/services/business-stock-notification-preferences').saveStockPreference(
            f.db,
            f.context,
            f.branch.id,
            {
              enabled: true,
              expectedRevision: 1,
              minimumIntervalMinutes: 30,
              quiet: { enabled: false, start: '22:00', end: '07:00' },
            },
            { now: f.now }
          );
        return result;
      },
    });
    await worker.tick();
    assert.equal((await scanPreference(f)).cursor, undefined);
    if (mode === 'lease') assert.equal((await scanPreference(f)).leaseId, 'successor');
    if (mode === 'settings') assert.equal((await scanPreference(f)).revision, 2);
    f.advance(31000);
    assert.equal((await recipientWorker(f).tick()).state, 'complete');
    assert.equal((await recipientRows(f)).length, 103);
  }
});
test('recipient scan restarts a superseded snapshot cursor instead of combining snapshots', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick({ maxPages: 1 });
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await recipientWorker(f).tick()).state, 'unavailable');
  assert.equal((await scanPreference(f)).cursor, undefined);
  f.advance(15000);
  assert.equal((await recipientWorker(f).tick()).state, 'complete');
  assert.equal((await recipientRows(f))[0].pending, undefined);
});

const materializeStock = (f, database = f.db) =>
  require('../src/services/business-stock-materializer').materializeStockAlert(database, f.target, {
    now: f.now,
  });
test('one grouped Inbox entry covers the entire verified-low baseline and acknowledges all its candidates', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  const result = await materializeStock(f);
  assert.equal(result.status, 'materialized');
  assert.equal(result.newLowItemCount, 103);
  const entries = await f.db.collection('business_inbox').find({}).toArray();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].stock.items.length, 20);
  assert.equal(entries[0].stock.listTruncated, true);
  assert.equal(entries[0].stock.totalLowItemCount, 103);
  assert.equal(entries[0].stock.sourceComplete, false);
  assert.equal(entries[0].pushPending, false);
  assert.equal(entries[0].materializationPending, false);
  assert.ok((await recipientRows(f)).every((row) => row.pending === undefined));
  assert.equal((await materializeStock(f)).status, 'deferred');
});
test('lost Inbox insertion acknowledgement retries the immutable group without duplication', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  let failed = false;
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_inbox' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (!failed && args[1].$setOnInsert) {
                failed = true;
                throw new Error('lost Inbox acknowledgement');
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
  await assert.rejects(materializeStock(f, database), /lost Inbox acknowledgement/);
  const before = await f.db.collection('business_inbox').findOne({});
  assert.equal(before.materializationPending, true);
  assert.equal((await materializeStock(f)).eventId, String(before._id));
  assert.equal(await f.db.collection('business_inbox').countDocuments({}), 1);
});
test('committed group cleanup resumes despite cadence deferral and does not acknowledge a later episode', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  let failed = false;
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_recipient_state' && property === 'updateMany')
            return async (...args) => {
              if (!failed && args[1].$unset?.pending === '') {
                failed = true;
                throw new Error('cleanup interrupted');
              }
              return target.updateMany(...args);
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  await assert.rejects(materializeStock(f, database), /cleanup interrupted/);
  assert.ok((await scanPreference(f)).stockDelivery.committedAt);
  // A healthy/low transition creates a different candidate while cleanup is pending.
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  await journalRecipient(f, { limit: 1 });
  f.advance();
  await f.db
    .collection('items')
    .updateOne({ _id: f.rows[0]._id }, { $set: { available_quantity: 1 } });
  for (const page of await f.pages()) await f.send(page);
  await journalRecipient(f, { limit: 1 });
  const pending = (await recipientRows(f))[0].pending;
  assert.equal(pending.episode, 2);
  assert.equal((await materializeStock(f)).status, 'materialized');
  assert.equal((await recipientRows(f))[0].pending.id, pending.id);
  assert.equal((await scanPreference(f)).stockDelivery, undefined);
});
test('uncommitted groups are cancelled when their snapshot changes and current candidates remain available', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_inbox' && property === 'updateOne')
            return async () => {
              throw new Error('before Inbox');
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  await assert.rejects(materializeStock(f, database), /before Inbox/);
  const oldGroup = (await scanPreference(f)).stockDelivery.id;
  f.advance(60000);
  for (const page of await f.pages()) await f.send(page);
  await recipientWorker(f).tick();
  assert.equal((await materializeStock(f)).status, 'changed');
  assert.ok((await recipientRows(f)).every((row) => row.pending && !row.pending.groupId));
  const result = await materializeStock(f);
  assert.equal(result.status, 'materialized');
  const event = await f.db.collection('business_inbox').findOne({});
  assert.equal(event.eventKey.endsWith(oldGroup), false);
});
test('group materialization requires a complete scan, live permission and a matching settings revision', async () => {
  const f = await recipientFixture();
  assert.equal((await materializeStock(f)).status, 'scan_required');
  await recipientWorker(f).tick();
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_inbox' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (args[1].$setOnInsert)
                await require('../src/services/business-stock-notification-preferences').saveStockPreference(
                  f.db,
                  f.context,
                  f.branch.id,
                  {
                    enabled: false,
                    expectedRevision: 1,
                    minimumIntervalMinutes: 15,
                    quiet: { enabled: false, start: '22:00', end: '07:00' },
                  },
                  { now: f.now }
                );
              return result;
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  assert.equal((await materializeStock(f, database)).status, 'disabled');
  assert.equal((await f.db.collection('business_inbox').findOne({})).materializationPending, true);
  assert.equal((await materializeStock(f)).status, 'disabled');
  assert.ok((await recipientRows(f)).some((row) => row.pending));
});

test('permission revoked during Inbox insertion leaves the stock group uncommitted and push-ineligible', async () => {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_inbox' && property === 'updateOne')
            return async (...args) => {
              const result = await target.updateOne(...args);
              if (args[1].$setOnInsert)
                await f.db
                  .collection('users')
                  .updateOne({ _id: f.user._id }, { $set: { 'access.item.read': false } });
              return result;
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  assert.equal((await materializeStock(f, database)).status, 'denied');
  const event = await f.db.collection('business_inbox').findOne({});
  assert.equal(event.materializationPending, true);
  assert.equal(event.pushPending, false);
  assert.equal((await scanPreference(f)).lastNotifiedAt, undefined);
});

const stockInbox = (f, options = {}) =>
  require('../src/services/business-notifications').listInbox(f.db, f.context, {
    includeStock: true,
    now: f.now,
    ...options,
  });
const readStockEvent = (f, id) =>
  require('../src/services/business-notifications').markRead(f.db, f.context, id, { now: f.now });
async function inboxFixture() {
  const f = await recipientFixture();
  await recipientWorker(f).tick();
  const event = await materializeStock(f);
  return { ...f, eventId: event.eventId };
}

test('stock-only Inbox requires negotiation, excludes financial entries and reads historical observations during cadence', async () => {
  const f = await inboxFixture();
  assert.equal(f.context.capabilities.includes('overview.read'), false);
  const original = await f.db.collection('business_inbox').findOne({});
  await f.db.collection('business_inbox').insertOne({
    ...original,
    _id: new ObjectId(),
    eventKey: 'financial',
    kind: 'daily_summary',
    summary: { privateFinancial: 12345 },
  });
  assert.deepEqual(await stockInbox(f, { includeStock: false }), { entries: [], next: null });
  const result = await stockInbox(f);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, f.eventId);
  assert.equal(result.entries[0].summary, null);
  assert.equal(result.entries[0].stock.newLowItemCount, 103);
  assert.equal(result.entries[0].stock.sourceComplete, false);
  assert.match(result.entries[0].businessDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.entries[0].stockDigest, undefined);
  assert.deepEqual(await readStockEvent(f, f.eventId), { read: true });
  assert.equal((await stockInbox(f)).entries[0].read, true);
  f.advance(60000);
  await f.db.collection('items').updateMany({}, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await stockInbox(f)).entries[0].stock.newLowItemCount, 103);
});

test('stock Inbox and read acknowledgement recheck live ACL, branch, activation and opt-in', async () => {
  for (const mode of ['acl', 'branch', 'activation', 'disabled', 'inactive', 'feature']) {
    const f = await inboxFixture();
    if (mode === 'acl')
      await f.db
        .collection('users')
        .updateOne({ _id: f.user._id }, { $set: { 'access.item.read': false } });
    if (mode === 'branch')
      await f.db
        .collection('users')
        .updateOne({ _id: f.user._id }, { $set: { branch_access: [] } });
    if (mode === 'inactive')
      await f.db.collection('users').updateOne({ _id: f.user._id }, { $set: { activate: false } });
    if (mode === 'activation')
      await f.db
        .collection('business_stock_notification_preferences')
        .updateOne({}, { $set: { activationId: require('node:crypto').randomUUID() } });
    if (mode === 'disabled')
      await f.db
        .collection('business_stock_notification_preferences')
        .updateOne({}, { $set: { enabled: false } });
    const prior = process.env.POSNIC_BUSINESS_STOCK_ALERTS;
    if (mode === 'feature') process.env.POSNIC_BUSINESS_STOCK_ALERTS = '0';
    try {
      assert.equal((await stockInbox(f)).entries.length, 0, mode);
      await assert.rejects(readStockEvent(f, f.eventId), { code: 'entry_unavailable' }, mode);
    } finally {
      process.env.POSNIC_BUSINESS_STOCK_ALERTS = prior;
    }
  }
});

test('stock Inbox hides corrupt, partial, expired and out-of-scope entries and rejects marking them read', async () => {
  const f = await inboxFixture();
  const original = await f.db.collection('business_inbox').findOne({});
  const { digestOf } = require('../src/services/business-stock-snapshot-contract');
  for (const change of [
    { materializationPending: true },
    { stockDigest: 'bad' },
    { expiresAt: new Date(f.now() - 1) },
    { createdAt: new Date(f.now() + 1) },
    { accountId: String(new ObjectId()) },
    { branchId: String(new ObjectId()) },
    { license: new ObjectId() },
    ...[
      { sourceComplete: true },
      { newLowItemCount: 104 },
      { items: original.stock.items.slice(1) },
      { extra: 'private' },
      { coverage: { ...original.stock.coverage, unavailableItems: 1 } },
    ].map((patch) => {
      const stock = { ...original.stock, ...patch };
      return { stock, stockDigest: digestOf(stock) };
    }),
  ]) {
    await f.db
      .collection('business_inbox')
      .replaceOne({ _id: original._id }, { ...original, ...change });
    assert.equal((await stockInbox(f)).entries.length, 0, JSON.stringify(change));
    await assert.rejects(readStockEvent(f, f.eventId), { code: 'entry_unavailable' });
  }
});

test('stock Inbox pagination advances through invisible entries and caps each page at ten', async () => {
  const f = await inboxFixture();
  const original = await f.db.collection('business_inbox').findOne({});
  for (let i = 0; i < 12; i++)
    await f.db.collection('business_inbox').insertOne({
      ...original,
      _id: new ObjectId(),
      eventKey: 'page-' + i,
      materializationPending: true,
    });
  const first = await stockInbox(f);
  assert.equal(first.entries.length, 0);
  assert.ok(first.next);
  const second = await stockInbox(f, { before: first.next });
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].id, f.eventId);
  assert.equal(second.next, null);
});

test('read acknowledgement rejects financial and unknown kinds even when the caller knows their IDs', async () => {
  const f = await inboxFixture();
  const row = await f.db.collection('business_inbox').findOne({});
  for (const kind of ['daily_summary', 'register_summary', 'unsupported_notification']) {
    await f.db.collection('business_inbox').updateOne({ _id: row._id }, { $set: { kind } });
    await assert.rejects(readStockEvent(f, f.eventId), { code: 'access_denied' });
  }
});

const stockPushCheck = (f, options = {}, database = f.db) =>
  require('../src/services/business-stock-push-scope').stockPushScope(
    database,
    f.target,
    f.eventId,
    { now: f.now, ...options }
  );

test('stock push evidence checks current group members independently of financial access and own cadence', async () => {
  const f = await inboxFixture();
  assert.equal(f.context.capabilities.includes('overview.read'), false);
  const result = await stockPushCheck(f);
  assert.equal(result.status, 'eligible');
  assert.equal(result.itemId, String(f.rows[0]._id));
  assert.equal(result.preference.time, '23:00');
  assert.equal((await materializeStock(f)).status, 'deferred');
  assert.equal((await f.db.collection('business_inbox').findOne({})).pushPending, false);
});

test('stock push scans beyond the public sample and resumes later current-stock pages', async () => {
  const f = await inboxFixture();
  f.advance();
  await f.db
    .collection('items')
    .updateMany(
      { _id: { $in: f.rows.slice(0, 102).map((row) => row._id) } },
      { $set: { available_quantity: 9 } }
    );
  for (const page of await f.pages()) await f.send(page);
  const first = await stockPushCheck(f);
  assert.equal(first.status, 'pending');
  assert.equal(first.cursor.pageIndex, 1);
  const second = await stockPushCheck(f, { cursor: first.cursor });
  assert.equal(second.status, 'eligible');
  assert.equal(second.itemId, String(f.rows[102]._id));
});

test('healthy and unknown stock suppress delivery without erasing historical Inbox content', async () => {
  for (const update of [
    { $set: { available_quantity: 9 } },
    { $unset: { available_quantity: '' } },
  ]) {
    const f = await inboxFixture();
    f.advance();
    await f.db.collection('items').updateMany({}, update);
    for (const page of await f.pages()) await f.send(page);
    let result = await stockPushCheck(f);
    if (result.status === 'pending') result = await stockPushCheck(f, { cursor: result.cursor });
    assert.equal(result.status, 'suppressed');
    assert.equal((await stockInbox(f)).entries.length, 1);
  }
});

test('stock push cursor cannot cross snapshots, events or settings and stale source stays unavailable', async () => {
  const f = await inboxFixture();
  f.advance();
  await f.db
    .collection('items')
    .updateMany(
      { _id: { $in: f.rows.slice(0, 100).map((row) => row._id) } },
      { $set: { available_quantity: 9 } }
    );
  for (const page of await f.pages()) await f.send(page);
  const first = await stockPushCheck(f);
  assert.equal(first.status, 'pending');
  for (const patch of [
    { eventId: String(new ObjectId()) },
    { revision: 999 },
    { activationId: 'changed' },
    { pageIndex: -1 },
  ])
    assert.equal(
      (await stockPushCheck(f, { cursor: { ...first.cursor, ...patch } })).status,
      'changed'
    );
  f.advance();
  for (const page of await f.pages()) await f.send(page);
  assert.equal((await stockPushCheck(f, { cursor: first.cursor })).status, 'unavailable');
  f.advance(FRESHNESS_MS);
  assert.equal((await stockPushCheck(f)).status, 'unavailable');
});

test('read, expired, disabled, uncommitted and revoked stock events cannot authorize a push', async () => {
  for (const mode of ['read', 'expired', 'disabled', 'uncommitted', 'revoked']) {
    const f = await inboxFixture();
    if (mode === 'read') await readStockEvent(f, f.eventId);
    if (mode === 'expired') f.advance(3600000);
    if (mode === 'disabled')
      await f.db
        .collection('business_stock_notification_preferences')
        .updateOne({}, { $set: { enabled: false } });
    if (mode === 'uncommitted')
      await f.db
        .collection('business_inbox')
        .updateOne({}, { $set: { materializationPending: true } });
    if (mode === 'revoked')
      await f.db
        .collection('users')
        .updateOne({ _id: f.user._id }, { $set: { 'access.item.read': false } });
    assert.notEqual((await stockPushCheck(f)).status, 'eligible', mode);
  }
});

test('a subsequent low episode cannot be mistaken for its already delivered group', async () => {
  const f = await inboxFixture();
  f.advance();
  await f.db.collection('items').updateMany({}, { $set: { available_quantity: 9 } });
  for (const page of await f.pages()) await f.send(page);
  let scan = await journalRecipient(f);
  while (scan.next) scan = await journalRecipient(f, scan.next);
  f.advance();
  await f.db.collection('items').updateMany({}, { $set: { available_quantity: 1 } });
  for (const page of await f.pages()) await f.send(page);
  scan = await journalRecipient(f);
  while (scan.next) scan = await journalRecipient(f, scan.next);
  let result = await stockPushCheck(f);
  while (result.status === 'pending') result = await stockPushCheck(f, { cursor: result.cursor });
  assert.equal(result.status, 'suppressed');
  assert.ok((await recipientRows(f)).every((row) => row.pending.episode === 2));
});

test('stock push rejects publisher, ACL, settings and membership changes during membership lookup', async () => {
  for (const mode of ['publisher', 'acl', 'settings', 'membership']) {
    const f = await inboxFixture();
    const database = {
      collection(name) {
        const collection = f.db.collection(name);
        return new Proxy(collection, {
          get(target, property) {
            if (name === 'business_stock_recipient_state' && property === 'find')
              return (...args) => {
                const cursor = target.find(...args),
                  original = cursor.toArray.bind(cursor);
                cursor.toArray = async () => {
                  const rows = await original();
                  if (mode === 'publisher')
                    await f.db
                      .collection('business_reporting_publishers')
                      .updateOne({}, { $inc: { epoch: 1 } });
                  else if (mode === 'settings')
                    await f.db
                      .collection('business_stock_notification_preferences')
                      .updateOne({}, { $inc: { revision: 1 } });
                  else if (mode === 'membership')
                    await f.db
                      .collection('business_stock_recipient_state')
                      .updateMany({}, { $inc: { revision: 1 } });
                  else
                    await f.db
                      .collection('users')
                      .updateOne({ _id: f.user._id }, { $set: { 'access.item.read': false } });
                  return rows;
                };
                return cursor;
              };
            return typeof target[property] === 'function'
              ? target[property].bind(target)
              : target[property];
          },
        });
      },
    };
    assert.notEqual((await stockPushCheck(f, {}, database)).status, 'eligible', mode);
  }
});

test('quiet hours are rechecked if their start is crossed during stock validation', async () => {
  const f = await inboxFixture();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(f.now()));
  const minutes =
    Number(parts.find((part) => part.type === 'hour').value) * 60 +
    Number(parts.find((part) => part.type === 'minute').value);
  const hhmm = (value) =>
    String(Math.floor((value % 1440) / 60)).padStart(2, '0') +
    ':' +
    String(value % 60).padStart(2, '0');
  await f.db
    .collection('business_stock_notification_preferences')
    .updateOne(
      {},
      { $set: { quiet: { enabled: true, start: hhmm(minutes + 1), end: hhmm(minutes + 2) } } }
    );
  let advanced = false;
  const database = {
    collection(name) {
      const collection = f.db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'business_stock_recipient_state' && property === 'find')
            return (...args) => {
              const cursor = target.find(...args),
                original = cursor.toArray.bind(cursor);
              cursor.toArray = async () => {
                const rows = await original();
                if (!advanced) {
                  f.advance(60000);
                  advanced = true;
                }
                return rows;
              };
              return cursor;
            };
          return typeof target[property] === 'function'
            ? target[property].bind(target)
            : target[property];
        },
      });
    },
  };
  const result = await stockPushCheck(f, {}, database);
  assert.equal(result.status, 'deferred');
  assert.ok(result.retryAt.getTime() > f.now());
  assert.equal((await stockPushCheck(f)).status, 'deferred');
});
