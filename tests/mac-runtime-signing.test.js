'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signRuntime, isMachO } = require('../scripts/sign-mac-runtime');

function fixture(t) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-sign-test-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  const archive = path.join(app, 'Contents', 'Resources', 'api', 'node_modules.zip');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, 'unsigned archive');
  fs.writeFileSync(archive + '.id', 'old-runtime-id');
  return { app, archive };
}

test('signs nested Mach-O with timestamp and identity before repacking runtime', (t) => {
  const { app, archive } = fixture(t);
  const calls = [];
  signRuntime({ app, identity: 'developer-id', keychain: '/build/keychain' }, (command, args) => {
    calls.push({ command, args });
    if (args[0] === '-x') {
      const nested = path.join(args[3], '@napi-rs', 'canvas');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'skia.node'), Buffer.from('cffaedfe00000000', 'hex'));
      fs.writeFileSync(path.join(nested, 'index.js'), 'plain javascript');
    }
    if (args[0] === '-c') fs.writeFileSync(args.at(-1), 'signed archive');
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].args.slice(0, 8), ['--force', '--timestamp', '--options', 'runtime', '--sign', 'developer-id', '--keychain', '/build/keychain']);
  assert.deepEqual(calls[2].args.slice(0, 2), ['--verify', '--strict']);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'signed archive');
  assert.notEqual(fs.readFileSync(archive + '.id', 'utf8'), 'old-runtime-id');
});

test('a signing failure cannot replace the runtime or its cache identity', (t) => {
  const { app, archive } = fixture(t);
  assert.throws(() => signRuntime({ app, identity: 'developer-id' }, (_command, args) => {
    if (args[0] === '-x') fs.writeFileSync(path.join(args[3], 'addon.node'), Buffer.from('feedfacf', 'hex'));
    else throw new Error('signing failed');
  }), /signing failed/);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'unsigned archive');
  assert.equal(fs.readFileSync(archive + '.id', 'utf8'), 'old-runtime-id');
});

test('rejects ad-hoc identity and detects universal Mach-O without signing text', (t) => {
  const { app } = fixture(t);
  assert.throws(() => signRuntime({ app, identity: '-' }), /Developer ID/);
  const file = path.join(app, 'binary');
  for (const magic of ['cafebabe', 'cafebabf', 'feedface', 'cefaedfe']) {
    fs.writeFileSync(file, Buffer.from(magic, 'hex'));
    assert.equal(isMachO(file), true);
  }
  fs.writeFileSync(file, 'hello');
  assert.equal(isMachO(file), false);
});
