/*
 * The desktop's half of the agent self-update (U3.5, agent-update-apply.js).
 *
 * The agent process downloads releases; this side decides what is safe to
 * run. So the cases that matter mirror the asset-updater ones: a genuine
 * release goes live, a forged or tampered one is consumed and refused, and
 * nothing is ever retried forever.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { AssetUpdater } = require('../src/asset-updater');
const { applyIncoming } = require('../src/agent-update-apply');

const keys = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });

function signedManifest(version, files, privateKey = keys.privateKey) {
  const entries = Object.entries(files).map(([p, body]) => ({
    path: p,
    sha256: AssetUpdater.hash(Buffer.from(body, 'utf8')),
  }));
  const manifest = { version, kind: 'agent', files: entries };
  manifest.signature = crypto
    .sign(null, Buffer.from(AssetUpdater.signedPayload(manifest), 'utf8'), privateKey)
    .toString('base64');
  return manifest;
}

/* A downloaded release directory, exactly as the agent leaves it. The fake
   extractor unpacks `files` instead of a real zip - 7za is not what is under
   test here. */
function download(incomingDir, version, files, manifest) {
  const dir = path.join(incomingDir, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bundle.zip'), 'zipbytes');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return async (zip, dest) => {
    for (const [p, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dest, p)), { recursive: true });
      fs.writeFileSync(path.join(dest, p), body);
    }
  };
}

function loadTree(dir, base = dir, map = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) loadTree(full, base, map);
    else map.set(path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full));
  }
  return map;
}

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = path.join(root, 'installed-agent');
  fs.mkdirSync(path.join(baseline, 'src'), { recursive: true });
  fs.writeFileSync(path.join(baseline, 'src', 'index.js'), 'installed');
  const engine = new AssetUpdater({
    root: path.join(root, 'updates'),
    baseline,
    publicKey: PUBLIC_KEY,
  });
  return { root, engine, incoming: path.join(root, 'updates', 'incoming') };
}

test('a genuine downloaded release is verified, activated, and its download consumed', async (t) => {
  const { engine, incoming } = setup(t);
  const files = { 'src/index.js': 'updated agent' };
  const extract = download(incoming, '1.5.1', files, signedManifest('1.5.1', files));

  const r = await applyIncoming({ engine, incomingDir: incoming, extract, loadTree });
  assert.deepStrictEqual(r.applied, ['1.5.1']);
  assert.strictEqual(engine.activeVersion(), '1.5.1');
  assert.strictEqual(
    fs.readFileSync(path.join(engine.activeDir(), 'src', 'index.js'), 'utf8'),
    'updated agent'
  );
  assert.strictEqual(fs.existsSync(path.join(incoming, '1.5.1')), false, 'download consumed');
});

test('a manifest signed by the wrong key is consumed and refused', async (t) => {
  const { engine, incoming } = setup(t);
  const files = { 'src/index.js': 'evil' };
  const wrongKeys = crypto.generateKeyPairSync('ed25519');
  const extract = download(
    incoming, '1.5.2', files, signedManifest('1.5.2', files, wrongKeys.privateKey)
  );

  const r = await applyIncoming({ engine, incomingDir: incoming, extract, loadTree });
  assert.deepStrictEqual(r.applied, []);
  assert.strictEqual(engine.activeVersion(), null, 'nothing went live');
  assert.strictEqual(fs.existsSync(path.join(incoming, '1.5.2')), false, 'not retried forever');
});

test('tampered bytes under a genuine manifest are refused at stage', async (t) => {
  const { engine, incoming } = setup(t);
  const manifest = signedManifest('1.5.3', { 'src/index.js': 'what was signed' });
  const extract = download(incoming, '1.5.3', { 'src/index.js': 'what arrived' }, manifest);

  const r = await applyIncoming({ engine, incomingDir: incoming, extract, loadTree });
  assert.deepStrictEqual(r.applied, []);
  assert.strictEqual(engine.activeVersion(), null);
});

test('a manifest for a different version than its directory is refused', async (t) => {
  const { engine, incoming } = setup(t);
  const files = { 'src/index.js': 'x' };
  const extract = download(incoming, '9.9.9', files, signedManifest('1.5.4', files));

  const r = await applyIncoming({ engine, incomingDir: incoming, extract, loadTree });
  assert.deepStrictEqual(r.applied, []);
});

test('without the public key nothing is applied at all', async (t) => {
  const { incoming } = setup(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = new AssetUpdater({ root, baseline: root, publicKey: null });
  const files = { 'src/index.js': 'x' };
  const extract = download(incoming, '1.5.5', files, signedManifest('1.5.5', files));

  const r = await applyIncoming({ engine, incomingDir: incoming, extract, loadTree });
  assert.strictEqual(r.reason, 'no-key');
  assert.deepStrictEqual(r.applied, []);
});

test('a half-written download (.partial) is left alone for the agent to finish', async (t) => {
  const { engine, incoming } = setup(t);
  fs.mkdirSync(path.join(incoming, '1.6.0.partial'), { recursive: true });
  const r = await applyIncoming({
    engine, incomingDir: incoming, extract: async () => {}, loadTree,
  });
  assert.deepStrictEqual(r.applied, []);
  assert.ok(fs.existsSync(path.join(incoming, '1.6.0.partial')), 'partial untouched');
});
