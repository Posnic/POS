'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resetSavedData, hash, saveRecovery } = require('../src/setup-recovery');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'data'), recoveryRoot = path.join(root, 'recovery');
  fs.mkdirSync(path.join(userData, 'mongodb', 'data'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'mongodb', 'data', 'collection.wt'), 'unsynced sale');
  fs.writeFileSync(path.join(userData, 'preferences.json'), '{"receipt_printer":"counter"}');
  fs.writeFileSync(path.join(userData, 'posnic-cloud.json'), '{"token":"old"}');
  fs.writeFileSync(path.join(userData, '.credential-key.json'), 'key');
  return { userData, recoveryRoot };
}
test('fresh setup archives every selected byte before removing the old shop; hardware stays by default', t => {
  const options = fixture(t), archive = resetSavedData(options);
  assert.equal(fs.readFileSync(path.join(archive, 'mongodb/data/collection.wt'), 'utf8'), 'unsynced sale');
  assert.equal(fs.existsSync(path.join(options.userData, 'mongodb')), false);
  assert.equal(fs.existsSync(path.join(options.userData, 'posnic-cloud.json')), false);
  assert.equal(fs.existsSync(path.join(options.userData, 'preferences.json')), true);
  assert.equal(fs.readFileSync(path.join(archive, '.credential-key.json'), 'utf8'), 'key');
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'recovery-manifest.json')));
  assert.equal(manifest.autoRestore, false);
  for (const file of manifest.files) assert.equal(hash(path.join(archive, file.name)), file.sha256);
});
test('hardware deletion requires explicit false and its previous settings are still recoverable', t => {
  const options = fixture(t), archive = resetSavedData({ ...options, keepHardware: false });
  assert.equal(fs.existsSync(path.join(options.userData, 'preferences.json')), false);
  assert.equal(fs.existsSync(path.join(archive, 'preferences.json')), true);
});
test('unwritable recovery and recovery inside active data abort before deletion', t => {
  const options = fixture(t);
  fs.writeFileSync(options.recoveryRoot, 'not a directory');
  assert.throws(() => resetSavedData(options));
  assert.throws(() => resetSavedData({ ...options, recoveryRoot: path.join(options.userData, 'recovery') }));
  assert.equal(fs.readFileSync(path.join(options.userData, 'mongodb/data/collection.wt'), 'utf8'), 'unsynced sale');
  assert.equal(fs.existsSync(path.join(options.userData, 'posnic-cloud.json')), true);
});
test('recovery refuses paths outside the owned data directory', t => {
  const options = fixture(t);
  assert.throws(() => saveRecovery({ ...options, names: ['../outside'] }), /unexpected/);
});
