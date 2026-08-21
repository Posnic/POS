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

/*
 * Only ONE of those is the developer's to fetch.
 *
 * This check runs first in the prebuild chain, before prepare:bundle - and
 * prepare:bundle is what runs prepare:vc-runtime, which copies the three
 * VC runtime DLLs off the machine. So on a fresh clone this listed all four as
 * missing and said "fetch them with download-mongodb.bat", which is wrong
 * twice: three of them are supplied by the build a moment later, and that
 * script does not contain them anyway - MongoDB's own archive ships
 * vc_redist.x64.exe, an installer, not the DLLs.
 *
 * Somebody following that advice downloads 600MB, sees the same four names
 * again, and has no way to tell that three of them were never the problem.
 *
 * So this fails only on what nobody else will supply. The DLLs still have to
 * be there in the finished package, and they are guaranteed by
 * bundle-vc-runtime.js, which exits non-zero if it cannot find them - a check
 * that runs AFTER the step that produces them, which is the only place a check
 * for them means anything.
 */
const FETCHED_BY_HAND = ['mongod.exe'];
const SUPPLIED_BY_BUILD = REQUIRED.filter((f) => !FETCHED_BY_HAND.includes(f));

function main() {
  const present = (f) => fs.existsSync(path.join(BIN, f));
  const missing = FETCHED_BY_HAND.filter((f) => !present(f));

  if (!missing.length) {
    const pending = SUPPLIED_BY_BUILD.filter((f) => !present(f));
    if (pending.length) {
      console.log(
        `[mongodb] ${FETCHED_BY_HAND.length} of ${REQUIRED.length} present; ` +
          `prepare:vc-runtime supplies the rest (${pending.join(', ')})`
      );
    } else {
      console.log(`[mongodb] ${REQUIRED.length} binaries present in mongodb/bin`);
    }
    return 0;
  }

  console.error('');
  console.error('[mongodb] cannot build an installer - missing from mongodb/bin:');
  for (const f of missing) console.error(`  ${f}`);
  console.error('');
  console.error('  Not kept in git - 60MB of somebody else\'s software under the SSPL.');
  console.error('  Fetch it once with:');
  console.error('');
  console.error('      download-mongodb.bat');
  console.error('');
  console.error('  Building without it produces an installer that looks fine and');
  console.error('  fails on the counter, the first time it tries to start its database.');
  console.error('');
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { REQUIRED, FETCHED_BY_HAND, SUPPLIED_BY_BUILD, BIN };
