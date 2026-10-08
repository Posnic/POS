#!/usr/bin/env node
'use strict';
// Local maintenance entry point. It requires the installation's database and
// publisher trust configuration; it is not an HTTP route or an online licence
// activation service. Stop the API, keep its MongoDB available, then restart.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({
  path: process.env.POSNIC_ENV_FILE || path.join(__dirname, '..', '.env'),
  quiet: true,
});
const { MongoClient } = require('mongodb');
const { stageExtensionArchive } = require('../src/services/extension-installation');
const { activateStagedVersion, pointer } = require('../src/services/extension-activation');
const { readExtensionFile } = require('../../src/extension-file');
const { MAX_ARCHIVE_BYTES } = require('../src/services/extension-archive');
const [command, first, second, ...rest] = process.argv.slice(2);
async function main() {
  const root = process.env.POSNIC_EXTENSIONS_ROOT;
  const publicKey =
    process.env.POSNIC_EXTENSIONS_PUBLIC_KEY ||
    (process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE &&
      fs.readFileSync(process.env.POSNIC_EXTENSIONS_PUBLIC_KEY_FILE, 'utf8'));
  if (!root || !path.isAbsolute(root) || !publicKey)
    throw Error('Configure an absolute POSNIC_EXTENSIONS_ROOT and the publisher public key.');
  if (command === 'stage') {
    if (!first || second || rest.length)
      throw Error('Usage: extensions.cjs stage <signed-package.zip>');
    const staged = await stageExtensionArchive(readExtensionFile(first, MAX_ARCHIVE_BYTES), {
      root,
      publicKey,
    });
    console.log(
      JSON.stringify({
        id: staged.id,
        version: staged.version,
        packageDigest: staged.packageDigest,
        staged: true,
      })
    );
    return;
  }
  if (!['activate', 'rollback'].includes(command) || !/^[a-z][a-z0-9.-]{2,99}$/.test(first || ''))
    throw Error(
      'Usage: extensions.cjs activate <id> <version> [--license <id> --branch <id>] | rollback <id>'
    );
  const enableScopes = [];
  if (command === 'activate' && rest.length) {
    if (rest.length !== 4 || rest[0] !== '--license' || rest[2] !== '--branch')
      throw Error('Supply both --license and --branch.');
    enableScopes.push({ license: rest[1], branchId: rest[3] });
  }
  if (command === 'rollback' && (second || rest.length))
    throw Error('Usage: extensions.cjs rollback <id>');
  if (!process.env.MONGODB_URI)
    throw Error('The installation MONGODB_URI must be configured; no default database is assumed.');
  const version = command === 'rollback' ? pointer(path.join(root, first), 'previous') : second;
  if (!version) throw Error('No version selected or no previous version is available.');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const result = await activateStagedVersion({
      root,
      publicKey,
      db: client.db(),
      id: first,
      version,
      enableScopes,
    });
    console.log(JSON.stringify(result));
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  // Database URLs or provider secrets must never be included in CLI diagnostics.
  console.error(
    error.name?.startsWith('Mongo') ? 'Database operation failed.' : error.code || error.message
  );
  process.exitCode = 1;
});
