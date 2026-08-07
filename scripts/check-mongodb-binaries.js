#!/usr/bin/env node
'use strict';
/*
 * The MongoDB server has to be here before an installer can be built.
 *
 * It used to be committed, so it was always present and nobody had to think
 * about it. It is not committed any more: it is 60MB of somebody else's software
 * under the SSPL, and keeping it in git made every clone 130MB and made this
 * repository a redistributor of a licence that is not its own.
 * download-mongodb.bat fetches the same files from MongoDB's own servers.
 *
 * Without this check the build would still succeed. electron-builder treats a
 * missing extraResources path as nothing to copy, so the installer would be
 * produced, would install, and would fail on a shop's counter the first time it
 * tried to start its database - which is the worst possible place to discover
 * it. Failing here, before anything is built, costs one command.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'mongodb', 'bin');

/* Exactly what package.json's extraResources copies. Kept in step with it by
   the test in tests/mongodb-binaries.test.js. */
const REQUIRED = [
  'mongod.exe',
  'msvcp140.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];

function main() {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(BIN, f)));

  if (!missing.length) {
    console.log(`[mongodb] ${REQUIRED.length} binaries present in mongodb/bin`);
    return 0;
  }

  console.error('');
  console.error('[mongodb] cannot build an installer - these are missing from mongodb/bin:');
  for (const f of missing) console.error(`  ${f}`);
  console.error('');
  console.error('  They are not kept in git. Fetch them once with:');
  console.error('');
  console.error('      download-mongodb.bat');
  console.error('');
  console.error('  Building without them produces an installer that looks fine and');
  console.error('  fails on the counter, the first time it tries to start its database.');
  console.error('');
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { REQUIRED, BIN };
