'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { bundle } = require('../scripts/signed-build-bundle');

function fixture(t, change = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-handoff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const name = 'Posnic-1.9.2-windows-x64-installer.exe';
  const bytes = Buffer.from('synthetic installer bytes, not a signed executable');
  fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, name + '.blockmap'), 'synthetic blockmap');
  const hash = crypto.createHash('sha512').update(bytes).digest('base64');
  const meta = { version: '1.9.2', path: name, sha512: hash,
    files: [{ url: name, sha512: hash, size: bytes.length }] };
  change(meta);
  fs.writeFileSync(path.join(dir, 'latest.yml'), yaml.dump(meta));
  return { dir, name };
}
test('handoff preserves exact installer bytes and includes verifiable checksums', (t) => {
  const { dir, name } = fixture(t);
  const dest = bundle(dir, '1.9.2', 'abc123', 'Test Publisher');
  assert.deepEqual(fs.readFileSync(path.join(dest, name)), fs.readFileSync(path.join(dir, name)));
  const info = JSON.parse(fs.readFileSync(path.join(dest, 'BUILD-INFO.json')));
  assert.equal(info.commit, 'abc123');
  for (const line of fs.readFileSync(path.join(dest, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
    const [hash, file] = line.split('  ');
    assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(path.join(dest, file))).digest('hex'));
  }
  assert.throws(() => bundle(dir, '1.9.2', 'abc123', 'Test Publisher'), /EEXIST/);
});
for (const [label, change] of [
  ['wrong hash', (m) => { m.sha512 = 'wrong'; }],
  ['wrong size', (m) => { m.files[0].size++; }],
  ['another installer', (m) => { m.files[0].url = 'other.exe'; }],
  ['wrong version', (m) => { m.version = '1.9.1'; }],
]) test('rejects ' + label + ' before handoff', (t) => {
  const { dir } = fixture(t, change);
  assert.throws(() => bundle(dir, '1.9.2', 'abc123', 'Test'), /metadata does not match/);
  assert.equal(fs.existsSync(path.join(dir, 'handoff')), false);
});
test('a post-build change to the installer cannot retain stale update metadata', (t) => {
  const { dir, name } = fixture(t);
  fs.appendFileSync(path.join(dir, name), 'changed');
  assert.throws(() => bundle(dir, '1.9.2', 'abc123', 'Test'), /metadata does not match/);
});
