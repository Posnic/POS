'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { zipOnlyManifest, prepare } = require('../scripts/prepare-mac-updater');

test('both ZIP architectures keep their exact hashes and sizes after DMG stapling', () => {
  const files = [{ url: 'app-x64.zip', sha512: 'x64-hash', size: 20 }, { url: 'app-arm64.zip', sha512: 'arm-hash', size: 30 },
    { url: 'app-x64.dmg', sha512: 'stale-hash', size: 10 }];
  const result = zipOnlyManifest({ version: '1.7.1', files, path: 'app-x64.zip', sha512: 'x64-hash' });
  assert.deepEqual(result.files, files.slice(0, 2)); assert.equal(result.sha512, 'x64-hash');
  assert.equal(result.path, 'app-x64.zip'); assert.equal(files.length, 3);
  assert.throws(() => zipOnlyManifest({ files: [files[2]] }), /require a ZIP/);
});
test('manual DMGs stay intact while stale DMG blockmaps are removed', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-mac-updater-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = [{ url: 'app.zip', sha512: 'zip-hash', size: 20 }, { url: 'app.dmg', sha512: 'stale', size: 10 }];
  fs.writeFileSync(path.join(directory, 'latest-mac.yml'), yaml.dump({ files, path: 'app.zip', sha512: 'zip-hash' }));
  for (const name of ['app.dmg', 'app.dmg.blockmap', 'app.zip.blockmap']) fs.writeFileSync(path.join(directory, name), name);
  prepare(directory);
  assert.equal(fs.readFileSync(path.join(directory, 'app.dmg'), 'utf8'), 'app.dmg');
  assert.ok(!fs.existsSync(path.join(directory, 'app.dmg.blockmap')));
  assert.ok(fs.existsSync(path.join(directory, 'app.zip.blockmap')));
  assert.deepEqual(yaml.load(fs.readFileSync(path.join(directory, 'latest-mac.yml'), 'utf8')).files, [files[0]]);
});
