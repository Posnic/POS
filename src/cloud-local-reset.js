'use strict';
const path = require('path');

async function verifyLocalDatabase({ uri, dataPath, MongoClient }) {
  const url = new URL(uri);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Only this computer’s bundled database can be deleted here.');
  }
  if (!dataPath) throw new Error('The local database folder could not be verified.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const options = await client.db('admin').command({ getCmdLineOpts: 1 });
    const actual = options.parsed?.storage?.dbPath;
    if (!actual || path.resolve(actual) !== path.resolve(dataPath)) {
      throw new Error('Another Posnic installation is using this database port. Close it and retry.');
    }
  } finally { await client.close(); }
}

async function stopSync(manager) {
  if (!manager) return;
  const child = manager.child;
  if (!child || child.exitCode != null) { manager.stop(); return; }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited);
      reject(new Error('Cloud sync has not stopped. Restart Posnic before deleting local data.'));
    }, 10000);
    function exited() { clearTimeout(timeout); resolve(); }
    child.once('exit', exited);
    manager.stop();
  });
}

module.exports = { verifyLocalDatabase, stopSync };
