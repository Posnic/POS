'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { AssetUpdater } = require('../src/asset-updater');
const { installAgent } = require('../src/agent-bootstrap');
const Manager = require('../src/sync-agent-manager');
const keys = crypto.generateKeyPairSync('ed25519');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = new AssetUpdater({ root, publicKey: keys.publicKey, baseline: path.join(root, 'baseline') });
  const contents = Buffer.from('verified component');
  const manifest = { version: '1.6.4', kind: 'agent', files: [{ path: 'src/index.js', sha256: AssetUpdater.hash(contents) }] };
  manifest.signature = crypto.sign(null, Buffer.from(AssetUpdater.signedPayload(manifest)), keys.privateKey).toString('base64');
  const requests = [];
  const opts = {
    config: { gatewayUrl: 'https://cloud.example', deviceToken: 'test-token' }, engine,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return url.endsWith('/bundle') ? new Response('zip') : Response.json({ version: '1.6.4', manifest });
    },
    extract: async (_zip, dest) => { fs.mkdirSync(path.join(dest, 'src')); fs.writeFileSync(path.join(dest, 'src/index.js'), contents); },
  };
  return { root, engine, manifest, opts, requests };
}

test('a public installer installs a signed component after activation', async (t) => {
  const { opts, engine, requests } = fixture(t);
  assert.equal(await installAgent(opts), '1.6.4');
  assert.equal(engine.activeVersion(), '1.6.4');
  assert.equal(fs.readFileSync(path.join(engine.activeDir(), 'src/index.js'), 'utf8'), 'verified component');
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.options.headers.authorization, 'Bearer test-token');
    assert.equal(request.options.redirect, 'error');
  }
});

test('unsigned code is refused before downloading or extracting it', async (t) => {
  const { opts, manifest, requests, engine } = fixture(t);
  manifest.signature = 'invalid';
  opts.extract = () => assert.fail('must not extract');
  await assert.rejects(installAgent(opts), /could not be verified/);
  assert.equal(requests.length, 1);
  assert.equal(engine.activeVersion(), null);
});

test('corrupt bundle contents never become active and temporary files are removed', async (t) => {
  const { opts, root, engine } = fixture(t);
  opts.extract = async (_zip, dest) => { fs.mkdirSync(path.join(dest, 'src')); fs.writeFileSync(path.join(dest, 'src/index.js'), 'corrupt'); };
  await assert.rejects(installAgent(opts), /failed verification/);
  assert.equal(engine.activeVersion(), null);
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith('bootstrap-')), false);
});

test('unavailable feed fails with a retryable error instead of claiming a download started', async (t) => {
  const { opts } = fixture(t);
  opts.fetch = async () => new Response(null, { status: 204 });
  await assert.rejects(installAgent(opts), /unavailable.*retry/);
});

test('Community mode makes no cloud request without activation', async (t) => {
  const { root } = fixture(t);
  const manager = new Manager({ app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.1' }, fetch: () => assert.fail('no cloud request') });
  assert.equal(await manager.start(), false);
});

test('a public installer upgrade retains the downloaded agent when it has no bundled replacement', async (t) => {
  const { opts, engine, root } = fixture(t);
  await installAgent(opts);
  const manager = new Manager({ app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.1' } });
  manager._engine = engine;
  await manager._applyDownloadedUpdates();
  assert.equal(engine.activeVersion(), '1.6.4');
  assert.ok(manager._findAgent());
});

// Exercise the real main-process connection helper with an asynchronous manager.
function connection(start) {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const helper = main.slice(main.indexOf('async function connectCloudDevice('), main.indexOf("ipcMain.handle('cloud:resume'"));
  const manager = { stop() {}, start };
  const sandbox = { fs: { existsSync: () => false, writeFileSync() {} }, path, app: { getPath: () => 'test' },
    process: { env: {} }, console: { log() {}, warn() {} }, CLOUD_CONFIG_FILE: 'test.json', syncAgentManager: manager,
    createMenu() {}, tray: null, refreshBrand: async () => {}, refreshLimits: async () => {}, };
  vm.runInNewContext(helper, sandbox);
  return sandbox.connectCloudDevice({ deviceToken: 'test', deviceId: 'device' }, 'https://cloud.example');
}

test('activation awaits startup and refuses async false', async () => {
  const result = await connection(async () => false);
  assert.equal(result.ok, false);
});

test('activation does not succeed before the component has started', async () => {
  let finish;
  let complete = false;
  const result = connection(() => new Promise((resolve) => { finish = resolve; })).then((r) => { complete = true; return r; });
  await Promise.resolve();
  assert.equal(complete, false);
  finish(true);
  assert.equal((await result).ok, true);
});

test('startup failure permits retry without redeeming a pairing code twice', async () => {
  const result = await connection(async () => { throw new Error('download failed'); });
  assert.equal(result.ok, false);
  assert.equal(result.canResume, true);
  assert.equal(result.error, 'download failed');
});

function wizard(t, cloud) {
  const source = fs.readFileSync(path.join(__dirname, '../src/install-wizard.html'), 'utf8');
  const fn = source.slice(source.indexOf('        async function runCloudSetup('), source.indexOf('        async function initApiBase('));
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { style: {}, disabled: false, textContent: '' }); return elements.get(id); } };
  let poll;
  let now = 0;
  const sandbox = { resumeCloudDownload: false, document, window: { electronAPI: { cloud } }, API_BASE: 'http://localhost',
    Date: { now: () => now }, setTimeout: (fn) => { poll = fn; return 1; }, clearTimeout: () => { poll = null; } };
  vm.runInNewContext(fn, sandbox);
  return { run: sandbox.runCloudSetup, document, tick: async (elapsed) => { now += elapsed; const fn = poll; poll = null; await fn(); } };
}

for (const type of ['false', 'rejection', 'status failure', 'no status']) {
  test(`wizard recovers its controls after ${type}`, async (t) => {
    const harness = wizard(t, { status: async () => { if (type === 'status failure') throw new Error('IPC gone'); return { sync: null }; } });
    await harness.run(async () => { if (type === 'rejection') throw new Error('IPC gone'); return { ok: type !== 'false' }; });
    if (type === 'status failure' || type === 'no status') await harness.tick(61_000);
    for (const id of ['cloudConnectBtn', 'cloudBackBtn', 'pairBtn']) assert.equal(harness.document.getElementById(id).disabled, false);
    assert.equal(harness.document.getElementById('cloudError').style.display, 'block');
  });
}
