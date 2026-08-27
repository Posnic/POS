/*
 * The connector runtime (I5, connector-runtime.js).
 *
 * Three promises under test: nothing unsigned ever runs, a genuine bundle
 * for one connector cannot be replayed as another (the name is inside the
 * signed payload via kind), and a connector that keeps dying is parked
 * without taking anything else with it. Plus the dark-ship guarantee:
 * with nothing installed and nothing configured, the supervisor is inert.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { AssetUpdater } = require('../src/asset-updater');
const { ConnectorSupervisor, CRASH_LIMIT } = require('../src/connector-runtime');

const keys = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });

function signedManifest(name, version, files, privateKey = keys.privateKey) {
  const entries = Object.entries(files).map(([p, body]) => ({
    path: p,
    sha256: AssetUpdater.hash(Buffer.from(body, 'utf8')),
  }));
  const manifest = { version, kind: 'connector:' + name, files: entries };
  manifest.signature = crypto
    .sign(null, Buffer.from(AssetUpdater.signedPayload(manifest), 'utf8'), privateKey)
    .toString('base64');
  return manifest;
}

/* A downloaded bundle exactly as the downloader leaves it; the fake
   extractor stands in for 7za. */
function download(root, name, version, files, manifest) {
  const dir = path.join(root, 'incoming', name, version);
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

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit('exit', 0);
  return child;
}

function setup(t, { spawnImpl, publicKey = PUBLIC_KEY } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-rt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const spawned = [];
  const sup = new ConnectorSupervisor({
    root,
    publicKey,
    apiPort: () => 5555,
    appVersion: '9.9.9',
    spawnImpl:
      spawnImpl ||
      ((cmd, args, opts) => {
        const child = fakeChild();
        spawned.push({ cmd, args, opts, child });
        return child;
      }),
  });
  return { root, sup, spawned };
}

function enable(root, name, extra = {}) {
  fs.writeFileSync(
    path.join(root, name + '.config.json'),
    JSON.stringify({ enabled: true, token: 'posnic_test_token', ...extra })
  );
}

test('a genuine signed bundle is adopted and runs with the local API as its whole world', async (t) => {
  const { root, sup, spawned } = setup(t);
  const files = { 'src/index.js': 'connector code' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'whatsapp', { settings: { session: 'shop' } });

  const started = await sup.startAll({ extract, loadTree });
  assert.deepStrictEqual(started, ['whatsapp']);
  assert.strictEqual(spawned.length, 1);
  const env = spawned[0].opts.env;
  assert.strictEqual(env.LOCAL_API_URL, 'http://127.0.0.1:5555');
  assert.strictEqual(env.CONNECTOR_TOKEN, 'posnic_test_token');
  assert.strictEqual(env.CONNECTOR_NAME, 'whatsapp');
  assert.strictEqual(env.POSNIC_CONNECTOR_VERSION, '1.0.0');
  assert.strictEqual(env.MONGO_URI, undefined, 'no database access');
  assert.strictEqual(env.LOCAL_URI, undefined, 'no database access');
  sup.stopAll();
});

test('a bundle signed by the wrong key never becomes runnable', async (t) => {
  const { root, sup, spawned } = setup(t);
  const wrong = crypto.generateKeyPairSync('ed25519');
  const files = { 'src/index.js': 'evil' };
  const extract = download(
    root, 'whatsapp', '1.0.1', files,
    signedManifest('whatsapp', '1.0.1', files, wrong.privateKey)
  );
  enable(root, 'whatsapp');

  const started = await sup.startAll({ extract, loadTree });
  assert.deepStrictEqual(started, []);
  assert.strictEqual(spawned.length, 0);
  assert.strictEqual(fs.existsSync(path.join(root, 'incoming', 'whatsapp', '1.0.1')), false,
    'refused download consumed, not retried forever');
});

test('a genuine bundle for one connector cannot install as another (kind binds the name)', async (t) => {
  const { root, sup, spawned } = setup(t);
  const files = { 'src/index.js': 'whatsapp code' };
  // Signed - genuinely - as whatsapp, but planted under shopify.
  const extract = download(root, 'shopify', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'shopify');

  const started = await sup.startAll({ extract, loadTree });
  assert.deepStrictEqual(started, []);
  assert.strictEqual(spawned.length, 0);
});

test('without a public key the runtime refuses everything', async (t) => {
  const { root, sup } = setup(t, { publicKey: null });
  const files = { 'src/index.js': 'x' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'whatsapp');
  const r = await sup.applyIncoming({ extract, loadTree });
  assert.strictEqual(r.reason, 'no-key');
  assert.deepStrictEqual(r.applied, []);
});

test('installed but not enabled does not run - no config, no start', async (t) => {
  const { root, sup, spawned } = setup(t);
  const files = { 'src/index.js': 'x' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));

  const started = await sup.startAll({ extract, loadTree });
  assert.deepStrictEqual(started, []);
  assert.strictEqual(spawned.length, 0);
  const st = sup.status().find((s) => s.name === 'whatsapp');
  assert.strictEqual(st.installed, true);
  assert.strictEqual(st.enabled, false);
});

test('a PROVEN connector that keeps dying is parked as crashloop, never uninstalled', async (t) => {
  const { root, sup, spawned } = setup(t);
  const files = { 'src/index.js': 'dies at once' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'whatsapp');
  await sup.applyIncoming({ extract, loadTree });
  // This version has run healthy before - its crashes are operational, so
  // the boot gate stays out of it and containment is the breaker's job.
  sup._engine('whatsapp').markHealthy();

  // Each start succeeds, then the child dies; the supervisor schedules a
  // retry we simulate by calling start again after pushing the exit.
  for (let i = 0; i < CRASH_LIMIT; i++) {
    assert.strictEqual(sup.start('whatsapp'), true, 'attempt ' + i + ' spawns');
    const { child } = spawned[spawned.length - 1];
    child.emit('exit', 1);
    // cancel the pending scheduled restart; the loop drives retries itself
    sup.connectors.get('whatsapp').state = 'restarting';
    clearTimeout(sup.connectors.get('whatsapp').restartTimer);
  }
  assert.strictEqual(sup.start('whatsapp'), false, 'parked after the limit');
  const st = sup.status().find((s) => s.name === 'whatsapp');
  assert.strictEqual(st.state, 'crashloop');
  assert.strictEqual(st.installed, true, 'parked, not uninstalled');

  // A deliberate restart clears the history and tries again.
  assert.strictEqual(sup.restart('whatsapp'), true);
  sup.stopAll();
});

test('an UNPROVEN update that cannot stay up reverts to the safe floor: not installed', async (t) => {
  const { root, sup, spawned } = setup(t);
  const files = { 'src/index.js': 'never boots' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'whatsapp');
  await sup.applyIncoming({ extract, loadTree });

  // Two spawns of a version that never reaches healthy burn its attempts...
  for (let i = 0; i < 2; i++) {
    assert.strictEqual(sup.start('whatsapp'), true, 'attempt ' + i + ' spawns');
    spawned[spawned.length - 1].child.emit('exit', 1);
    sup.connectors.get('whatsapp').state = 'restarting';
    clearTimeout(sup.connectors.get('whatsapp').restartTimer);
  }
  // ...and the third start reverts it out of existence rather than looping.
  assert.strictEqual(sup.start('whatsapp'), false);
  const st = sup.status().find((s) => s.name === 'whatsapp');
  assert.strictEqual(st.state, 'not-installed');
  assert.strictEqual(st.installed, false);
});

test('a hostile incoming name is discarded before any path is built from it', async (t) => {
  const { root, sup } = setup(t);
  fs.mkdirSync(path.join(root, 'incoming', 'UPPER..case'), { recursive: true });
  const r = await sup.applyIncoming({ extract: async () => {}, loadTree });
  assert.deepStrictEqual(r.applied, []);
  assert.strictEqual(fs.existsSync(path.join(root, 'incoming', 'UPPER..case')), false);
});

test('dark ship: empty root means inert - nothing listed, nothing started, nothing thrown', async (t) => {
  const { sup, spawned } = setup(t);
  const started = await sup.startAll({});
  assert.deepStrictEqual(started, []);
  assert.deepStrictEqual(sup.status(), []);
  assert.strictEqual(spawned.length, 0);
});

test('a spawn that throws parks the connector instead of crashing the till', async (t) => {
  const { root, sup } = setup(t, {
    spawnImpl: () => { throw new Error('EACCES'); },
  });
  const files = { 'src/index.js': 'x' };
  const extract = download(root, 'whatsapp', '1.0.0', files, signedManifest('whatsapp', '1.0.0', files));
  enable(root, 'whatsapp');
  await sup.applyIncoming({ extract, loadTree });

  assert.strictEqual(sup.start('whatsapp'), false);
  const st = sup.status().find((s) => s.name === 'whatsapp');
  assert.strictEqual(st.state, 'broken');
});
