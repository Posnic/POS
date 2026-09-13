'use strict';

/*
 * The sandbox's own scripts, and whether the box ever sees them.
 *
 * reset.sh decides what develop.posnic.io looks like every morning, and for
 * most of its life it was copied to the box by hand. A copy nobody can diff
 * against the repository drifts until the two are different programs, and a
 * fix committed here sits in git doing nothing until somebody remembers to
 * scp it.
 *
 * That is not hypothetical: the nightly reset was wiping the owner's API key
 * every night, and the fix for it is worth exactly nothing unless the box
 * gets the new script.
 *
 * So the deploy ships them, and this pins the deploy to what reset.sh
 * actually calls - in both directions, the way bundle-deployment.test.js
 * does for the customer bundles.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const RESET = read('scripts', 'sandbox', 'reset.sh');
const DEPLOY = read('.github', 'workflows', 'deploy-develop.yml');

test('every sandbox script reset.sh calls is one the deploy ships', () => {
  /* What it runs out of its own directory on the box. */
  const called = [...RESET.matchAll(/\$HOME_DIR\/([A-Za-z0-9._-]+\.(?:js|sh))/g)].map((m) => m[1]);
  assert.ok(called.length, 'reset.sh no longer runs anything from its own directory');

  const missing = called.filter((file) => !DEPLOY.includes('scripts/sandbox/' + file));
  assert.deepStrictEqual(
    missing,
    [],
    `reset.sh runs these but the deploy never copies them: ${missing.join(', ')}`
  );
});

test('every sandbox script the deploy ships is one that exists', () => {
  const shipped = [...DEPLOY.matchAll(/scripts\/sandbox\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(shipped.includes('reset.sh'), 'the deploy no longer ships reset.sh');
  const gone = [...new Set(shipped)].filter(
    (file) => !fs.existsSync(path.join(ROOT, 'scripts', 'sandbox', file))
  );
  assert.deepStrictEqual(gone, [], `the deploy copies files that are not here: ${gone.join(', ')}`);
});

test('the reset keeps what a person typed, and keeps it in that order', () => {
  /*
   * Owner: "i want set up keys permnanetly. when db reset it should not get
   * deleted or need to add again."
   *
   * The order is the whole thing: saved before anything is dropped, put back
   * after the restore. Either way round and it keeps nothing, or keeps the
   * state it was meant to clear.
   */
  for (const collection of ['branch_secrets', 'branch_preferences', 'branches']) {
    assert.ok(RESET.includes(collection), `the reset no longer keeps ${collection}`);
  }

  const saveAt = RESET.indexOf('\nkeep_save\n');
  const dropAt = RESET.search(/mongorestore --drop|dropDatabase/);
  const restoreAt = RESET.indexOf('\nkeep_restore\n');
  assert.ok(saveAt > 0, 'the reset never saves anything');
  assert.ok(restoreAt > 0, 'the reset never puts anything back');
  assert.ok(saveAt < dropAt, 'the keep is saved after the database has already been dropped');
  assert.ok(restoreAt > dropAt, 'the keep is put back before the restore overwrites it');
});

test('the kept branches come back beside the restored ones, never over them', () => {
  /* Restoring them over the top would undo the reset itself: the sandbox
     would keep yesterday's shop, not yesterday's configuration. */
  assert.match(RESET, /--nsTo "\$DB\.kept_branches"/);
  assert.ok(
    !/--archive="\$KEEP\/branches\.gz"[^\n]*\n[^\n]*mongosh/.test(RESET) ||
      RESET.includes('kept_branches'),
    'the kept branches are restored straight over the live ones'
  );

  const keeper = read('scripts', 'sandbox', 'keep-branches.js');
  assert.match(keeper, /\$set: \{ online_ordering: row\.online_ordering \}/);
  assert.match(keeper, /db\.kept_branches\.drop\(\);/, 'the working copy is left in the database');
  /* One field, not the whole branch: a reset that rebuilt the shop must keep
     the shop it rebuilt. */
  assert.ok(
    !/\$set: \{ \.\.\.row \}/.test(keeper),
    'the whole branch document is written back, not just its configuration'
  );
});

test('the keep never lands in the repository, because it holds real keys', () => {
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'scripts', 'sandbox', 'keep')),
    'a keep directory is in the repository'
  );
  assert.match(RESET, /KEEP=\$HOME_DIR\/keep/, 'the keep moved out of the box-only directory');
});

test('a rebuilt sandbox comes up with a shop that can take an order', () => {
  /*
   * Owner: "Live voice is switched off for this shop ... i didnt do. may be
   * db reset?" It was: the box rebuilt from the seeder, and the seeder had
   * never configured online ordering, so /online-ordering answered
   * "none_configured" and every printed code pointed at nothing.
   */
  const seed = read('scripts', 'sandbox', 'seed.js');
  assert.match(seed, /online_ordering: \{/, 'the seeder still leaves the shop unable to take an order');
  assert.match(seed, /store_id: STORE_ADDRESS/, 'the seeded shop has no store address');
  assert.match(
    seed,
    /const STORE_ADDRESS = process\.env\.SEED_STORE_ADDRESS \|\| 'ABC'/,
    'the address is not fixed, so every rebuild breaks the printed codes'
  );
  /* It must not stamp over a shop that already has one. */
  assert.match(seed, /!\(shop\.online_ordering && shop\.online_ordering\.store_id\)/);
});

test('a rebuilt shop inherits what the old one was configured with', () => {
  /*
   * The settings rows are keyed by licence and branch id. A rebuild mints
   * new ones, so a faithfully restored key pointed at a branch that no
   * longer existed and the shop read as though nothing had ever been set.
   */
  const keeper = read('scripts', 'sandbox', 'keep-branches.js');
  assert.match(keeper, /branch_secrets/, 'the secrets are not re-homed');
  assert.match(keeper, /branch_preferences/, 'the preferences are not re-homed');
  assert.match(
    keeper,
    /rows\.updateMany\(\{ branch_id: null \}, \{ \$set: \{ license: shopNow\.license \} \}\)/,
    'an account row is given a branch it does not belong to'
  );
  assert.match(
    keeper,
    /rows\.updateMany\(\s*\{ branch_id: \{ \$ne: null \} \}/,
    'branch rows are not pointed at the new branch'
  );

  /* One shop is not a guess; several would be. */
  assert.match(keeper, /countDocuments\(\) === 1 \? collection\.findOne\(\{\}\) : null/);
  assert.match(keeper, /left alone rather than guessed at/);

  /* And the restore case still lands the ordinary way. */
  assert.match(keeper, /\$set: \{ online_ordering: row\.online_ordering \}/);
  assert.match(keeper, /db\.kept_branches\.drop\(\);/);
});
