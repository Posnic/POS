const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { AssetUpdater, MAX_BOOT_ATTEMPTS } = require('../src/asset-updater');

/*
 * These tests are written from the assumption that a bad update will go out.
 *
 * Not "might" - will, eventually, to a machine nobody can reach, in a shop that
 * is mid-trade. So the cases that matter here are the refusals and the
 * recoveries, not the happy path: a forged manifest, a truncated download, a
 * path trying to climb out of its directory, and a version that cannot boot.
 *
 * The happy path is one test. The rest is what happens when it goes wrong.
 */

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-assets-'));
}

const keys = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });

function sign(manifest, privateKey = keys.privateKey) {
  const payload = Buffer.from(AssetUpdater.signedPayload(manifest), 'utf8');
  return crypto.sign(null, payload, privateKey).toString('base64');
}

/* A release: files, their hashes, and a signature over both. */
function release(version, files) {
  const contents = new Map();
  const entries = [];
  for (const [p, body] of Object.entries(files)) {
    const buf = Buffer.from(body, 'utf8');
    contents.set(p, buf);
    entries.push({ path: p, sha256: AssetUpdater.hash(buf) });
  }
  const manifest = { version, kind: 'assets', files: entries };
  manifest.signature = sign(manifest);
  return { manifest, contents };
}

function make(root, { publicKey = PUBLIC_KEY } = {}) {
  const baseline = path.join(root, 'baseline');
  fs.mkdirSync(baseline, { recursive: true });
  fs.writeFileSync(path.join(baseline, 'app.js'), 'baseline');
  return new AssetUpdater({ root: path.join(root, 'assets'), publicKey, baseline });
}

test('a signed release stages, activates, and becomes the directory served', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const { manifest, contents } = release('4.2.0', { 'script/app.js': 'v420' });

  assert.strictEqual(u.stage(manifest, contents).ok, true);
  assert.strictEqual(u.activeVersion(), null, 'staging alone must not go live');

  assert.strictEqual(u.activate('4.2.0').ok, true);
  assert.strictEqual(u.activeVersion(), '4.2.0');
  assert.strictEqual(
    fs.readFileSync(path.join(u.activeDir(), 'script/app.js'), 'utf8'), 'v420');
});

test('an unsigned manifest is refused', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const { manifest, contents } = release('4.2.0', { 'a.js': 'x' });
  delete manifest.signature;

  assert.deepStrictEqual(u.stage(manifest, contents), { ok: false, reason: 'unsigned' });
});

test('a manifest signed by the wrong key is refused', (t) => {
  // The case this whole mechanism exists for: somebody else publishing to it.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const attacker = crypto.generateKeyPairSync('ed25519');
  const { manifest, contents } = release('4.2.0', { 'a.js': 'x' });
  manifest.signature = sign(manifest, attacker.privateKey);

  assert.strictEqual(u.stage(manifest, contents).reason, 'bad-signature');
});

test('editing a file after signing is refused', (t) => {
  // The signature covers every hash, so swapped contents invalidate it.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const { manifest, contents } = release('4.2.0', { 'a.js': 'good' });
  contents.set('a.js', Buffer.from('evil', 'utf8'));

  assert.strictEqual(u.stage(manifest, contents).reason, 'hash-mismatch');
});

test('adding a file to a signed manifest is refused', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const { manifest, contents } = release('4.2.0', { 'a.js': 'x' });
  const extra = Buffer.from('extra', 'utf8');
  manifest.files.push({ path: 'b.js', sha256: AssetUpdater.hash(extra) });
  contents.set('b.js', extra);

  assert.strictEqual(u.stage(manifest, contents).reason, 'bad-signature');
});

test('a path climbing out of the directory is refused', (t) => {
  // Otherwise an update could write to the database, the startup folder, or
  // the app's own code.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);

  for (const bad of ['../evil.js', '../../evil.js', 'a/../../evil.js', '/etc/evil']) {
    const buf = Buffer.from('x', 'utf8');
    const manifest = { version: '9.9.9', kind: 'assets',
      files: [{ path: bad, sha256: AssetUpdater.hash(buf) }] };
    manifest.signature = sign(manifest);   // correctly signed, still refused
    const contents = new Map([[bad, buf]]);

    const r = u.stage(manifest, contents);
    assert.strictEqual(r.ok, false, bad + ' should be refused');
    assert.strictEqual(r.reason, 'path-escape', bad + ' should be refused as a path escape');
  }
});

test('a truncated download leaves the running version alone', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const first = release('4.2.0', { 'a.js': 'v420' });
  u.stage(first.manifest, first.contents);
  u.activate('4.2.0');

  // Second release arrives with one file missing.
  const second = release('4.3.0', { 'a.js': 'v430', 'b.js': 'v430b' });
  second.contents.delete('b.js');

  assert.strictEqual(u.stage(second.manifest, second.contents).reason, 'missing-file');
  assert.strictEqual(u.activeVersion(), '4.2.0', 'the live version must not move');
  assert.strictEqual(fs.readFileSync(path.join(u.activeDir(), 'a.js'), 'utf8'), 'v420');
});

test('with no public key, nothing is applied at all', (t) => {
  // A build that forgot the key must be inert, not trusting.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root, { publicKey: null });
  const { manifest, contents } = release('4.2.0', { 'a.js': 'x' });

  assert.strictEqual(u.stage(manifest, contents).reason, 'no-public-key');
  assert.strictEqual(u.status().verifies, false);
});

test('revert goes back to the previous version without a download', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'old' });
  const b = release('4.3.0', { 'a.js': 'new' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');
  u.stage(b.manifest, b.contents); u.activate('4.3.0');

  assert.strictEqual(fs.readFileSync(path.join(u.activeDir(), 'a.js'), 'utf8'), 'new');

  const r = u.revert();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(u.activeVersion(), '4.2.0');
  assert.strictEqual(fs.readFileSync(path.join(u.activeDir(), 'a.js'), 'utf8'), 'old');
});

test('revert from the very first update falls back to the installed baseline', (t) => {
  // There is always somewhere to go back to: what shipped in the installer,
  // which is the version that was tested before release.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'first' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');

  const r = u.revert();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.baseline, true);
  assert.strictEqual(u.activeVersion(), null);
  assert.strictEqual(fs.readFileSync(path.join(u.activeDir(), 'app.js'), 'utf8'), 'baseline');
});

test('a version that cannot boot twice is abandoned on its own', (t) => {
  /*
   * The one that matters. A shop looking at a white screen cannot click
   * Revert and cannot describe what happened, so the machine has to notice by
   * itself and put back what worked.
   */
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'good' });
  const b = release('4.3.0', { 'a.js': 'broken' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');
  u.beginBoot(); u.markHealthy();                    // 4.2.0 proved itself
  u.stage(b.manifest, b.contents); u.activate('4.3.0');

  for (let i = 0; i < MAX_BOOT_ATTEMPTS; i++) {
    const r = u.beginBoot();                         // starts, never reaches healthy
    assert.strictEqual(r.reverted, false, 'attempt ' + (i + 1) + ' should still try');
    assert.strictEqual(u.activeVersion(), '4.3.0');
  }

  const r = u.beginBoot();
  assert.strictEqual(r.reverted, true, 'the third start must give up on it');
  assert.strictEqual(u.activeVersion(), '4.2.0');
  assert.strictEqual(fs.readFileSync(path.join(u.activeDir(), 'a.js'), 'utf8'), 'good');
});

test('a version that boots normally is never abandoned', (t) => {
  // A till that restarts every morning must not eventually revert itself.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'fine' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');

  for (let day = 0; day < 30; day++) {
    assert.strictEqual(u.beginBoot().reverted, false, 'day ' + day);
    u.markHealthy();
  }
  assert.strictEqual(u.activeVersion(), '4.2.0');
});

test('a crash before healthy still counts, so a blank screen cannot hide', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'x' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');

  u.beginBoot();                       // starts, dies before markHealthy
  assert.strictEqual(u._readBootState().attempts, 1);
  u.beginBoot();
  assert.strictEqual(u._readBootState().attempts, 2);
});

test('a missing or corrupt pointer serves the installed baseline', (t) => {
  // Never a blank screen because a small text file went wrong.
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'x' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');

  fs.writeFileSync(u.pointerFile, '4.9.9-does-not-exist');
  assert.strictEqual(u.activeDir(), u.baseline);

  fs.writeFileSync(u.pointerFile, '');
  assert.strictEqual(u.activeDir(), u.baseline);
});

test('old versions are pruned, the one revert needs is kept', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  for (const v of ['4.1.0', '4.2.0', '4.3.0', '4.4.0']) {
    const r = release(v, { 'a.js': v });
    u.stage(r.manifest, r.contents);
    u.activate(v);
  }

  const kept = fs.readdirSync(u.versionsDir).sort();
  assert.deepStrictEqual(kept, ['4.3.0', '4.4.0'], 'keep the live one and the one before');
  assert.strictEqual(u.revert().version, '4.3.0');
});

test('status reports what support needs to see', (t) => {
  const root = tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const u = make(root);
  const a = release('4.2.0', { 'a.js': 'x' });
  u.stage(a.manifest, a.contents); u.activate('4.2.0');

  const s = u.status();
  assert.strictEqual(s.active, '4.2.0');
  assert.strictEqual(s.verifies, true);
  assert.strictEqual(s.canRevert, true);
});
