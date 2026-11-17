'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareMacCanvas } = require('../scripts/prepare-mac-canvas');

function fixture(t, corrupt = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-canvas-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'api'));
  const packages = {};
  for (const arch of ['arm64', 'x64']) {
    packages[`node_modules/@napi-rs/canvas-darwin-${arch}`] = {
      version: '0.1.80', resolved: `https://registry.npmjs.org/canvas-${arch}.tgz`,
      integrity: 'sha512-' + crypto.createHash('sha512').update(arch).digest('base64'),
    };
  }
  fs.writeFileSync(path.join(root, 'api/package-lock.json'), JSON.stringify({ packages }));
  const run = (command, args) => {
    if (command === 'npm') {
      assert.ok(args.includes('--ignore-scripts'));
      const directory = args.at(-1);
      fs.writeFileSync(path.join(directory, 'native.tgz'), corrupt ? 'bad bytes' : path.basename(directory));
      return JSON.stringify([{ filename: 'native.tgz' }]);
    }
    assert.equal(command, '/usr/bin/tar');
    const directory = args.at(-1);
    const arch = path.basename(directory);
    fs.mkdirSync(path.join(directory, 'package'));
    fs.writeFileSync(path.join(directory, 'package/package.json'), JSON.stringify({ name: `@napi-rs/canvas-darwin-${arch}`, version: '0.1.80' }));
    fs.writeFileSync(path.join(directory, `package/skia.darwin-${arch}.node`), 'native fixture');
  };
  return { root, run };
}

test('both Mac architectures are copied from integrity-checked locked packages', (t) => {
  const { root, run } = fixture(t);
  prepareMacCanvas(root, run);
  for (const arch of ['arm64', 'x64']) assert.ok(fs.existsSync(path.join(root, `api/node_modules/@napi-rs/canvas-darwin-${arch}/skia.darwin-${arch}.node`)));
});
test('corrupt downloads are rejected before native modules are installed', (t) => {
  const { root, run } = fixture(t, true);
  assert.throws(() => prepareMacCanvas(root, run), /integrity mismatch/);
  assert.equal(fs.existsSync(path.join(root, 'api/node_modules')), false);
});
