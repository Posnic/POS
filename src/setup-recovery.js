'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hardwareFiles = require('./setup-hardware-files.json');

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing an unexpected recovery path.');
  }
  return target;
}
function hash(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const digest = crypto.createHash('sha256');
    const chunk = Buffer.alloc(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, chunk, 0, chunk.length, null))) digest.update(chunk.subarray(0, size));
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}
// Call only after the API, sync and the owned MongoDB process have stopped.
// Every byte is verified before the first deletion. Copies are outside the
// active database and normal backup retention, and never used by sync.
function saveRecovery({ userData, recoveryRoot, names }) {
  const relative = path.relative(path.resolve(userData), path.resolve(recoveryRoot));
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Recovery copies must be outside the application data folder.');
  }
  const destination = path.join(recoveryRoot, `recovery-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const files = [];
  function copy(source, target, relativeName) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error('Recovery cannot follow linked data folders.');
    if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name), path.join(relativeName, name));
    } else if (stat.isFile()) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
      const digest = hash(source);
      if (digest !== hash(target)) throw new Error('Recovery verification failed. Existing data was not removed.');
      files.push({ name: relativeName, sha256: digest, bytes: stat.size });
    } else throw new Error('Unsupported file in recovery data.');
  }
  for (const name of names) {
    const source = within(userData, path.join(userData, name));
    if (fs.existsSync(source)) copy(source, within(destination, path.join(destination, name)), name);
  }
  fs.writeFileSync(path.join(destination, 'recovery-manifest.json'), JSON.stringify({ version: 1, autoRestore: false, files }, null, 2), { mode: 0o600 });
  return destination;
}
const businessFiles = [
  'mongodb', '.mongodb-credentials.json', '.mongodb-setup-done', '.credential-key.json', '.local-secrets.json',
  'posnic-cloud.json', 'cloud-shop-identity.json', '.startup-ready',
  'connector-runtime', '.install-credentials.json',
  'kot-state.json', 'kot-logs', 'windows-print-queue', 'print-ledger.json',
];
function resetSavedData({ userData, recoveryRoot, keepHardware = true }) {
  const names = [...businessFiles, ...hardwareFiles];
  const destination = saveRecovery({ userData, recoveryRoot, names });
  for (const name of [...businessFiles, ...(keepHardware ? [] : hardwareFiles)]) {
    fs.rmSync(within(userData, path.join(userData, name)), { recursive: true, force: true });
  }
  return destination;
}
module.exports = { within, hash, saveRecovery, resetSavedData, businessFiles, hardwareFiles };
