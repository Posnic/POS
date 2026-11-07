'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

// Boot a disposable copy. Opening a MongoDB data directory modifies its journal.
async function verifyShopRecovery({ archive, binary, uri, MongoClient }) {
  const data = path.join(archive, 'mongodb', 'data');
  await fs.access(path.join(data, 'WiredTiger'));
  const temporary = await fs.mkdtemp(path.join(path.dirname(archive), '.restore-test-'));
  let child, exited, client, owned = false;
  try {
    await fs.cp(data, temporary, { recursive: true });
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(binary, ['--dbpath', temporary, '--bind_ip', '127.0.0.1', '--port', String(port), '--auth'], { windowsHide: true, stdio: 'ignore' });
    exited = once(child, 'exit').then(() => {}, () => {});
    const local = new URL(uri);
    local.hostname = '127.0.0.1';
    local.port = String(port);
    client = new MongoClient(local.href, { directConnection: true, serverSelectionTimeoutMS: 12000 });
    await client.connect();
    const admin = client.db('admin');
    const options = await admin.command({ getCmdLineOpts: 1 });
    owned = path.resolve(options.parsed.storage.dbPath) === temporary;
    if (!owned) throw new Error('Could not verify the restored database.');
    const db = client.db('PosnicPro');
    const collections = await db.listCollections({ type: 'collection' }).toArray();
    if (!collections.length) throw new Error('Recovered shop database is empty.');
    for (const collection of collections) {
      const result = await db.command({ validate: collection.name });
      if (result.valid !== true) throw new Error('Recovered shop database failed validation.');
    }
  } finally {
    if (child && child.exitCode === null && child.pid) {
      if (owned) await client.db('admin').command({ shutdown: 1, force: true }).catch(() => {});
      if (child.exitCode === null) child.kill();
      await exited;
    }
    if (client) await client.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
module.exports = { verifyShopRecovery };
