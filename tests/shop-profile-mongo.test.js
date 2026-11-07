'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { ShopProfiles } = require('../src/shop-profiles');

test('three profile directories reopen only their own MongoDB sales on the same port', { skip: !process.env.TEST_MONGOD }, async () => {
  const { MongoClient } = require('mongodb');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-mongo-'));
  const profiles = new ShopProfiles(root);
  const shops = ['original', profiles.add(), profiles.add()];
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let clean = false;
  const password = require('node:crypto').randomUUID();
  try {
    for (const [index, id] of [...shops, ...shops].entries()) {
      profiles.activate(id);
      const directory = path.join(new ShopProfiles(root).directory(id), 'mongodb', 'data');
      fs.mkdirSync(directory, { recursive: true });
      const child = spawn(process.env.TEST_MONGOD, ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory], { windowsHide: true, stdio: 'ignore' });
      const exited = once(child, 'exit');
      const client = new MongoClient('mongodb://127.0.0.1:' + port, { serverSelectionTimeoutMS: 15000 });
      let owned = false;
      try {
        await client.connect();
        const db = client.db('PosnicPro');
        const options = await client.db('admin').command({ getCmdLineOpts: 1 });
        assert.equal(path.resolve(options.parsed.storage.dbPath), directory);
        owned = true;
        if (index < shops.length) {
          if (index === 0) await client.db('admin').command({ createUser: 'restorecheck', pwd: password, roles: ['root'] });
          assert.equal(await db.collection('sales').countDocuments(), 0);
          await db.collection('sales').insertOne({ _id: 'same-sale-id', owner: id });
        } else {
          assert.equal((await db.collection('sales').findOne({ _id: 'same-sale-id' })).owner, id);
        }
      } finally {
        if (child.exitCode === null) {
          if (owned) await client.db('admin').command({ shutdown: 1, force: true }).catch(() => {});
          else child.kill();
          if (child.exitCode === null) {
            const timeout = setTimeout(() => child.kill(), 6000);
            try { await exited; } finally { clearTimeout(timeout); }
          }
        }
        await client.close();
      }
    }
    await require('../src/verify-shop-recovery').verifyShopRecovery({
      archive: root, binary: process.env.TEST_MONGOD, MongoClient,
      uri: 'mongodb://restorecheck:' + password + '@127.0.0.1/PosnicPro?authSource=admin'
    });
    clean = true;
  } finally {
    if (clean) fs.rmSync(root, { recursive: true, force: true });
  }
});
